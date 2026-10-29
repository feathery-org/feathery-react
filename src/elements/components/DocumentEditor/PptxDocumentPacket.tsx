import DocumentToast from './DocumentToast';
import { PresentationLoader } from '../PptxEditor/loading/PresentationLoader';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import type FeatheryClient from '../../../utils/featheryClient';
import { downloadAllFileUrls } from '../../../utils/browser';
import { setFieldValues } from '../../../utils/init';
import { containerToolbarOutcomes } from '../../../utils/document';
import {
  clearDocxEditorDirty,
  setDocxEditorDirty
} from '../DocxEditor/docxDirtyRegistry';
import type { DocumentTab, EditorEnvelope } from './documentPacket';
import { envelopeSourceUrl } from './documentPacket';

const PptxEditor = React.lazy(
  () => import(/* webpackChunkName: "PptxEditor" */ '../PptxEditor')
);
type Handle = {
  save: () => Promise<unknown>;
  envelope: () => EditorEnvelope;
  isDirty: () => boolean;
};

function PresentationSession({
  envelope: initial,
  active,
  busy,
  tab,
  client,
  onEnvelopeChange,
  register,
  containerId,
  formId,
  readOnly,
  offersDownload,
  onSaved,
  onSaveAll,
  onDownloadAll,
  onError,
  onDirty,
  loader,
  onReady
}: {
  loader: PresentationLoader;
  onReady: (id: string) => void;
  envelope: EditorEnvelope;
  active: boolean;
  busy: boolean;
  tab: DocumentTab;
  client: FeatheryClient;
  onEnvelopeChange: (value: EditorEnvelope) => void;
  register: (id: string, handle: Handle | null) => void;
  containerId?: string;
  formId?: string;
  readOnly: boolean;
  offersDownload: boolean;
  onSaved: (envelopes: EditorEnvelope[]) => Promise<void>;
  onSaveAll?: () => Promise<void>;
  onDownloadAll?: () => Promise<void>;
  onError: (message: string) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const current = useRef(initial);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [source] = useState(() => ({ url: envelopeSourceUrl(initial) ?? '' }));
  const prepareSource = useCallback(
    (signal: AbortSignal) => loader.load(initial.id, source.url, signal),
    [loader, initial.id, source.url]
  );
  const saveRef = useRef<(() => Promise<unknown>) | null>(null);
  const dirtyRef = useRef(false);
  const registerSave = useCallback((save: (() => Promise<unknown>) | null) => {
    saveRef.current = save;
  }, []);
  useEffect(() => {
    register(initial.id, {
      // A session still loading has no edits to flush.
      save: () => saveRef.current?.() ?? Promise.resolve(),
      envelope: () => current.current,
      isDirty: () => dirtyRef.current
    });
    return () => {
      register(initial.id, null);
      if (containerId)
        clearDocxEditorDirty(formId, `${containerId}:${initial.id}`);
    };
  }, [initial.id, register, containerId, formId, tab.label]);
  const save = useCallback(
    async (blob: Blob) => {
      const result = await client.saveEnvelopeFile(
        initial.id,
        blob,
        'document.pptx'
      );
      if (!result?.file)
        throw new Error('The presentation could not be saved. Please retry.');
      current.current = { ...current.current, ...result };
      onEnvelopeChange(current.current);
      return result;
    },
    [client, initial.id, onEnvelopeChange]
  );
  return (
    <div
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
      <React.Suspense fallback={<div>Loading document…</div>}>
        {loadError ? (
          <div role='alert'>{loadError}</div>
        ) : (
          <PptxEditor
            source={source}
            visible={active}
            prepareSource={prepareSource}
            onReady={() => onReady(tab.id)}
            fileName={tab.label.replace(/\.pptx$/i, '') + '.pptx'}
            readOnly={readOnly || initial.signed}
            hideDownload={!offersDownload}
            onSave={save}
            onBeforeReplaceReady={registerSave}
            onSaved={() => onSaved([current.current])}
            onSaveAll={onSaveAll}
            onDownloadAll={offersDownload ? onDownloadAll : undefined}
            onExportPdf={() => client.downloadEnvelopePdf(initial.id)}
            onError={onError}
            onLoadError={setLoadError}
            onChange={
              readOnly || initial.signed
                ? undefined
                : (dirty) => {
                    dirtyRef.current = dirty;
                    onDirty(dirty);
                    if (containerId)
                      setDocxEditorDirty(
                        formId,
                        `${containerId}:${initial.id}`,
                        dirty
                      );
                  }
            }
          />
        )}
      </React.Suspense>
    </div>
  );
}

export default function PptxDocumentPacket({
  tabs,
  activeId,
  reloadKey,
  client,
  action,
  containerId,
  formId,
  updateEnvelope,
  resolveTabEnvelope,
  resolveEnvelopes,
  registerBeforeReplace,
  onBusy,
  onError
}: {
  tabs: DocumentTab[];
  activeId?: string;
  reloadKey: number;
  client: FeatheryClient;
  action?: Record<string, any>;
  containerId?: string;
  formId?: string;
  updateEnvelope: (value: EditorEnvelope) => void;
  resolveTabEnvelope: (tab: DocumentTab) => Promise<EditorEnvelope | null>;
  resolveEnvelopes: (
    onUnavailable?: (label: string, error: unknown) => void
  ) => Promise<EditorEnvelope[]>;
  registerBeforeReplace: (save: (() => Promise<unknown>) | null) => void;
  onBusy: (busy: boolean) => void;
  onError: (message: string | null) => void;
}) {
  const sessions = useRef(new Map<string, Handle>());
  const selectedId = useRef(activeId);
  selectedId.current = activeId;
  const loader = useMemo(() => new PresentationLoader(), [reloadKey]);
  useEffect(() => () => loader.dispose(), [loader]);
  const [ready, setReady] = useState<Set<string>>(() => new Set());
  useEffect(() => setReady(new Set()), [loader]);
  const markReady = useCallback((id: string) => {
    setReady((ids) => new Set([...ids, id]));
  }, []);
  const [visited, setVisited] = useState<string[]>(activeId ? [activeId] : []);
  useEffect(() => setVisited(activeId ? [activeId] : []), [loader]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [feedback, setFeedback] = useState('');
  const clearFeedbackOnEdit = useCallback((dirty: boolean) => {
    if (dirty) setFeedback('');
  }, []);
  useEffect(() => setFeedback(''), [reloadKey]);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(''), 2500);
    return () => clearTimeout(timer);
  }, [feedback]);
  const register = useCallback((id: string, handle: Handle | null) => {
    if (handle) sessions.current.set(id, handle);
    else sessions.current.delete(id);
  }, []);
  useEffect(() => {
    if (activeId)
      setVisited((ids) => (ids.includes(activeId) ? ids : [...ids, activeId]));
  }, [activeId]);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const visitedRef = useRef(visited);
  visitedRef.current = visited;
  // Depend on stable identities (ids + ready/visited keys), not the tabs/ready
  // object identities that change on every save, so saving doesn't tear down
  // and restart in-flight background prefetching.
  const activePrefetchReady = !!activeId && ready.has(activeId);
  const tabIdKey = tabs.map((tab) => tab.id).join('|');
  const visitedKey = visited.join('|');
  useEffect(() => {
    if (!activeId || !activePrefetchReady) return;
    const controller = new AbortController();
    const preparedIdByTab = new Map<string, string>();
    // Let the active slide paint before preparing at most two likely next tabs.
    const timer = setTimeout(async () => {
      const currentTabsList = tabsRef.current;
      const visitedNow = visitedRef.current;
      const start = currentTabsList.findIndex((tab) => tab.id === activeId);
      const candidates = [
        ...currentTabsList.slice(start + 1),
        ...currentTabsList.slice(0, start)
      ]
        .filter(
          (tab) =>
            (tab.envelope || tab.documentId) && !visitedNow.includes(tab.id)
        )
        .slice(0, 2);
      for (const tab of candidates) {
        if (controller.signal.aborted) return;
        try {
          const envelope = tab.envelope ?? (await resolveTabEnvelope(tab));
          if (controller.signal.aborted) return;
          const url = envelopeSourceUrl(envelope);
          if (envelope?.type === 'pptx' && url) {
            preparedIdByTab.set(tab.id, envelope.id);
            await loader.prefetch(envelope.id, url, controller.signal);
          }
        } catch {
          // Speculative failures should not block the active document or the
          // next candidate; selecting the tab surfaces the real error.
        }
      }
    }, 100);
    return () => {
      clearTimeout(timer);
      // Reopened tabs use document-based tab IDs, while the loader keys jobs
      // by envelope ID. Preserve the selected job before cancelling the rest.
      loader.prioritize(preparedIdByTab.get(selectedId.current ?? ''));
      controller.abort();
    };
  }, [
    activeId,
    activePrefetchReady,
    tabIdKey,
    visitedKey,
    loader,
    resolveTabEnvelope
  ]);
  const currentTabs = useRef(tabs);
  currentTabs.current = tabs;
  const flushBeforeReplace = useCallback(async () => {
    setBusy(true);
    onBusy(true);
    try {
      // Replacement needs only the drafts that actually exist in memory.
      // An unvisited template with no current file must not prevent regeneration.
      do {
        for (const session of sessions.current.values()) await session.save();
      } while (
        [...sessions.current.values()].some((session) => session.isDirty())
      );
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }, [onBusy]);
  useEffect(() => {
    registerBeforeReplace(flushBeforeReplace);
    return () => registerBeforeReplace(null);
  }, [registerBeforeReplace, flushBeforeReplace]);

  const savePacket = useCallback(async () => {
    const failures: string[] = [];
    const savedNames: string[] = [];
    const failedIds = new Set<string>();
    for (const [id, session] of sessions.current) {
      try {
        await session.save();
        savedNames.push(
          currentTabs.current.find((tab) => tab.envelope?.id === id)?.label ??
            id
        );
      } catch (error) {
        failedIds.add(id);
        const label =
          currentTabs.current.find((tab) => tab.envelope?.id === id)?.label ??
          id;
        failures.push(
          `${label}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    let unavailable = false;
    const envelopes = await resolveEnvelopes((label, error) => {
      unavailable = true;
      failures.push(
        `${label}: ${error instanceof Error ? error.message : String(error)}`
      );
    });
    return {
      envelopes: envelopes.map(
        (env) => sessions.current.get(env.id)?.envelope() ?? env
      ),
      failedIds,
      savedNames,
      unavailable,
      failures
    };
  }, [resolveEnvelopes]);

  const fieldWrites = useRef<Promise<void>>(Promise.resolve());
  const saved = useCallback(
    (envelopes: EditorEnvelope[], allResolved = false): Promise<void> => {
      const write = fieldWrites.current
        .catch(() => undefined)
        .then(async () => {
          if (
            action?.editor_toolbar_actions?.includes('save') &&
            action?.save_document_field_key
          ) {
            const latest = allResolved ? envelopes : await resolveEnvelopes();
            const files = latest.map(
              (env) =>
                (
                  sessions.current.get(env.id)?.envelope() ??
                  envelopes.find((saved) => saved.id === env.id) ??
                  env
                ).file
            );
            const values = {
              [action.save_document_field_key]:
                files.length === 1 ? files[0] : files
            };
            setFieldValues(values, true, true);
            await client.submitCustom(values);
          }
          onError(null);
        });
      fieldWrites.current = write;
      return write;
    },
    [action, client, resolveEnvelopes, onError]
  );
  const run = useCallback(
    async (operation: () => Promise<void>, background = false) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(!background);
      onBusy(!background);
      onError(null);
      setFeedback('');
      try {
        await operation();
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      } finally {
        busyRef.current = false;
        setBusy(false);
        onBusy(false);
      }
    },
    [onBusy, onError]
  );
  const saveAll = useCallback(
    () =>
      run(async () => {
        const result = await savePacket();
        // Never replace an existing URL list with an incomplete one.
        if (!result.unavailable) await saved(result.envelopes, true);
        if (result.failures.length) {
          throw new Error(
            `Saved: ${
              result.savedNames.join(', ') || 'none'
            }. Could not complete: ${result.failures.join('; ')}${
              result.unavailable
                ? '. Saved field links were kept unchanged.'
                : ''
            }`
          );
        }
        setFeedback('All documents saved');
      }, true),
    [run, saved, savePacket]
  );
  const downloadAll = useCallback(
    () =>
      run(async () => {
        const result = await savePacket();
        const envelopes = result.envelopes.filter(
          (env) => !result.failedIds.has(env.id)
        );
        await downloadAllFileUrls(
          envelopes.map((env) => env.file as string),
          action?.envelope_zip_name,
          { cache: 'no-store' },
          true
        );
        if (result.failures.length)
          throw new Error(
            `Downloaded ${
              envelopes.length
            } documents. Could not include: ${result.failures.join('; ')}`
          );
        setFeedback('All documents downloaded');
      }),
    [run, savePacket, action]
  );
  const outcomes = containerToolbarOutcomes(action ?? {});
  const offersDownload = outcomes.offersDownload && !outcomes.savesToField;
  const readyTabs = useMemo(
    () =>
      tabs.filter(
        (tab) =>
          tab.envelope?.type === 'pptx' &&
          tab.envelope.file &&
          (tab.id === activeId || visited.includes(tab.id))
      ),
    [tabs, activeId, visited]
  );
  return (
    <>
      {readyTabs.map((tab) => {
        const envelope = tab.envelope;
        if (!envelope) return null;
        return (
          <PresentationSession
            key={`${reloadKey}:${envelope.id}`}
            envelope={envelope}
            loader={loader}
            onReady={markReady}
            active={tab.id === activeId}
            busy={busy}
            tab={tab}
            client={client}
            onEnvelopeChange={updateEnvelope}
            register={register}
            containerId={containerId}
            formId={formId}
            readOnly={!!action?.editor_read_only}
            offersDownload={offersDownload}
            onSaved={saved}
            onDirty={clearFeedbackOnEdit}
            onSaveAll={tabs.length > 1 ? saveAll : undefined}
            onDownloadAll={tabs.length > 1 ? downloadAll : undefined}
            onError={onError}
          />
        );
      })}
      {feedback && <DocumentToast message={feedback} />}
      {busy && (
        <div
          role='status'
          css={{
            position: 'absolute',
            inset: 0,
            zIndex: 20,
            background: 'rgba(255,255,255,.65)',
            display: 'grid',
            placeItems: 'center'
          }}
        >
          Processing documents…
        </div>
      )}
    </>
  );
}
