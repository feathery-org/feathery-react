import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import DocxEditor from './index';
import FeatheryClient, { API_URL } from '../../../utils/featheryClient';
import { featheryWindow, openTab } from '../../../utils/browser';
import { fieldValues, initState, setFieldValues } from '../../../utils/init';
import internalState from '../../../utils/internalState';
import { ACTION_GENERATE_ENVELOPES } from '../../../utils/elementActions';
import {
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
  document?: string;
  type: string;
  signed: boolean;
}

interface RefreshEventDetail {
  containerId?: string;
  documents?: string[];
  envelopes?: Envelope[];
}

// Fired by the Generate Documents action targeting this container so an
// already mounted editor reloads the freshly generated envelope.
const REFRESH_EVENT = 'feathery-docx-editor-refresh';
const PENDING_DRAFTS_KEY = '__featheryDocxEditorDrafts';

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
      (targetAction?.documents ?? [])[0] ??
      pendingDraft?.documents?.[0] ??
      pendingDraft?.envelopes?.[0]?.document,
    [targetAction, pendingDraft]
  );
  const [envelope, setEnvelope] = useState<Envelope | null>(
    () => getGeneratedEnvelope(pendingDraft, documentId) ?? null
  );
  const [sourceUrl, setSourceUrl] = useState<string | undefined>(
    () => getGeneratedEnvelope(pendingDraft, documentId)?.file ?? undefined
  );
  const [loading, setLoading] = useState(!envelope);
  const [error, setError] = useState<string | null>(null);
  // Bumped to force the editor to reload its source after a (re)generate.
  // NOT bumped on save (so saving doesn't reload the document out from under
  // the user).
  const [reloadKey, setReloadKey] = useState(0);
  // Envelope that was finalized for signing (docx → signable PDF) this
  // session. Keyed by id so a regenerated envelope is editable again without
  // any reset wiring.
  const [finalizedId, setFinalizedId] = useState<string | null>(null);

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

  const loadEnvelope = useCallback(async () => {
    if (!documentId) return;
    try {
      const env = await client.getCurrentEnvelope(documentId);
      const nextEnvelope = env && env.id ? (env as Envelope) : null;
      setEnvelope(nextEnvelope);
      setSourceUrl(nextEnvelope?.file ?? undefined);
      setError(null);
    } catch (e: any) {
      console.error('Feathery: failed to load current envelope', e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [documentId, client]);

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
      setSourceUrl(pendingEnvelope.file ?? undefined);
      setLoading(false);
      return;
    }
    loadEnvelope();
  }, [containerId, documentId, editMode, loadEnvelope]);

  useEffect(() => {
    if (editMode) return undefined;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<RefreshEventDetail>).detail;
      if (
        detail?.containerId &&
        containerId &&
        detail.containerId !== containerId
      ) {
        return;
      }

      const generatedEnvelope = getGeneratedEnvelope(detail, documentId);
      if (generatedEnvelope?.id) {
        setEnvelope(generatedEnvelope);
        setSourceUrl(generatedEnvelope.file ?? undefined);
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
  const { terminalAction, offersDraft, savesToField } =
    containerToolbarOutcomes(targetAction ?? {});
  const reviewChanges = !!assistantEnabled && !readOnly;

  // Opt-in, and off unless a host asks for it: window.featherySyncfusion.bindings
  // rides the same config object that already carries serviceUrl and licenseKey.
  const bindingsEnabled = syncfusion.bindings === true;
  // The most recent committed document-field values, read at save time.
  const bindingValuesRef = useRef<Record<string, string>>({});

  const saveEnvelope = useCallback(
    async (blob: Blob) => {
      if (!envelope) return;
      const updated = await client.saveEnvelopeFile(
        envelope.id,
        blob,
        'document.docx'
      );
      const savedFileUrl = updated?.file ?? envelope.file;
      if (updated?.file) {
        setEnvelope((current) =>
          current?.id === envelope.id
            ? { ...current, file: updated.file }
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
      for (const [name, value] of Object.entries(bindingValuesRef.current)) {
        if (name in fieldValues) newValues[name] = value;
      }
      if (Object.keys(newValues).length) {
        setFieldValues(newValues, true, true);
        await client.submitCustom(newValues);
      }
      return updated;
    },
    [client, envelope, targetAction, savesToField]
  );

  // Only the signing actions run here; 'download' is handled inside DocxEditor,
  // which downloads the just-saved bytes rather than re-fetching a cache-stale
  // envelope URL.
  const runSigningAction = useCallback(
    async (draft: boolean) => {
      if (!envelope) return;
      const viaDocusign = signsViaDocusign(targetAction ?? {});
      // The field names whoever signs inline. Nobody does on DocuSign - it
      // mails every recipient itself, from the role mappings - so routing to
      // that field would reach someone never listed as a signer.
      const signerKey = viaDocusign
        ? ''
        : targetAction?.envelope_signer_field_key;
      const fillerEmail = signerKey
        ? fieldValues[signerKey]?.toString() ?? ''
        : '';
      let finalized: Record<string, any> | undefined;
      // Both backends need a PDF carrying signature fields, and generation
      // skipped that conversion to keep the docx editable. One-way: this draft
      // stops being editable. Throws so nothing is sent unfinalized. It's also
      // what hands back the signer to open as.
      if (envelope.type === 'docx' && !envelope.signed) {
        // Per-role signers were held back at generation for the same reason, so
        // they go up now, scoped to the document actually on screen. Without
        // any, the shared signer field covers every role instead.
        const roleSigners = (targetAction?.envelope_signers ?? [])
          .filter((entry: any) => entry.document_id === activeDocumentId)
          .map((entry: any) => {
            const email = fieldValues[entry.field_key]?.toString() ?? '';
            return {
              document_id: entry.document_id,
              role_id: entry.role_id,
              email,
              // Flagged entries are the ones this filler opens and signs
              // inline.
              filler:
                !!fillerEmail &&
                email.toLowerCase() === fillerEmail.toLowerCase()
            };
          });
        const signers = (
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
        finalized = await client.finalizeEnvelope(
          envelope.id,
          signers,
          targetAction?.sign_method
        );
        setFinalizedId(envelope.id);
      }

      // Nothing here navigates away, so the outcome is only visible if it's
      // announced.
      const announce = internalState[formId ?? '']?.showEnvelopeOutcome;

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
        announce?.(
          draft ? 'Saved as Draft' : 'Sent for Signature',
          targetAction?.documents
        );
        return;
      }

      // A signer id comes back only when the filler signs first. Without one
      // the envelope is someone else's to sign, so there's nothing to open.
      if (!finalized?.signer_id) {
        if (finalized?.invited)
          announce?.('Sent for Signature', targetAction?.documents);
        return;
      }
      const url = getSignUrl(finalized.signer_id, targetAction?.redirect);
      if (targetAction?.redirect) featheryWindow().location.href = url;
      else openTab(url);
    },
    [client, envelope, targetAction, activeDocumentId, formId]
  );

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

  if (editMode) return box(<div css={placeholder}>Document editor</div>);
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
    <DocxEditor
      source={source}
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
      onError={setError}
      // Save-to-field flow: the document's destination is a form field (set
      // on every save), not the user's machine — no Download button.
      hideDownload={savesToField}
      bindings={{
        enabled: bindingsEnabled,
        onFieldValues: (values) => {
          bindingValuesRef.current = values;
        }
      }}
      onSave={saveEnvelope}
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
  );
}
