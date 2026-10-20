import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { v4 as uuidv4 } from 'uuid';
import DocxEditor, { DocxEditorProps } from './index';
import {
  EditorEnvelope as Envelope,
  envelopeSourceUrl
} from '../DocumentEditor/documentPacket';
import FeatheryClient, { API_URL } from '../../../utils/featheryClient';
import SignedEnvelopeView from './SignedEnvelopeView';
import { documentSigners } from './documentSigners';
import useRefreshOnFocus from '../../../utils/useRefreshOnFocus';
import { featheryWindow, openTab } from '../../../utils/browser';
import { fieldValues, initState, setFieldValues } from '../../../utils/init';
import { containerToolbarOutcomes, getSignUrl } from '../../../utils/document';
import {
  registerDocxEditor,
  unregisterDocxEditor
} from '../../../assistant/tools/docx/docxEditorRegistry';
import { rebindRevisionGroups } from '../../../utils/documentEditorPrimitives';
import { clearDocxEditorDirty, setDocxEditorDirty } from './docxDirtyRegistry';
import { DocxHistoryHost, DocxSaveMeta } from './history/types';
import { fetchDocumentBytes } from '../../../utils/documentPersistence';

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
export interface DocxDocumentSessionHandle {
  save: () => Promise<unknown>;
  envelope: () => Envelope;
  updateEnvelope: (value: Envelope) => void;
  markFinalized: () => void;
  showSent: (value: Envelope, signUrl?: string) => void;
}

export default function DocxDocumentSession({
  containerId,
  formId,
  stepId,
  assistantEnabled,
  targetAction,
  client,
  initialEnvelope,
  initialSigning,
  documentId,
  label,
  active,
  multiple,
  onDirty,
  railPanel,
  onRailPanelChange,
  onEnvelopeChange,
  onSessionReady,
  onSaveAll,
  onDownloadAll,
  onDocumentSign,
  onDocumentSaved,
  onDocumentDownloaded
}: {
  containerId?: string;
  formId?: string;
  stepId?: string;
  assistantEnabled?: boolean;
  targetAction?: Record<string, any>;
  client: FeatheryClient;
  initialEnvelope: Envelope;
  initialSigning?: { sent: boolean; signUrl?: string };
  documentId?: string;
  label: string;
  active: boolean;
  multiple: boolean;
  onDirty: (dirty: boolean) => void;
  railPanel?: DocxEditorProps['railPanel'];
  onRailPanelChange?: DocxEditorProps['onRailPanelChange'];
  onEnvelopeChange: (value: Envelope) => void;
  onSessionReady: (
    id: string,
    handle: DocxDocumentSessionHandle | null
  ) => void;
  onSaveAll?: () => Promise<void>;
  onDownloadAll?: () => Promise<void>;
  onDocumentSign: (envelopeId: string, draft: boolean) => Promise<void>;
  onDocumentSaved: (value: Envelope) => Promise<void>;
  onDocumentDownloaded: (value: Envelope) => void;
}) {
  const editMode = false;
  const [envelope, updateEnvelope] = useState(initialEnvelope);
  const [finalizedForSigning, setFinalizedForSigning] = useState(false);
  const finalizedRef = useRef(false);
  const [sentThisSession, setSentThisSession] = useState(
    !!initialSigning?.sent
  );
  const [signUrl, setSignUrl] = useState(initialSigning?.signUrl);
  const [openingSigningPage, setOpeningSigningPage] = useState(false);
  const openingSigningPageRef = useRef(false);
  const envelopeRef = useRef(envelope);
  envelopeRef.current = envelope;
  const setEnvelope = useCallback(
    (update: Envelope | ((value: Envelope) => Envelope)) => {
      const value =
        typeof update === 'function' ? update(envelopeRef.current) : update;
      envelopeRef.current = value;
      updateEnvelope(value);
      onEnvelopeChange(value);
    },
    [onEnvelopeChange]
  );
  const [sourceUrl, setSourceUrl] = useState(
    envelopeSourceUrl(initialEnvelope)
  );
  const [reloadKey, setReloadKey] = useState(0);
  const [operationError, setOperationError] = useState<string | null>(null);
  const beforeReplaceRef = useRef<(() => Promise<unknown>) | null>(null);
  const registerBeforeReplace = useCallback(
    (save: (() => Promise<unknown>) | null) => {
      beforeReplaceRef.current = save;
    },
    []
  );
  useEffect(() => {
    onSessionReady(initialEnvelope.id, {
      save: () => {
        if (envelopeRef.current.type !== 'docx' || finalizedRef.current)
          return Promise.resolve();
        if (!beforeReplaceRef.current)
          throw new Error(`${label} is still loading. Please retry.`);
        return beforeReplaceRef.current();
      },
      envelope: () => envelopeRef.current,
      updateEnvelope: setEnvelope,
      markFinalized: () => {
        finalizedRef.current = true;
        setFinalizedForSigning(true);
      },
      showSent: (value, url) => {
        setSentThisSession(true);
        setSignUrl(url);
        setEnvelope(value);
      }
    });
    return () => onSessionReady(initialEnvelope.id, null);
  }, [initialEnvelope.id, label, onSessionReady, setEnvelope]);
  const finalized = envelope.type !== 'docx' || finalizedForSigning;

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
  const readOnly = !!envelope?.signed || !!actionReadOnly || finalized;
  // The outcomes this container offers, read from `editor_toolbar_actions` —
  // the same key the overlay editor uses. See containerToolbarOutcomes.
  const { terminalAction, offersDraft, offersDownload, savesToField } =
    containerToolbarOutcomes(targetAction ?? {});
  const reviewChanges = !!assistantEnabled && !readOnly;

  const sentVia = envelope.sent ? envelope.sent_via ?? 'feathery' : undefined;
  const awaitingFiller =
    envelope.type === 'pdf' && !envelope.signed && sentVia === 'feathery';
  const refreshSignedEnvelope = useCallback(async () => {
    if (!activeDocumentId) return;
    try {
      const fresh = await client.getCurrentEnvelope(activeDocumentId);
      if (fresh?.id === envelopeRef.current.id) {
        // The current-envelope response may omit sent/provider metadata.
        // Keep what finalize established while accepting fresh file/signature
        // state; returning from the signing page does not itself complete it.
        setEnvelope((current) => ({ ...current, ...fresh }));
      }
    } catch {
      // A failed background refresh keeps the currently displayed PDF.
    }
  }, [activeDocumentId, client, setEnvelope]);
  useRefreshOnFocus(refreshSignedEnvelope, active && awaitingFiller);

  // Signing can overwrite a plain URL; a changed signed state must reload it.
  const pdfView = useRef({
    key: '',
    raw: null as string | null,
    url: null as string | null,
    version: 0
  });
  const pdfKey = `${envelope.file?.split('?')[0] ?? ''}|${!!envelope.signed}`;
  if (pdfView.current.key !== pdfKey) {
    const raw = envelope.file;
    const version = pdfView.current.version + 1;
    const reused = !!raw && raw === pdfView.current.raw && !raw.includes('?');
    pdfView.current = {
      key: pdfKey,
      raw,
      version,
      url: reused ? `${raw}?v=${version}` : raw
    };
  }

  const reopenSigningPage = useCallback(async () => {
    if (openingSigningPageRef.current) return;
    openingSigningPageRef.current = true;
    setOpeningSigningPage(true);
    try {
      setOperationError(null);
      const result = await client.finalizeEnvelope(
        envelope.id,
        documentSigners(targetAction, activeDocumentId, fieldValues),
        'feathery',
        { individualSigning: true }
      );
      if (!result?.signer_id) {
        setOperationError('This document is waiting on another signer.');
        return;
      }
      const url = getSignUrl(result.signer_id, targetAction?.redirect);
      setSignUrl(url);
      if (targetAction?.redirect) featheryWindow().location.href = url;
      else openTab(url);
    } catch (error: any) {
      const fresh = activeDocumentId
        ? await client.getCurrentEnvelope(activeDocumentId).catch(() => null)
        : null;
      if (fresh?.id === envelope.id && fresh.signed) {
        setEnvelope(fresh);
        return;
      }
      setOperationError(
        `The signing page could not be opened. ${error?.message ?? ''}`.trim()
      );
    } finally {
      openingSigningPageRef.current = false;
      setOpeningSigningPage(false);
    }
  }, [client, envelope.id, activeDocumentId, targetAction, setEnvelope]);

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
      if (!updated?.file)
        throw new Error('The document could not be saved. Please retry.');
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
    [client, envelope, targetAction]
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
      prepareVersion: (versionId) =>
        client.prepareEnvelopeVersion(envelopeId, versionId),
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

  const runTerminalAction = useCallback(
    () => onDocumentSign(envelopeRef.current.id, terminalAction === 'draft'),
    [onDocumentSign, terminalAction]
  );
  const runTerminalActionDraft = useCallback(
    () => onDocumentSign(envelopeRef.current.id, true),
    [onDocumentSign]
  );

  // DocxEditor exposes its live SyncFusion instance at this exact lifecycle
  // point. The schema container id is stable for this editor across renders;
  // retain the editor object as well so cleanup can only remove this exact
  // registration, never another mounted container's editor.
  const registeredEditor = useRef<any>(undefined);
  const registeredEnvelopeId = useRef<string | undefined>(undefined);
  const activeRef = useRef(active);
  activeRef.current = active;
  const onEditorReady = useCallback(
    (editor: any) => {
      if (!containerId) return;
      registeredEditor.current = editor;
      registeredEnvelopeId.current = envelope?.id;
      if (activeRef.current)
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
    if (!active || finalized) {
      unregisterDocxEditor(containerId, registeredEditor.current, formId);
      return;
    }
    // Cached tabs retain their layout size while hidden. Opening and the
    // editor's ResizeObserver own layout; resizing here can touch the caret
    // before its page exists and crash a newly selected document.
    registerDocxEditor(containerId, registeredEditor.current, {
      formId,
      stepId,
      documentId: activeDocumentId,
      envelopeId: envelope?.id
    });
  }, [
    active,
    finalized,
    activeDocumentId,
    containerId,
    envelope?.id,
    formId,
    stepId
  ]);
  useEffect(() => {
    const ownerId = envelope?.id;
    return () => {
      bindingValuesRef.current = {};
      if (containerId) {
        clearDocxEditorDirty(formId, `${containerId}:${initialEnvelope.id}`);
        if (
          registeredEnvelopeId.current === ownerId &&
          registeredEditor.current
        ) {
          unregisterDocxEditor(containerId, registeredEditor.current, formId);
          registeredEditor.current = undefined;
        }
      }
    };
  }, [containerId, formId, envelope?.id]);

  if (envelope.type === 'pdf' && envelope.file) {
    return (
      <div css={wrap}>
        {operationError && (
          <div role='alert' css={{ color: '#b42318', padding: 8 }}>
            {operationError}
          </div>
        )}
        <SignedEnvelopeView
          pdfUrl={pdfView.current.url ?? envelope.file}
          downloadUrl={
            envelope.file.includes('?')
              ? envelope.file
              : pdfView.current.url ?? envelope.file
          }
          signUrl={awaitingFiller ? signUrl : undefined}
          openingSigningPage={openingSigningPage}
          onOpenSigningPage={
            awaitingFiller && !sentThisSession && terminalAction === 'sign'
              ? reopenSigningPage
              : undefined
          }
          status={
            envelope.signed
              ? 'signed'
              : sentVia === 'docusign'
              ? 'docusign'
              : sentVia
              ? 'awaiting'
              : null
          }
        />
      </div>
    );
  }
  if (envelope.type !== 'docx')
    return (
      <div>{`Editing ${envelope.type} documents isn't supported yet.`}</div>
    );

  return (
    <div css={wrap}>
      {operationError && (
        <div role='alert' css={{ color: '#b42318', padding: 8 }}>
          {operationError}
        </div>
      )}
      <DocxEditor
        key={envelope.id}
        source={source}
        envelopeId={envelope.id}
        serviceUrl={serviceUrl}
        headers={serviceHeaders}
        licenseKey={syncfusion.licenseKey}
        readOnly={readOnly}
        reviewChanges={reviewChanges}
        openNonce={reloadKey}
        fileName={label}
        active={active}
        railPanel={railPanel}
        onRailPanelChange={onRailPanelChange}
        onSaveAll={multiple ? onSaveAll : undefined}
        onDownloadAll={
          multiple && offersDownload && !finalized ? onDownloadAll : undefined
        }
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
        // Once signing converts the envelope, this retained DOCX is read-only.
        hideDownload={!offersDownload || finalized}
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
            ? () => {
                onDocumentSaved(envelopeRef.current).catch((err) =>
                  setOperationError(String(err))
                );
              }
            : undefined
        }
        onDownloaded={
          offersDownload
            ? () => onDocumentDownloaded(envelopeRef.current)
            : undefined
        }
        // readOnly editors never dirty, so skip registering them entirely
        onChange={
          readOnly
            ? undefined
            : (dirty: boolean) => {
                onDirty(dirty);
                if (containerId)
                  setDocxEditorDirty(
                    formId,
                    `${containerId}:${initialEnvelope.id}`,
                    dirty
                  );
              }
        }
        onEditorReady={onEditorReady}
        onReady={onDocumentReady}
        // Server-side docx→pdf conversion (doc-conversion Lambda); does not
        // persist anything — the envelope stays an editable docx.
        onExportPdf={() => client.downloadEnvelopePdf(envelope.id)}
      />
    </div>
  );
}
