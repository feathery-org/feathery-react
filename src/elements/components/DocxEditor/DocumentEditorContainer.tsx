import SharedDocumentRail from './SharedDocumentRail';
import DocumentToast from '../DocumentEditor/DocumentToast';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { documentSigners } from './documentSigners';
import DocxEditor from './index';
import DocxDocumentSession, {
  DocxDocumentSessionHandle
} from './DocxDocumentSession';
import DocumentTabs from '../DocumentEditor/DocumentTabs';
import { useDocumentPacket } from '../DocumentEditor/useDocumentPacket';
import { EditorEnvelope } from '../DocumentEditor/documentPacket';
import type { ActivePanel } from './reviewPanelPresentation';
import FeatheryClient from '../../../utils/featheryClient';
import {
  downloadAllFileUrls,
  featheryWindow,
  openTab
} from '../../../utils/browser';
import { fieldValues, initState, setFieldValues } from '../../../utils/init';
import internalState from '../../../utils/internalState';
import { ACTION_GENERATE_ENVELOPES } from '../../../utils/elementActions';
import {
  buildDocumentReviewTrigger,
  containerToolbarOutcomes,
  editorContainerId,
  getSignUrl,
  isDocusignSignAction
} from '../../../utils/document';
// The container carries no document. Its document is owned by the Generate
// Documents button that targets it: find the action whose editor_mode matches
// this container. The schema key it was found under
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

// A packet owns navigation and batch outcomes. Each visited envelope owns a
// separate mounted editor: switching tabs never serializes, saves, or reopens it.
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
  const { action, formKey } = useMemo(
    () => resolveTargetAction(containerId),
    [containerId]
  );
  const client = useMemo(() => new FeatheryClient(formKey ?? ''), [formKey]);
  const sessions = useRef(new Map<string, DocxDocumentSessionHandle>());
  const preparedForSigning = useRef(
    new Map<string, EditorEnvelope & { signer_id?: string }>()
  );
  const dirtyIds = useRef(new Set<string>());
  const registerSession = useCallback(
    (id: string, handle: DocxDocumentSessionHandle | null) => {
      if (handle) sessions.current.set(id, handle);
      else {
        sessions.current.delete(id);
        dirtyIds.current.delete(id);
      }
    },
    []
  );
  const load = useCallback(
    (id: string) => client.getCurrentEnvelope(id),
    [client]
  );
  const flushLoaded = useCallback(async () => {
    // Editors stay live while later ones save, so a saved document can be
    // edited again mid-flush; keep passing until a pass leaves nothing dirty
    do {
      for (const session of sessions.current.values()) await session.save();
    } while (dirtyIds.current.size);
  }, []);
  const packet = useDocumentPacket({
    containerId,
    documents: action?.documents,
    editMode,
    load,
    beforeReplace: flushLoaded,
    saveOnSwitch: false
  });
  const {
    tabs,
    activeId,
    reloadKey,
    selectTab,
    updateTabEnvelope,
    resolveEnvelopes,
    filesForSave
  } = packet;
  useEffect(() => {
    preparedForSigning.current.clear();
  }, [reloadKey]);
  const [visited, setVisited] = useState<string[]>(activeId ? [activeId] : []);
  useEffect(() => {
    if (activeId)
      setVisited((ids) => (ids.includes(activeId) ? ids : [...ids, activeId]));
  }, [activeId]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [feedback, setFeedback] = useState('');
  const [railPanel, setRailPanel] = useState<ActivePanel>(null);
  const trackDirty = useCallback((id: string, dirty: boolean) => {
    if (dirty) {
      dirtyIds.current.add(id);
      setFeedback('');
    } else dirtyIds.current.delete(id);
  }, []);
  useEffect(() => setFeedback(''), [reloadKey]);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(''), 2500);
    return () => clearTimeout(timer);
  }, [feedback]);
  const { savesToField } = containerToolbarOutcomes(action ?? {});
  const currentTabs = useRef(tabs);
  currentTabs.current = tabs;

  const emit = useCallback(
    async (
      envelopes: EditorEnvelope[],
      outcome: 'save' | 'download' | 'sign',
      result: Record<string, any>,
      draft = false
    ) => {
      await internalState[formId ?? '']?.runDocumentReviewLogic?.(
        buildDocumentReviewTrigger({
          action: action ?? {},
          elementId: containerId ?? '',
          envelopes: envelopes.map((env) => ({ envelopeId: env.id })),
          envelopeAction: outcome,
          draft,
          result
        })
      );
    },
    [action, containerId, formId]
  );
  const fieldSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const saved = useCallback(
    async (envelopes: EditorEnvelope[]) => {
      const files = envelopes.map((env) => env.file).filter(Boolean);
      if (savesToField && action?.save_document_field_key) {
        const fieldKey = action.save_document_field_key;
        const submission = fieldSaveQueue.current.then(async () => {
          const values = { [fieldKey]: await filesForSave(envelopes) };
          setFieldValues(values, true, true);
          await client.submitCustom(values);
        });
        // Save and Save All share ordering; a failed write must not poison it.
        fieldSaveQueue.current = submission.catch(() => undefined);
        await submission;
        await emit(envelopes, 'save', { files });
      }
    },
    [action, client, emit, filesForSave, savesToField]
  );
  const savedOne = useCallback((env: EditorEnvelope) => saved([env]), [saved]);
  const downloadedOne = useCallback(
    (env: EditorEnvelope) => {
      emit([env], 'download', { files: [env.file] }).catch((err) =>
        packet.setOperationError(String(err))
      );
    },
    [emit, packet.setOperationError]
  );

  // Capture destinations before starting. Save runs in the background;
  // download/sign still lock navigation until their terminal outcome finishes.
  const run = useCallback(
    async (operation: () => Promise<void>, background = false) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(!background);
      setFeedback('');
      packet.setOperationError(null);
      try {
        await operation();
      } catch (err) {
        packet.setOperationError(
          err instanceof Error ? err.message : String(err)
        );
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [packet.setOperationError]
  );
  const savePacket = useCallback(async () => {
    const values = await resolveEnvelopes();
    const result: EditorEnvelope[] = [];
    for (const value of values) {
      const session = sessions.current.get(value.id);
      if (session) {
        try {
          await session.save();
        } catch (err) {
          const label =
            currentTabs.current.find((tab) => tab.envelope?.id === value.id)
              ?.label ?? 'Document';
          throw new Error(
            `${label} could not be saved. ${
              err instanceof Error ? err.message : ''
            }`
          );
        }
      }
      result.push(session?.envelope() ?? value);
    }
    return result;
  }, [resolveEnvelopes]);
  const saveAll = useCallback(
    () =>
      run(async () => {
        const envelopes = await savePacket();
        await saved(envelopes);
        setFeedback('All documents saved');
      }, true),
    [run, savePacket, saved]
  );
  const downloadAll = useCallback(
    () =>
      run(async () => {
        const envelopes = await savePacket();
        const files = envelopes.map((env) => env.file as string);
        await downloadAllFileUrls(files, action?.envelope_zip_name, {
          cache: 'no-store'
        });
        await emit(envelopes, 'download', { files });
        setFeedback('All documents downloaded');
      }),
    [run, savePacket, action, emit]
  );
  const signDocument = useCallback(
    (envelopeId: string, draft: boolean) =>
      run(async () => {
        const session = sessions.current.get(envelopeId);
        if (!session) throw new Error('Please wait for the document to load.');
        // Capture the initiating session. Other tabs keep their local edits.
        await session.save();
        const envelope = session.envelope();
        if (envelope.signed) return;
        const viaDocusign = isDocusignSignAction(action ?? {}, 'sign');
        const finalized =
          preparedForSigning.current.get(envelope.id) ??
          (await client.finalizeEnvelope(
            envelope.id,
            documentSigners(action, envelope.document, fieldValues),
            action?.sign_method,
            { individualSigning: !viaDocusign }
          ));
        if (!finalized?.file)
          throw new Error(
            'Could not prepare the document for signing. Please retry.'
          );
        const next = {
          ...envelope,
          ...finalized,
          editor_file: finalized.editor_file ?? null,
          type: 'pdf'
        } as EditorEnvelope & { signer_id?: string; invited?: boolean };
        preparedForSigning.current.set(envelope.id, next);
        session.markFinalized();
        let result: Record<string, any> = { files: [next.file] };
        if (viaDocusign) {
          result = await client.finalizeEnvelopeReview(action ?? {}, {
            envelopes: [{ envelopeId: envelope.id }],
            envelopeAction: 'sign',
            draft
          });
          if (!result || result.status === 'error')
            throw new Error(
              result?.message ?? 'Failed to send the document to DocuSign'
            );
          if (!draft) {
            const sent = { ...next, sent: true, sent_via: 'docusign' as const };
            preparedForSigning.current.set(envelope.id, sent);
            session.showSent(sent);
            updateTabEnvelope(sent);
          }
        } else if (next.signer_id || next.invited) {
          const sent = { ...next, sent: true, sent_via: 'feathery' as const };
          preparedForSigning.current.set(envelope.id, sent);
          session.showSent(
            sent,
            next.signer_id
              ? getSignUrl(next.signer_id, action?.redirect)
              : undefined
          );
          updateTabEnvelope(sent);
        }
        await emit([envelope], 'sign', result, draft);
        const announce = internalState[formId ?? '']?.showEnvelopeOutcome;
        if (viaDocusign || next.invited)
          announce?.(
            draft ? 'Saved as Draft' : 'Sent for Signature',
            envelope.document ? [envelope.document] : undefined
          );
        if (!viaDocusign && next.signer_id) {
          const url = getSignUrl(next.signer_id, action?.redirect);
          if (action?.redirect) featheryWindow().location.href = url;
          else openTab(url);
        }
      }),
    [run, action, client, updateTabEnvelope, emit, formId]
  );

  if (editMode) return <DocxEditor preview hideDownload />;
  const tabListId = `documents-${containerId ?? 'editor'}`;
  return (
    <div
      css={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <DocumentTabs
        tabs={tabs}
        activeId={activeId}
        disabled={busy || packet.loading || packet.switching}
        onSelect={selectTab}
        id={tabListId}
      />
      {packet.operationError && (
        <div role='alert' css={{ color: '#b42318', padding: 8 }}>
          {packet.operationError}
        </div>
      )}
      <div
        role={tabs.length > 1 ? 'tabpanel' : undefined}
        id={`${tabListId}-panel`}
        aria-labelledby={
          tabs.length > 1
            ? `${tabListId}-tab-${tabs.findIndex((tab) => tab.id === activeId)}`
            : undefined
        }
        css={{ flex: 1, minHeight: 0, position: 'relative' }}
      >
        <SharedDocumentRail
          key={reloadKey}
          enabled={tabs.length > 1}
          visible={packet.envelope?.type === 'docx'}
          activeId={packet.envelope?.id}
          panel={railPanel}
          onPanelChange={setRailPanel}
          showChanges={!!assistantEnabled && !action?.editor_read_only}
        >
          {packet.loading ? (
            <div>Loading document…</div>
          ) : packet.error ? (
            <div role='alert'>{packet.error}</div>
          ) : !packet.envelope?.file ? (
            <div>No document yet — generate it to start editing.</div>
          ) : null}
          {tabs
            .filter(
              (tab) =>
                tab.envelope?.file &&
                (visited.includes(tab.id) || tab.id === activeId)
            )
            .map((tab) => {
              const envelope = tab.envelope;
              if (!envelope) return null;
              const active = tab.id === activeId;
              const prepared = preparedForSigning.current.get(envelope.id);
              return (
                <div
                  key={`${reloadKey}:${envelope.id}`}
                  aria-hidden={!active}
                  ref={(node) => {
                    if (node) node.toggleAttribute('inert', busy || !active);
                  }}
                  css={{
                    position: 'absolute',
                    inset: 0,
                    opacity: active ? 1 : 0,
                    visibility: active ? 'visible' : 'hidden',
                    pointerEvents: active ? 'auto' : 'none'
                  }}
                >
                  <DocxDocumentSession
                    containerId={containerId}
                    formId={formId}
                    stepId={stepId}
                    assistantEnabled={assistantEnabled}
                    targetAction={action}
                    client={client}
                    initialEnvelope={envelope}
                    initialSigning={
                      prepared?.sent
                        ? {
                            sent: true,
                            signUrl: prepared.signer_id
                              ? getSignUrl(prepared.signer_id, action?.redirect)
                              : undefined
                          }
                        : undefined
                    }
                    documentId={tab.documentId}
                    label={tab.label}
                    active={active}
                    onDirty={trackDirty}
                    railPanel={tabs.length > 1 ? railPanel : undefined}
                    onRailPanelChange={
                      tabs.length > 1 ? setRailPanel : undefined
                    }
                    multiple={tabs.length > 1}
                    onEnvelopeChange={updateTabEnvelope}
                    onSessionReady={registerSession}
                    onSaveAll={saveAll}
                    onDownloadAll={downloadAll}
                    onDocumentSign={signDocument}
                    onDocumentSaved={savedOne}
                    onDocumentDownloaded={downloadedOne}
                  />
                </div>
              );
            })}
          {feedback && <DocumentToast message={feedback} />}
          {busy && (
            <div
              role='status'
              css={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(255,255,255,.65)',
                zIndex: 20,
                display: 'grid',
                placeItems: 'center'
              }}
            >
              Processing documents…
            </div>
          )}
        </SharedDocumentRail>
      </div>
    </div>
  );
}
