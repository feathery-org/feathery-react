import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { v4 as uuidv4 } from 'uuid';
import DocxEditor from './index';
import SignedEnvelopeView from './SignedEnvelopeView';
import FeatheryClient, { API_URL } from '../../../utils/featheryClient';
import { documentRefTemplateId } from '../../../utils/featheryClient/integrationClient';
import { featheryWindow, openTab } from '../../../utils/browser';
import useRefreshOnFocus from '../../../utils/useRefreshOnFocus';
import { fieldValues, initState, setFieldValues } from '../../../utils/init';
import internalState from '../../../utils/internalState';
import { ACTION_GENERATE_ENVELOPES } from '../../../utils/elementActions';
import {
  buildDocumentReviewTrigger,
  containerToolbarOutcomes,
  editorContainerId,
  getSignUrl,
  isDocusignSignAction,
  signsViaDocusign
} from '../../../utils/document';
import {
  registerDocxEditor,
  unregisterDocxEditor
} from '../../../assistant/tools/docx/docxEditorRegistry';
import { rebindRevisionGroups } from '../../../utils/documentEditorPrimitives';
import { clearDocxEditorDirty, setDocxEditorDirty } from './docxDirtyRegistry';
import { DocxHistoryHost, DocxSaveMeta } from './history/types';
import { fetchDocumentBytes } from '../../../utils/documentPersistence';

// The container carries no document. Its document is owned by the Generate
// Documents button that targets it: find the action whose editor_mode matches
// this container and use its first document. The schema key it was found under
// is the form key, which the DocuSign finalize needs — the `formId` prop is a
// form *instance* id and can't stand in for it.
function resolveTargetAction(containerId?: string): {
  action?: Record<string, any>;
  formKey?: string;
} {
  if (!containerId) return {};
  const schemas = (initState as any).formSchemas ?? {};
  for (const key of Object.keys(schemas)) {
    const rawSteps = schemas[key]?.steps;
    // panel/v20 caches steps as an array; some callers store a key→step map.
    const steps = Array.isArray(rawSteps)
      ? rawSteps
      : Object.values(rawSteps ?? {});
    for (const step of steps as any[]) {
      for (const button of step?.buttons ?? []) {
        for (const action of button?.properties?.actions ?? []) {
          if (
            action?.type === ACTION_GENERATE_ENVELOPES &&
            editorContainerId(action ?? {}) === containerId
          ) {
            return { action, formKey: key };
          }
        }
      }
    }
  }
  return {};
}

interface Envelope {
  id: string;
  file: string | null;
  // Control-bearing docx copy for the editor; `file` is the stripped public
  // copy. Null/absent for non-docx envelopes and control-free docx.
  editor_file?: string | null;
  document?: string;
  type: string;
  signed: boolean;
  // Whether and how it went out for signature, recorded by the backend so the
  // status survives a reload. Absent on older backends.
  sent?: boolean;
  sent_via?: 'feathery' | 'docusign' | null;
}

// How it was sent: this session's record, else the backend's.
function sentMethod(
  envelope: Envelope,
  sentVia: Record<string, 'feathery' | 'docusign'>
): 'feathery' | 'docusign' | undefined {
  return (
    sentVia[envelope.id] ??
    (envelope.sent ? envelope.sent_via ?? 'feathery' : undefined)
  );
}

// The editor must open the control-bearing copy when the envelope has one;
// legacy and control-free envelopes only have the public `file`.
function envelopeSourceUrl(envelope?: Envelope | null): string | undefined {
  return envelope?.editor_file ?? envelope?.file ?? undefined;
}

// The stored file a URL points at, without a presigned URL's query.
const storedFile = (url?: string | null) => url?.split('?')[0] ?? null;

interface RefreshEventDetail {
  containerId?: string;
  documents?: string[];
  envelopes?: Envelope[];
}

// Fired by the Generate Documents action targeting this container so an
// already mounted editor reloads the freshly generated envelope.
const REFRESH_EVENT = 'feathery-docx-editor-refresh';
const PENDING_DRAFTS_KEY = '__featheryDocxEditorDrafts';

/**
 * FLIP THIS TO TEST DOCUMENT BINDINGS. Ships false.
 *
 * Turns on the [[...]] binding engine for every DocxEditor in the bundle:
 * template tokens become content controls, formulas compute, and edits
 * reconcile on Enter or blur. The per-host switch is
 * window.featherySyncfusion.bindings; this is the blunt version, for when
 * rebuilding the package is easier than arranging for that global to be set
 * before the editor mounts.
 *
 * Two things follow from it being a compile-time constant:
 *   - flipping it needs a `yarn build` and a re-link into the consuming app;
 *   - it applies globally, so leave it false on anything shared.
 */
const FORCE_DOCUMENT_BINDINGS = true;

function getPendingDraft(containerId?: string): RefreshEventDetail | undefined {
  if (!containerId) return undefined;
  return (featheryWindow() as any)[PENDING_DRAFTS_KEY]?.[containerId];
}

function getGeneratedEnvelope(
  detail?: RefreshEventDetail,
  documentId?: string
): Envelope | undefined {
  return (
    detail?.envelopes?.find(
      (env) => documentId && env.document === documentId
    ) ?? detail?.envelopes?.[0]
  );
}

const placeholder = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
  padding: 16,
  textAlign: 'center' as const,
  border: '1px dashed #d4d4d8',
  borderRadius: 8,
  color: '#71717a',
  fontSize: 14
};

const wrap = {
  width: '100%',
  height: '100%',
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
  position: 'relative' as const
};

// A container whose content is a document editor bound to a Document template.
// At runtime it loads the submission's current envelope for that document and
// (for docx) renders the reusable DocxEditor; saving overwrites the envelope in
// place. The renderer is chosen by envelope type so other types (csv/pdf) can
// be added without changing this wiring.
export default function DocumentEditorContainer({
  containerId,
  formId,
  stepId,
  editMode,
  assistantEnabled
}: {
  containerId?: string;
  formId?: string;
  stepId?: string;
  editMode?: boolean;
  assistantEnabled?: boolean;
}) {
  const pendingDraft = useMemo(
    () => getPendingDraft(containerId),
    [containerId]
  );
  const { action: targetAction, formKey } = useMemo(
    () => resolveTargetAction(containerId),
    [containerId]
  );
  // Carries the form key because the DocuSign sign path posts form_key; the
  // other envelope calls only need initInfo().
  const client = useMemo(() => new FeatheryClient(formKey ?? ''), [formKey]);
  // Document is owned by the button that targets this container.
  const documentId = useMemo(
    () =>
      // Only a template can open here; other sources are rejected at generate.
      (targetAction?.documents ?? [])
        .map(documentRefTemplateId)
        .find(Boolean) ??
      (pendingDraft?.documents ?? [])
        .map(documentRefTemplateId)
        .find(Boolean) ??
      pendingDraft?.envelopes?.[0]?.document,
    [targetAction, pendingDraft]
  );
  const [envelope, setEnvelope] = useState<Envelope | null>(
    () => getGeneratedEnvelope(pendingDraft, documentId) ?? null
  );
  const [sourceUrl, setSourceUrl] = useState<string | undefined>(() =>
    envelopeSourceUrl(getGeneratedEnvelope(pendingDraft, documentId))
  );
  const [loading, setLoading] = useState(!envelope);
  const [error, setError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const beforeReplaceRef = useRef<(() => Promise<unknown>) | null>(null);
  const registerBeforeReplace = useCallback(
    (save: (() => Promise<unknown>) | null) => {
      beforeReplaceRef.current = save;
    },
    []
  );
  // Bumped to force the editor to reload its source after a (re)generate.
  // NOT bumped on save (so saving doesn't reload the document out from under
  // the user).
  const [reloadKey, setReloadKey] = useState(0);
  // Envelope that was finalized for signing (docx → signable PDF) this
  // session. Keyed by id so a regenerated envelope is editable again without
  // any reset wiring.
  const [finalizedId, setFinalizedId] = useState<string | null>(null);
  // Envelopes this session actually sent for signature, and how. Only these
  // read as sent; a PDF reopened later carries no such record.
  const [sentVia, setSentVia] = useState<
    Record<string, 'feathery' | 'docusign'>
  >({});
  // The filler's signing page, offered again in case the browser blocked the
  // tab opened after the finalize round trip.
  const [signUrls, setSignUrls] = useState<Record<string, string>>({});
  // A reopen in flight; a second click would finalize and open a tab twice.
  // The ref blocks clicks landing before the disabled state renders.
  const [openingSigningPage, setOpeningSigningPage] = useState(false);
  const openingSigningPageRef = useRef(false);

  // Read from window each render. Do NOT useMemo([]) — on Next.js SSR
  // featheryWindow() is {} so a mount-once memo freezes serviceUrl as
  // undefined and the editor never opens the generated docx.
  // Default serviceUrl is the Feathery backend proxy (hides the self-hosted
  // Word Processor). window.featherySyncfusion may override for local smoke
  // tests; licenseKey is optional (server license lives on the Word Processor).
  const syncfusion = (featheryWindow() as any).featherySyncfusion ?? {};
  const serviceUrl = syncfusion.serviceUrl || `${API_URL}document/editor/`;
  // Read initState directly instead of initInfo() — initInfo() throws when the
  // SDK isn't initialized, but in editMode (designer preview, tests) this
  // component renders a placeholder and never needs the key.
  const { sdkKey } = initState;
  const serviceHeaders = useMemo(() => {
    if (syncfusion.headers) return syncfusion.headers;
    if (sdkKey) return [{ Authorization: `Token ${sdkKey}` }];
    return [];
  }, [sdkKey, syncfusion.headers]);

  // A background refresh keeps what is shown when it fails or comes back
  // empty: a dead network can resolve with nothing rather than throw.
  const loadEnvelope = useCallback(
    async (background = false) => {
      if (!documentId) return;
      try {
        const env = await client.getCurrentEnvelope(documentId);
        const nextEnvelope = env && env.id ? (env as Envelope) : null;
        if (background && !nextEnvelope) return;
        setEnvelope(nextEnvelope);
        setSourceUrl(envelopeSourceUrl(nextEnvelope));
        setError(null);
      } catch (e: any) {
        console.error('Feathery: failed to load current envelope', e);
        if (!background) setError(e?.message || String(e));
      } finally {
        if (!background) setLoading(false);
      }
    },
    [documentId, client]
  );

  useEffect(() => {
    if (editMode || !documentId) {
      setLoading(false);
      return;
    }
    const pendingEnvelope = getGeneratedEnvelope(
      getPendingDraft(containerId),
      documentId
    );
    if (pendingEnvelope?.id) {
      setEnvelope(pendingEnvelope);
      setSourceUrl(envelopeSourceUrl(pendingEnvelope));
      setLoading(false);
      return;
    }
    loadEnvelope();
  }, [containerId, documentId, editMode, loadEnvelope]);

  useEffect(() => {
    if (editMode) return undefined;
    const handler = async (event: Event) => {
      const detail = (event as CustomEvent<RefreshEventDetail>).detail;
      if (
        detail?.containerId &&
        containerId &&
        detail.containerId !== containerId
      ) {
        return;
      }

      try {
        await beforeReplaceRef.current?.();
      } catch (error) {
        setOperationError(
          `The new document could not be opened because your current edits could not be saved. ${
            error instanceof Error ? error.message : ''
          }`
        );
        return;
      }

      const generatedEnvelope = getGeneratedEnvelope(detail, documentId);
      if (generatedEnvelope?.id) {
        setOperationError(null);
        setEnvelope(generatedEnvelope);
        setSourceUrl(envelopeSourceUrl(generatedEnvelope));
        setError(null);
        setLoading(false);
        setReloadKey((k) => k + 1);
        return;
      }

      loadEnvelope().then(() => setReloadKey((k) => k + 1));
    };
    const win = featheryWindow();
    win.addEventListener(REFRESH_EVENT, handler);
    return () => win.removeEventListener(REFRESH_EVENT, handler);
  }, [containerId, documentId, editMode, loadEnvelope]);

  // Re-pull the envelope when the filler returns from the hosted sign tab, so
  // its status + signed PDF update. Scoped to the awaiting-signature window.
  // Only Feathery signing flips `signed` here; nothing on our side ever
  // records a DocuSign signature, so those are not polled.
  useRefreshOnFocus(
    () => loadEnvelope(true),
    !editMode &&
      !!documentId &&
      envelope?.type === 'pdf' &&
      !envelope.signed &&
      sentMethod(envelope, sentVia) === 'feathery'
  );
  // Reload only when the file or its signed state changes (signing overwrites
  // the same path); an unchanged plain URL gets ?v= to bypass caches.
  const pdfView = useRef<{
    key: string;
    raw: string | null;
    url: string | null;
    version: number;
  }>({ key: '', raw: null, url: null, version: 0 });
  const pdfViewKey = `${storedFile(envelope?.file)}|${!!envelope?.signed}`;
  if (pdfView.current.key !== pdfViewKey) {
    const raw = envelope?.file ?? null;
    const version = pdfView.current.version + 1;
    const reused = !!raw && raw === pdfView.current.raw && !raw.includes('?');
    pdfView.current = {
      key: pdfViewKey,
      raw,
      version,
      url: reused ? `${raw}?v=${version}` : raw
    };
  }

  // Stable source unless a different envelope loads or a regenerate is
  // signalled (reloadKey) — a plain save leaves both unchanged, so it doesn't
  // reload the document.
  const source = useMemo(
    () => (sourceUrl ? { url: sourceUrl } : undefined),
    [sourceUrl]
  );
  // The loaded editor is authoritative. If a generate action contains several
  // documents, the envelope actually displayed here wins over the action's
  // first-document loading default.
  const activeDocumentId = envelope?.document ?? documentId;
  // Signed envelopes are always read-only. Otherwise the Generate Documents
  // action that targets this container owns editability via
  // `editor_read_only` (default: editable).
  const actionReadOnly =
    typeof targetAction?.editor_read_only === 'boolean'
      ? targetAction.editor_read_only
      : false;
  const finalized = !!envelope && envelope.id === finalizedId;
  const readOnly = !!envelope?.signed || !!actionReadOnly || finalized;
  // The outcomes this container offers, read from `editor_toolbar_actions` —
  // the same key the overlay editor uses. See containerToolbarOutcomes.
  const { terminalAction, offersDraft, offersDownload, savesToField } =
    containerToolbarOutcomes(targetAction ?? {});
  const reviewChanges = !!assistantEnabled && !readOnly;

  // Opt-in, and off unless a host asks for it: window.featherySyncfusion.bindings
  // rides the same config object that already carries serviceUrl and licenseKey,
  // or FORCE_DOCUMENT_BINDINGS is flipped for local testing.
  const bindingsEnabled =
    FORCE_DOCUMENT_BINDINGS || syncfusion.bindings === true;
  // The most recent committed document-field values, read at save time.
  const bindingValuesRef = useRef<Record<string, string>>({});
  const pendingWritebackRef = useRef<Record<string, any>>({});

  const saveEnvelope = useCallback(
    async (blob: Blob, meta?: DocxSaveMeta) => {
      if (!envelope) return;
      const savedBindings = {
        ...(meta?.bindingValues ?? bindingValuesRef.current)
      };
      const updated = await client.saveEnvelopeFile(
        envelope.id,
        blob,
        'document.docx',
        meta
      );
      const savedFileUrl = updated?.file ?? envelope.file;
      if (updated?.file) {
        setEnvelope((current) =>
          current?.id === envelope.id
            ? {
                ...current,
                file: updated.file,
                editor_file: updated.editor_file ?? null
              }
            : current
        );
      }
      const newValues: Record<string, any> = {};
      if (
        savesToField &&
        targetAction?.save_document_field_key &&
        savedFileUrl
      ) {
        newValues[targetAction.save_document_field_key] = savedFileUrl;
      }
      // Document-level bindings write back to form fields of the same name, and
      // ONLY to fields the form already has - a binding in a template is not
      // permission to invent a field. Pushed here with the save rather than on
      // every reconcile: pressing Enter should not cost a network round trip.
      for (const [name, value] of Object.entries(savedBindings)) {
        if (name in fieldValues) newValues[name] = value;
      }
      for (const name of Object.keys(newValues)) {
        if (
          fieldValues[name] === newValues[name] &&
          !(name in pendingWritebackRef.current)
        )
          delete newValues[name];
      }
      if (Object.keys(newValues).length) {
        Object.assign(pendingWritebackRef.current, newValues);
        setFieldValues(newValues, true, true);
        await client.submitCustom(newValues);
        for (const [name, value] of Object.entries(newValues)) {
          if (pendingWritebackRef.current[name] === value)
            delete pendingWritebackRef.current[name];
        }
      }
      setOperationError(null);
      return updated;
    },
    [client, envelope, targetAction, savesToField]
  );

  // The version-history I/O adapter DocxEditor injects into its session hook.
  // Keeps index.tsx free of the Feathery API. Disabled in the designer preview.
  const envelopeId = envelope?.id;
  const restoreOperationRef = useRef<{
    envelopeId: string;
    versionId: string;
    sessionId: string;
  } | null>(null);
  const historyHost = useMemo<DocxHistoryHost | undefined>(() => {
    if (editMode || !envelopeId) return undefined;
    return {
      listVersions: () => client.listEnvelopeVersions(envelopeId),
      getVersion: (versionId) =>
        client.getEnvelopeVersion(envelopeId, versionId),
      closeVersion: (sessionId, payload) =>
        client.closeEnvelopeVersion(envelopeId, sessionId, payload),
      fetchVersionFile: fetchDocumentBytes,
      restoreVersion: async (versionId) => {
        let operation = restoreOperationRef.current;
        if (
          !operation ||
          operation.envelopeId !== envelopeId ||
          operation.versionId !== versionId
        ) {
          operation = { envelopeId, versionId, sessionId: uuidv4() };
          restoreOperationRef.current = operation;
        }
        const updated = await client.restoreEnvelopeVersion(
          envelopeId,
          versionId,
          operation.sessionId
        );
        // Reopen the DOCX the restore made live; the source row's final SFDT
        // can be an older checkpoint than that DOCX.
        setEnvelope((current) =>
          current?.id === envelopeId
            ? {
                ...current,
                file: updated.file,
                editor_file: updated.editor_file ?? null
              }
            : current
        );
        setSourceUrl(envelopeSourceUrl({ ...updated } as Envelope));
        setReloadKey((k) => k + 1);
        restoreOperationRef.current = null;
        return updated.version;
      },
      renameVersion: (versionId, name) =>
        client.renameEnvelopeVersion(envelopeId, versionId, name)
    };
  }, [client, envelopeId, editMode]);

  // Only the signing actions run here; 'download' is handled inside DocxEditor,
  // which saves first and then serves the envelope's public (stripped) copy.
  // The signers sent up with a finalize, the filler flagged on their own rows.
  const signerEntries = useCallback(() => {
    // The field names whoever signs inline. Nobody does on DocuSign - it
    // mails every recipient itself, from the role mappings - so routing to
    // that field would reach someone never listed as a signer.
    const signerKey = signsViaDocusign(targetAction ?? {})
      ? ''
      : targetAction?.envelope_signer_field_key;
    const fillerEmail = signerKey
      ? fieldValues[signerKey]?.toString() ?? ''
      : '';
    // Per-role signers were held back at generation for the same reason, so
    // they go up now, scoped to the document actually on screen. Without
    // any, the shared signer field covers every role instead.
    const roleSigners = (targetAction?.envelope_signers ?? [])
      .filter((entry: any) => entry.document_id === activeDocumentId)
      .map((entry: any) => {
        const email =
          (entry.email ?? fieldValues[entry.field_key])?.toString() ?? '';
        return {
          document_id: entry.document_id,
          ...(entry.role_id ? { role_id: entry.role_id } : {}),
          ...(entry.repeat_index !== undefined
            ? { repeat_index: entry.repeat_index }
            : {}),
          email,
          ...(entry.signer_id?.trim()
            ? { signer_id: entry.signer_id.trim() }
            : {}),
          ...(entry.name ? { name: entry.name } : {}),
          ...(entry.phone ? { phone: entry.phone.toString() } : {}),
          // Flagged entries are the ones this filler opens and signs
          // inline.
          filler:
            entry.filler ??
            (!!fillerEmail && email.toLowerCase() === fillerEmail.toLowerCase())
        };
      });
    return (
      roleSigners.length || !activeDocumentId
        ? roleSigners
        : // role_id left off rather than nulled - the backend rejects an
          // explicit null, and omitting it covers every role.
          [
            {
              document_id: activeDocumentId,
              email: fillerEmail,
              filler: true
            }
          ]
    ).filter((entry: any) => entry.email);
  }, [targetAction, activeDocumentId]);

  const runSigningAction = useCallback(
    async (draft: boolean) => {
      if (!envelope) return;
      let finalized: Record<string, any> | undefined;
      // Both backends need a PDF carrying signature fields, and generation
      // skipped that conversion to keep the docx editable. One-way: this draft
      // stops being editable. Throws so nothing is sent unfinalized. It's also
      // what hands back the signer to open as.
      if (envelope.type === 'docx' && !envelope.signed) {
        const signers = signerEntries();
        finalized = await client.finalizeEnvelope(
          envelope.id,
          signers,
          targetAction?.sign_method
        );
        setFinalizedId(envelope.id);
      }
      // Finalize turned the docx into a signable PDF, but the editor stays
      // until something is actually sent: a failed send or a draft keeps the
      // editor, its error and its Sign button. Then adopt the returned PDF.
      const showSent = (via: 'feathery' | 'docusign') => {
        setSentVia((current) => ({ ...current, [envelope.id]: via }));
        setEnvelope((current) =>
          current && finalized && current.id === envelope.id
            ? {
                ...current,
                file: finalized.file ?? current.file,
                editor_file: finalized.editor_file ?? null,
                type: finalized.type ?? current.type,
                signed: finalized.signed ?? current.signed
              }
            : current
        );
      };

      // Nothing here navigates away, so the outcome is only visible if it's
      // announced.
      const announce = internalState[formId ?? '']?.showEnvelopeOutcome;
      // The overlay viewer fires these from its finalize; a container runs
      // its signing action here, so it reports the same trigger itself.
      // finalizeEnvelope returns a single `file` (envelope_data); the overlay's
      // finalize returns a `files` array. Normalize so the sign trigger carries
      // a file list either way, matching the overlay and DocuSign paths.
      const fireReviewLogic = (result?: Record<string, any> | null) => {
        const normalized =
          result && !result.files && result.file
            ? { ...result, files: [result.file] }
            : result;
        internalState[formId ?? '']?.runDocumentReviewLogic?.(
          buildDocumentReviewTrigger({
            action: targetAction ?? {},
            elementId: containerId ?? '',
            envelopes: [{ envelopeId: envelope.id }],
            envelopeAction: 'sign',
            draft,
            result: normalized
          })
        );
      };

      if (isDocusignSignAction(targetAction ?? {}, 'sign')) {
        // DocuSign has no Feathery sign page: the backend send (or draft) is
        // itself the completion signal.
        const result = await client.finalizeEnvelopeReview(targetAction ?? {}, {
          envelopes: [{ envelopeId: envelope.id }],
          envelopeAction: 'sign',
          draft
        });
        if (!result) throw Error('Failed to send the document to DocuSign');
        if (result.status === 'error') throw Error(result.message);
        if (!draft) showSent('docusign');
        announce?.(
          draft ? 'Saved as Draft' : 'Sent for Signature',
          targetAction?.documents
        );
        await fireReviewLogic(result);
        return;
      }
      // Before the sign page opens: with `redirect` set it navigates away.
      await fireReviewLogic(finalized);

      // A signer id comes back only when the filler signs first. Without one
      // the envelope is someone else's to sign, so there's nothing to open.
      if (!finalized?.signer_id) {
        if (finalized?.invited) {
          showSent('feathery');
          announce?.('Sent for Signature', targetAction?.documents);
        }
        return;
      }
      showSent('feathery');
      const url = getSignUrl(finalized.signer_id, targetAction?.redirect);
      setSignUrls((current) => ({ ...current, [envelope.id]: url }));
      if (targetAction?.redirect) featheryWindow().location.href = url;
      else openTab(url);
    },
    [client, envelope, targetAction, signerEntries, formId, containerId]
  );

  // After a reload the session's signing link is gone. Finalizing a sent PDF
  // again converts and emails nothing; it just hands the filler's link back.
  const reopenSigningPage = useCallback(async () => {
    if (!envelope || openingSigningPageRef.current) return;
    openingSigningPageRef.current = true;
    setOpeningSigningPage(true);
    try {
      setOperationError(null);
      // The button only shows for a Feathery send, whatever the action says now.
      const finalized = await client.finalizeEnvelope(
        envelope.id,
        signerEntries(),
        'feathery'
      );
      if (!finalized?.signer_id) {
        setOperationError('This document is waiting on another signer.');
        return;
      }
      const url = getSignUrl(finalized.signer_id, targetAction?.redirect);
      setSignUrls((current) => ({ ...current, [envelope.id]: url }));
      if (targetAction?.redirect) featheryWindow().location.href = url;
      else openTab(url);
    } catch (e: any) {
      // Signed elsewhere since this loaded: show that instead of the refusal.
      const fresh = documentId
        ? await client.getCurrentEnvelope(documentId).catch(() => null)
        : null;
      if (fresh?.id === envelope.id && fresh.signed) {
        setEnvelope(fresh as Envelope);
        setSourceUrl(envelopeSourceUrl(fresh as Envelope));
        return;
      }
      setOperationError(
        `The signing page could not be opened. ${e?.message ?? ''}`.trim()
      );
    } finally {
      openingSigningPageRef.current = false;
      setOpeningSigningPage(false);
    }
  }, [client, envelope, targetAction, signerEntries, documentId]);

  // 'draft' as the terminal action means Create Draft is the only signing
  // outcome configured; offersDraft puts it in a menu beside Sign instead.
  const runTerminalAction = useCallback(
    () => runSigningAction(terminalAction === 'draft'),
    [runSigningAction, terminalAction]
  );
  const runTerminalActionDraft = useCallback(
    () => runSigningAction(true),
    [runSigningAction]
  );

  // Download and Save-to-field are review actions too. The overlay fires
  // document_review for them from its finalize; the container has no finalize
  // for these, so it reports the same trigger from its own toolbar. (Sign/Draft
  // fire it inside runSigningAction.)
  const fireReviewAction = useCallback(
    (envelopeAction: string, result?: Record<string, any> | null) => {
      if (!envelope) return;
      internalState[formId ?? '']?.runDocumentReviewLogic?.(
        buildDocumentReviewTrigger({
          action: targetAction ?? {},
          elementId: containerId ?? '',
          envelopes: [{ envelopeId: envelope.id }],
          envelopeAction,
          draft: false,
          result
        })
      );
    },
    [envelope, formId, targetAction, containerId]
  );

  // DocxEditor exposes its live SyncFusion instance at this exact lifecycle
  // point. The schema container id is stable for this editor across renders;
  // retain the editor object as well so cleanup can only remove this exact
  // registration, never another mounted container's editor.
  const registeredEditor = useRef<any>(undefined);
  const onEditorReady = useCallback(
    (editor: any) => {
      if (!containerId) return;
      registeredEditor.current = editor;
      registerDocxEditor(containerId, editor, {
        formId,
        stepId,
        documentId: activeDocumentId,
        envelopeId: envelope?.id
      });
    },
    [activeDocumentId, containerId, envelope?.id, formId, stepId]
  );
  // Runs after openAsync resolves — and again on every reload (openNonce), which
  // is the case that matters: the in-memory group wrappers die with the old
  // document, while the customData tags survive in the saved file. Rebinding
  // here is what lets a reloaded document regain its atomic accept groups.
  // Idempotent (already-bound revisions are skipped), so the blank-document
  // firing of this same callback is a harmless no-op.
  const onDocumentReady = useCallback(() => {
    const editor = registeredEditor.current;
    if (!editor || !reviewChanges) return;
    try {
      rebindRevisionGroups(editor);
    } catch {
      // A grouping failure must not break the opened document.
    }
  }, [reviewChanges]);
  // Envelope identity can settle after SyncFusion's created callback. Refresh
  // only the assistant registration; the editor itself stays mounted.
  useEffect(() => {
    if (!containerId || !registeredEditor.current) return;
    registerDocxEditor(containerId, registeredEditor.current, {
      formId,
      stepId,
      documentId: activeDocumentId,
      envelopeId: envelope?.id
    });
  }, [activeDocumentId, containerId, envelope?.id, formId, stepId]);
  useEffect(
    () => () => {
      if (containerId) {
        clearDocxEditorDirty(formId, containerId);
        if (registeredEditor.current) {
          unregisterDocxEditor(containerId, registeredEditor.current, formId);
        }
      }
    },
    [containerId, formId]
  );

  const box = (child: React.ReactNode) => <div css={wrap}>{child}</div>;

  if (editMode) return box(<DocxEditor preview hideDownload />);
  if (!activeDocumentId && !envelope) {
    return box(
      <div css={placeholder}>
        No document yet — generate it to start editing.
      </div>
    );
  }
  if (loading) return box(<div css={placeholder}>Loading document…</div>);
  if (error) {
    return box(<div css={{ ...placeholder, color: '#dc2626' }}>{error}</div>);
  }
  if (!envelope || !envelope.file) {
    return box(
      <div css={placeholder}>
        No document yet — generate it to start editing.
      </div>
    );
  }
  const operationAlert = operationError && (
    <div role='alert' css={{ color: '#b42318', padding: 8 }}>
      {operationError}
    </div>
  );
  // A PDF has no editable docx to open, so show it read-only. Its status is
  // only claimed when it was sent (this session or per the backend) or signed.
  if (envelope.type === 'pdf') {
    const via = sentMethod(envelope, sentVia);
    const awaitingFiller = !envelope.signed && via === 'feathery';
    return box(
      <>
        {operationAlert}
        <SignedEnvelopeView
          pdfUrl={pdfView.current.url ?? envelope.file}
          // A presigned URL is freshest as fetched; a plain one may need the
          // version query to skip a cached copy.
          downloadUrl={
            envelope.file.includes('?')
              ? envelope.file
              : pdfView.current.url ?? envelope.file
          }
          signUrl={awaitingFiller ? signUrls[envelope.id] : undefined}
          // Only after a reload: this session's own send already knows
          // whether there's a page for the filler to open.
          openingSigningPage={openingSigningPage}
          onOpenSigningPage={
            awaitingFiller && !sentVia[envelope.id] && terminalAction === 'sign'
              ? reopenSigningPage
              : undefined
          }
          status={
            envelope.signed
              ? 'signed'
              : via === 'docusign'
              ? 'docusign'
              : via
              ? 'awaiting'
              : null
          }
        />
      </>
    );
  }
  if (envelope.type !== 'docx') {
    return box(
      <div css={placeholder}>
        {`Editing ${envelope.type} documents isn't supported yet.`}
      </div>
    );
  }

  if (!serviceUrl) {
    console.warn(
      'Feathery: document editor serviceUrl is not set — cannot convert/open the .docx'
    );
  }

  return box(
    <>
      {operationAlert}
      <DocxEditor
        source={source}
        envelopeId={envelope.id}
        serviceUrl={serviceUrl}
        headers={serviceHeaders}
        licenseKey={syncfusion.licenseKey}
        readOnly={readOnly}
        reviewChanges={reviewChanges}
        openNonce={reloadKey}
        fileName='document'
        terminalAction={terminalAction}
        onTerminalAction={terminalAction ? runTerminalAction : undefined}
        onTerminalActionDraft={offersDraft ? runTerminalActionDraft : undefined}
        // Signing needs a signer to open as, which only finalizing an unsigned
        // envelope hands back - so there's nothing behind the button once signed.
        terminalActionDisabled={!envelope.file || envelope.signed}
        // Without this a failed send is swallowed: DocxEditor routes terminal
        // errors here and there is nothing else listening.
        onError={setOperationError}
        onBeforeReplaceReady={registerBeforeReplace}
        // Download shows only when the toolbar config offers it, and never in
        // the save-to-field flow: there the document's destination is a form
        // field (set on every save), not the user's machine.
        hideDownload={savesToField || !offersDownload}
        // Downloads serve the stripped public copy, never the editor bytes —
        // content controls must not leave the platform.
        downloadUrl={envelope.file}
        bindings={{
          enabled: bindingsEnabled,
          onFieldValues: (values) => {
            bindingValuesRef.current = values;
          }
        }}
        onSave={saveEnvelope}
        history={historyHost}
        // A completed Save is the container's Save-to-field review action; a
        // completed Download is the download action. Only fire when the toolbar
        // config actually offers that outcome.
        onSaved={
          savesToField
            ? (result) =>
                fireReviewAction(
                  'save',
                  result?.file ? { files: [result.file] } : null
                )
            : undefined
        }
        onDownloaded={
          offersDownload
            ? () =>
                fireReviewAction(
                  'download',
                  envelope.file ? { files: [envelope.file] } : null
                )
            : undefined
        }
        // readOnly editors never dirty, so skip registering them entirely
        onChange={
          !readOnly && containerId
            ? (dirty: boolean) => setDocxEditorDirty(formId, containerId, dirty)
            : undefined
        }
        onEditorReady={onEditorReady}
        onReady={onDocumentReady}
        // Server-side docx→pdf conversion (doc-conversion Lambda); does not
        // persist anything — the envelope stays an editable docx.
        onExportPdf={() => client.downloadEnvelopePdf(envelope.id)}
      />
    </>
  );
}
