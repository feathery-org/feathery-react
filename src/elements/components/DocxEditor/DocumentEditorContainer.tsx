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
} from '../../../assistant/tools/docx/docxEditorRegistry';
import { rebindRevisionGroups } from '../../../utils/documentEditorPrimitives';
import { clearDocxEditorDirty, setDocxEditorDirty } from './docxDirtyRegistry';
import {
  attachTokenCycle,
  saveBlockers,
  tokenFieldSignature
} from '../../../documentTokens/tokenCycle';
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
// SyncFusion's editor root carries this class; its keyboard focus lands on a
// hidden `.e-de-text-target` iframe inside it. Testing against the class rather
// than one component's own element means focus tracking stays correct when two
// document editors are mounted on the same step — the other editor's hidden
// input is recognised as document surface, not mistaken for a form field.
const EDITOR_SURFACE_SELECTOR = '.e-documenteditor';
const inDocumentEditor = (el: Element | null | undefined): boolean =>
  !!(
    el &&
    typeof el.closest === 'function' &&
    el.closest(EDITOR_SURFACE_SELECTOR)
  );

const focusedFormInput = (): HTMLElement | null => {
  const active = featheryDoc()?.activeElement as HTMLElement | null;
  if (!active) return null;
  const tag = active.tagName;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !active.isContentEditable) {
    return null;
  }
  if (inDocumentEditor(active)) return null;
  return active;
};

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
  },
  rowCount: (source) => {
    const value = fieldValues[source];
    if (Array.isArray(value)) return value.length;
    // A repeated field holds a bare scalar before any repeat exists, which is
    // one row; nothing at all is no rows.
    return value === undefined || value === null ? 0 : 1;
  },
  removeRow: (sources, index) => {
    const next: Record<string, any> = {};
    for (const source of sources) {
      const value = fieldValues[source];
      if (!Array.isArray(value)) continue;
      if (index < 0 || index >= value.length) continue;
      // A splice, not a blank: the rows below move up, which is what the
      // document just did when the row was deleted.
      next[source] = [...value.slice(0, index), ...value.slice(index + 1)];
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
  editMode,
  assistantEnabled
}: {
  containerId?: string;
  formId?: string;
  stepId?: string;
  editMode?: boolean;
  assistantEnabled?: boolean;
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
  const reviewChanges = !!assistantEnabled && !readOnly;
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
      // A token that fails validation — or whose formula cannot evaluate and
      // is showing its 0 fallback — must not reach the envelope.
      const state = tokenCycle.current?.getState();
      const blocked = state ? saveBlockers(state) : null;
      if (blocked) {
        setError(blocked);
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
      tokenCycle.current?.detach();
      tokenCycle.current = undefined;
      if (containerId) {
        clearDocxEditorDirty(formId, containerId);
        if (registeredEditor.current) {
          unregisterDocxEditor(containerId, registeredEditor.current, formId);
        }
      }
    },
    [containerId, formId]
  );

  // The form rerenders every consumer when a field changes, so this component
  // re-renders too — reconciling on render is what carries a field edit into
  // the document. Most renders touch nothing the plan reads, and reconcile
  // walks the whole control collection, so a signature over just the fields
  // the plan reads decides whether this render owes a pass.
  //
  // Except while a form input has focus. Writing into the document steals
  // focus, so a field edited character by character — a number cleared before
  // the new one is typed — loses the caret on the first keystroke. Reconcile
  // is idempotent, so waiting for that input's blur costs nothing but the
  // document lagging one field behind, which is where the caret already is.
  // Not a timer: a debounce would rewrite mid-word again, just later.
  const lastReconciled = useRef<string | undefined>(undefined);
  // The form input the user was last in (element + caret). Writing into the
  // document steals focus to the editor's hidden input; after a form-triggered
  // reconcile we hand focus back here so editing a value never strands the
  // caret in the document.
  const lastFormInput = useRef<{
    el: HTMLElement;
    start: number | null;
    end: number | null;
  } | null>(null);
  // True only across a reconcile we triggered. Lets the focusin listener tell a
  // write's focus grab (keep the remembered field, restore it) apart from a
  // real click into the document (forget the field, the user wants the doc).
  const reconciling = useRef(false);
  // The deferred reconcile runs on a macrotask/frame; if the component unmounts
  // (or the step navigates away) before it fires it would reconcile a detached
  // editor and touch a torn-down DOM. Track the pending handles and a mounted
  // flag so they can be cancelled and short-circuited.
  const mounted = useRef(true);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFrame = useRef<number | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (pendingTimer.current !== null) clearTimeout(pendingTimer.current);
      if (pendingFrame.current !== null)
        cancelAnimationFrame(pendingFrame.current);
    };
  }, []);

  // Remember the last focused FORM input; forget it when the user deliberately
  // moves focus into the document.
  useEffect(() => {
    const doc = featheryDoc();
    if (!doc) return undefined;
    const onFocusIn = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (inDocumentEditor(target)) {
        if (!reconciling.current) lastFormInput.current = null;
        return;
      }
      const tag = target.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !target.isContentEditable) {
        return;
      }
      const input = target as HTMLInputElement;
      const hasCaret = typeof input.selectionStart === 'number';
      lastFormInput.current = {
        el: target,
        start: hasCaret ? input.selectionStart : null,
        end: hasCaret ? input.selectionEnd : null
      };
    };
    doc.addEventListener('focusin', onFocusIn, true);
    return () => doc.removeEventListener('focusin', onFocusIn, true);
  }, []);

  // Reconcile, then — if the write pulled focus into the document — hand it
  // back to the form input the user was in. Reading lastFormInput at restore
  // time (not reconcile time) survives the transient BODY focus a Tab passes
  // through. A user who clicked into the document cleared lastFormInput above,
  // so this never yanks them out of it.
  // Deferred to a macrotask: a synchronous reconcile writes into the document
  // and steals focus to the editor mid-transition, which preempts the browser's
  // own Tab move to the next field. Deferring lets that move land first (the
  // focusin listener records the field the user tabbed to), then reconcile
  // briefly grabs the editor and restore hands focus back to that field.
  const reconcileKeepingFormFocus = useCallback((cycle: TokenCycle) => {
    pendingTimer.current = setTimeout(() => {
      pendingTimer.current = null;
      // Bail if the component unmounted or a newer editor superseded this cycle
      // between scheduling and now — reconciling a detached editor would throw
      // and touch a torn-down DOM.
      if (!mounted.current || tokenCycle.current !== cycle) return;
      reconciling.current = true;
      const doc = featheryDoc();
      const restore = () => {
        const target = lastFormInput.current;
        const active = doc?.activeElement as HTMLElement | null;
        // Only reclaim focus if the write pulled it into a document editor;
        // never override a user who deliberately clicked into the document
        // (that path cleared lastFormInput).
        if (!inDocumentEditor(active) || !target?.el?.isConnected) return;
        try {
          target.el.focus({ preventScroll: true });
          const input = target.el as HTMLInputElement;
          if (
            target.start != null &&
            typeof input.setSelectionRange === 'function'
          ) {
            input.setSelectionRange(target.start, target.end);
          }
        } catch {
          /* focus is best-effort */
        }
      };
      try {
        cycle.reconcile();
        restore();
      } catch (err) {
        // Reconcile drives private SyncFusion surface, which can throw in ways
        // no test reaches. A failure must not leave `reconciling` stuck true —
        // that would permanently disable the "don't yank focus from a document
        // click" guard for the rest of the session.
        // eslint-disable-next-line no-console
        console.warn('[feathery] token reconcile failed', err);
      } finally {
        pendingFrame.current = requestAnimationFrame(() => {
          pendingFrame.current = null;
          restore();
          reconciling.current = false;
        });
      }
    }, 0);
  }, []);

  useEffect(() => {
    const cycle = tokenCycle.current;
    if (!cycle) return undefined;
    const signature = tokenFieldSignature(
      cycle.getState().specs,
      (key) => fieldValues[key]
    );
    if (signature === lastReconciled.current) return undefined;
    const editing = focusedFormInput();
    if (!editing) {
      // No form input focused now — but a Tab out of a field passes through
      // BODY to the next field, and that transient lands here. reconcile keeps
      // form focus using the remembered field, so this path no longer strands
      // the caret in the document. A write from editing the document itself
      // also lands here; reconciling.current gates the focusin listener so it
      // won't fight the user.
      lastReconciled.current = signature;
      reconcileKeepingFormFocus(cycle);
      return undefined;
    }
    // A field has focus and its value already changed — the user is typing.
    // Writing now would rewrite mid-word and steal the caret, so wait for the
    // field's blur (idempotent reconcile; the document lags one field, which is
    // where the caret already is).
    const onBlur = () => {
      lastReconciled.current = tokenFieldSignature(
        cycle.getState().specs,
        (key) => fieldValues[key]
      );
      reconcileKeepingFormFocus(cycle);
    };
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
      reviewChanges={reviewChanges}
      openNonce={reloadKey}
      fileName='document'
      terminalAction={terminalAction}
      onTerminalAction={terminalAction ? runTerminalAction : undefined}
      terminalActionDisabled={!envelope.file}
      // Save-to-field flow: the document's destination is a form field (set
      // on every save), not the user's machine — no Download button.
      hideDownload={targetAction?.envelope_action === 'save'}
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
