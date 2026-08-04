import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import DocxEditor from './index';
import FeatheryClient, { API_URL } from '../../../utils/featheryClient';
import { featheryDoc, featheryWindow, openTab } from '../../../utils/browser';
import { fieldValues, initState, setFieldValues } from '../../../utils/init';
import { ACTION_GENERATE_ENVELOPES } from '../../../utils/elementActions';
import { getSignUrl } from '../../../utils/document';
import {
  registerDocxEditor,
  unregisterDocxEditor
} from '../../../assistant/tools/docxEditorRegistry';
import { attachTokenCycle } from '../../../documentTokens/tokenCycle';
import type {
  FieldAccess,
  TokenCycle
} from '../../../documentTokens/tokenCycle';
import TokenPanel, {
  tokenPanelEnabled
} from '../../../documentTokens/TokenPanel';

// Syncfusion's public test converter. Used ONLY in a local build: document
// content is uploaded to a third party, which is fine for synthetic fixtures
// and never for customer envelopes. Production goes through the Feathery
// backend proxy, which fronts the self-hosted Word Processor.
const SYNCFUSION_TEST_SERVICE_URL =
  'https://document.syncfusion.com/web-services/docx-editor/api/documenteditor/';

const isLocalBuild = process.env.BACKEND_ENV === 'local';

/**
 * The form input the user is typing in, or null when focus is anywhere else.
 *
 * Anything inside the editor is excluded: Syncfusion takes keystrokes through
 * a hidden input of its own, so the document's own caret would otherwise look
 * like a form field being edited and block the writes entirely.
 */
const focusedFormInput = (editorElement?: Element | null): HTMLElement | null => {
  const active = featheryDoc()?.activeElement as HTMLElement | null;
  if (!active) return null;
  const tag = active.tagName;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !active.isContentEditable) {
    return null;
  }
  if (editorElement?.contains(active)) return null;
  return active;
};

/** A token's value key: one per token per row. */
const valueKeyOf = (spec: any): string =>
  spec.index === undefined || spec.index === null
    ? spec.id
    : `${spec.id}__${spec.index}`;

/**
 * Token access to the form's field values.
 *
 * The single owner of a field-backed token's value is the form engine, so this
 * reads straight from `fieldValues` and writes through `setFieldValues` — the
 * same path a rendered input uses, which submits the value and rerenders every
 * form. A repeated field is one key holding an array indexed by row; the same
 * key holds a bare scalar before any repeat exists, so a scalar is treated as
 * row 0 and a token stays bound either way.
 */
const formFieldAccess: FieldAccess = {
  read: (spec) => {
    if (!spec.source) return undefined;
    const value = fieldValues[spec.source];
    const row = spec.index ?? 0;
    if (Array.isArray(value)) return value[row];
    return row === 0 ? (value as any) : undefined;
  },
  write: (updates) => {
    const next: Record<string, any> = {};
    for (const { spec, value } of updates) {
      if (!spec.source) continue;
      if (spec.index === undefined || spec.index === null) {
        next[spec.source] = value;
        continue;
      }
      // Start from the existing rows so writing one never clobbers another.
      const existing = next[spec.source] ?? fieldValues[spec.source];
      const rows = Array.isArray(existing)
        ? [...existing]
        : existing === undefined || existing === null
        ? []
        : [existing];
      rows[spec.index] = value;
      next[spec.source] = rows;
    }
    if (Object.keys(next).length > 0) setFieldValues(next);
  }
};

// The container carries no document. Its document is owned by the Generate
// Documents button that targets it: find the action whose view_draft_container
// matches this container and use its first document. Scans loaded form schemas
// (container ids are unique, so no need to know the form key).
function resolveTargetAction(
  containerId?: string
): Record<string, any> | undefined {
  if (!containerId) return undefined;
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
            action?.view_draft_container === containerId
          ) {
            return action;
          }
        }
      }
    }
  }
  return undefined;
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
  editMode
}: {
  containerId?: string;
  formId?: string;
  stepId?: string;
  editMode?: boolean;
}) {
  // saveEnvelopeFile/getCurrentEnvelope only use initInfo(), not the form key,
  // so a lightweight client instance is sufficient here.
  const client = useMemo(() => new FeatheryClient(), []);
  const pendingDraft = useMemo(
    () => getPendingDraft(containerId),
    [containerId]
  );
  const targetAction = useMemo(
    () => resolveTargetAction(containerId),
    [containerId]
  );
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
  const serviceUrl =
    syncfusion.serviceUrl ||
    (isLocalBuild ? SYNCFUSION_TEST_SERVICE_URL : `${API_URL}document/editor/`);
  // Read initState directly instead of initInfo() — initInfo() throws when the
  // SDK isn't initialized, but in editMode (designer preview, tests) this
  // component renders a placeholder and never needs the key.
  const { sdkKey } = initState;
  const serviceHeaders = useMemo(() => {
    if (syncfusion.headers) return syncfusion.headers;
    // Never send a Feathery token to Syncfusion's public test service.
    if (isLocalBuild && !syncfusion.serviceUrl) return [];
    if (sdkKey) return [{ Authorization: `Token ${sdkKey}` }];
    return [];
  }, [sdkKey, syncfusion.headers, syncfusion.serviceUrl]);

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
  // `view_draft_read_only` (default: editable).
  const actionReadOnly =
    typeof targetAction?.view_draft_read_only === 'boolean'
      ? targetAction.view_draft_read_only
      : false;
  const finalized = !!envelope && envelope.id === finalizedId;
  const readOnly = !!envelope?.signed || !!actionReadOnly || finalized;
  const terminalAction = targetAction
    ? !targetAction.envelope_action || targetAction.envelope_action === 'sign'
      ? 'sign'
      : targetAction.envelope_action === 'download'
      ? 'download'
      : undefined
    : undefined;

  const saveEnvelope = useCallback(
    async (blob: Blob) => {
      if (!envelope) return;
      // A token that fails its own validation must not reach the envelope —
      // these documents are financial or legal, so a bad number is worse
      // than an unsaved edit.
      const invalid = tokenCycle.current?.getState().invalid;
      if (invalid && invalid.size > 0) {
        const summary = [...invalid.entries()]
          .map(([id, reason]) => `${id}: ${reason}`)
          .join(', ');
        setError(`Cannot save — ${invalid.size} token(s) invalid. ${summary}`);
        return;
      }
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
      if (
        targetAction?.envelope_action === 'save' &&
        targetAction.save_document_field_key &&
        savedFileUrl
      ) {
        const newValues = {
          [targetAction.save_document_field_key]: savedFileUrl
        };
        setFieldValues(newValues, true, true);
        await client.submitCustom(newValues);
      }
      return updated;
    },
    [client, envelope, targetAction]
  );

  // Only the sign action is handled here — the download action downloads the
  // freshly-saved bytes directly in DocxEditor, so it never re-fetches a
  // (possibly cache-stale) envelope file URL.
  const runTerminalAction = useCallback(async () => {
    if (terminalAction !== 'sign') return;
    // The sign ceremony expects a PDF with signature fields. Generation
    // skipped that conversion so the docx stayed editable — run it now,
    // against the just-saved edits (DocxEditor saves before this fires).
    // One-way: this draft stops being editable; regenerating produces a
    // fresh editable one. Throws on failure so the sign page never opens
    // against an unfinalized envelope.
    if (envelope && envelope.type === 'docx' && !envelope.signed) {
      const signerKey = targetAction?.envelope_signer_field_key;
      const signer = signerKey ? fieldValues[signerKey] : undefined;
      await client.finalizeEnvelope(envelope.id, signer?.toString() ?? '');
      setFinalizedId(envelope.id);
    }
    const url = getSignUrl(targetAction?.redirect);
    if (targetAction?.redirect) featheryWindow().location.href = url;
    else openTab(url);
  }, [client, envelope, targetAction, terminalAction]);

  // DocxEditor exposes its live SyncFusion instance at this exact lifecycle
  // point. The schema container id is stable for this editor across renders;
  // retain the editor object as well so cleanup can only remove this exact
  // registration, never another mounted container's editor.
  const registeredEditor = useRef<any>(undefined);
  const tokenCycle = useRef<TokenCycle | undefined>(undefined);
  // Dev-only token inspector; nothing renders unless the flag is set.
  const [tokenPanelCycle, setTokenPanelCycle] = useState<TokenCycle>();
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
      // Linked tokens keep themselves up to date from here on. Inert for a
      // document that declares none; the cycle re-reads on documentChange,
      // because the editor is ready before its .docx has loaded.
      tokenCycle.current?.detach();
      tokenCycle.current = attachTokenCycle(editor, {
        fields: formFieldAccess
      });
      if (tokenPanelEnabled(featheryWindow())) {
        setTokenPanelCycle(tokenCycle.current);
      }
    },
    [activeDocumentId, containerId, envelope?.id, formId, stepId]
  );
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
      tokenCycle.current?.detach();
      tokenCycle.current = undefined;
      if (containerId && registeredEditor.current) {
        unregisterDocxEditor(containerId, registeredEditor.current, formId);
      }
    },
    [containerId, formId]
  );

  // The form rerenders every consumer when a field changes, so this component
  // re-renders too — reconciling on every render is what carries a field edit
  // into the document. It derives from current values and writes only what the
  // document does not already show, so running it unconditionally is both
  // cheaper to reason about than a change signature and impossible to miss.
  //
  // Except while a form input has focus. Writing into the document steals
  // focus, so a field edited character by character — a number cleared before
  // the new one is typed — loses the caret on the first keystroke. Reconcile
  // is idempotent, so waiting for that input's blur costs nothing but the
  // document lagging one field behind, which is where the caret already is.
  // Not a timer: a debounce would rewrite mid-word again, just later.
  useEffect(() => {
    const editing = focusedFormInput(registeredEditor.current?.element);
    if (!editing) {
      tokenCycle.current?.reconcile();
      return undefined;
    }
    const onBlur = () => tokenCycle.current?.reconcile();
    editing.addEventListener('blur', onBlur, { once: true });
    return () => editing.removeEventListener('blur', onBlur);
  });

  const box = (child: React.ReactNode) => (
    <div css={wrap}>
      {child}
      {tokenPanelCycle && <TokenPanel cycle={tokenPanelCycle} />}
    </div>
  );

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
      openNonce={reloadKey}
      fileName='document'
      terminalAction={terminalAction}
      onTerminalAction={terminalAction ? runTerminalAction : undefined}
      terminalActionDisabled={!envelope.file}
      // Save-to-field flow: the document's destination is a form field (set
      // on every save), not the user's machine — no Download button.
      hideDownload={targetAction?.envelope_action === 'save'}
      onSave={saveEnvelope}
      onEditorReady={onEditorReady}
      // Server-side docx→pdf conversion (doc-conversion Lambda); does not
      // persist anything — the envelope stays an editable docx.
      onExportPdf={() => client.downloadEnvelopePdf(envelope.id)}
    />
  );
}
