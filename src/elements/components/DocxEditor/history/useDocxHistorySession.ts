// Ties the pure autosave engine (tracker + slice store + scheduler) to a live
// DocumentEditor and the history I/O host. It owns nothing the engine already
// owns; it only bridges editor signals in and persistence out.
//
// PR 2 scope: sessions drive an autosave PATCH carrying the session id, and a
// session close persists the final document. The close-time DIFF (per-author
// highlights) lands in a later PR — closeVersion is called with F only, and a
// backend that has not shipped the close endpoint yet simply leaves the row
// with its docx pair (a one-colour fallback at view time).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DocumentPersistenceError } from '../../../../utils/documentPersistence';
import { featheryDoc } from '../../../../utils/browser';

import {
  isAssistantWriting,
  onAssistantSessionChange
} from '../../../../assistant/tools/docx/syncfusionDocumentOps';
import { isOpeningDocument } from '../useDocxEditor';
import { createAutosaveScheduler } from './autosaveScheduler';
import { createDocumentSaveQueue } from './documentSaveQueue';
import {
  applyHunks,
  collectRobinRuns,
  contentHash,
  countEditGroups,
  countPendingGroups,
  diffSession,
  normalizeForDiff,
  RevisionRun,
  trackedAuthorKeys
} from './sfdtDiff/index';
import { createSessionTracker } from './sessionTracker';
import { createSliceStore } from './sliceStore';
import {
  DocxHistoryHost,
  DocxSaveMeta,
  LiveSessionAuthors,
  SaveStatus,
  Slice,
  VersionAuthor
} from './types';
import {
  clearLocalVersionArtifacts,
  localVersionArtifactsFor,
  registerLocalVersionArtifacts
} from './useVersionDocument';

const ROBIN: VersionAuthor = {
  kind: 'assistant',
  key: 'robin',
  label: 'Robin'
};
const IDLE_CHECK_MS = 30_000;
// Minimum spacing between autosave-piggybacked redline checkpoints. Autosaves
// can fire every ~3s while typing; diffing + uploading the change list that
// often is wasteful, and one checkpoint per interval keeps an abandoned
// session's stored highlights at most this stale.
export const CHECKPOINT_MIN_INTERVAL_MS = 20_000;
const ARTIFACT_UPLOAD_ERROR =
  'Document saved, but version details could not be uploaded. Retry to preserve its highlights.';

export interface UseDocxHistorySessionOptions {
  editor: any;
  loading: boolean;
  readOnly?: boolean;
  /** I/O adapter; absent → history disabled (autosave still runs via `save`). */
  host?: DocxHistoryHost | null;
  /** The current viewer's identity (always kind 'user', key 'you'). */
  currentUser: VersionAuthor;
  /** Reset the session when the underlying document changes. */
  envelopeId?: string;
  openNonce?: number;
  exportDoc: () => Promise<Blob>;
  /** The autosave PATCH (index.tsx → container → client.saveEnvelopeFile). */
  save: (blob: Blob, meta: DocxSaveMeta) => Promise<unknown>;
  /** Extra gate (the binding soft-gate): autosave holds while it is false. */
  canSave?: () => boolean;
}

/** The current session's live change list, as the viewer would render a stored
 *  version: `sfdt` is the applyHunks display document (highlights baked in). */
export interface SessionPreview extends LiveSessionAuthors {
  sfdt: string;
  editCount: number;
  formatCount: number;
  /** Assistant edits still tracked (not yet accepted) in this preview. */
  pendingCount: number;
}

export interface TrackedChangeAcceptance {
  /** Raw SFDT while the selected revisions are still pending. */
  beforeSfdt: string;
  /** Syncfusion revision ids settled by this one review action. */
  revisionIds: string[];
}

export interface UseDocxHistorySessionResult {
  error: string | null;
  status: SaveStatus;
  savedAt: Date | null;
  /** Fire on every editor content change; index.tsx forwards useDocxEditor's
   *  onEdit here. */
  onEdit: (info: { assistant: boolean }) => void;
  /** Explicit Save: close the session now and resolve when it has persisted. */
  save: () => Promise<unknown>;
  /** Close the current session's DOCX before a restore, but defer its costly
   *  diff upload until the restore has preserved that now-closed row. */
  saveForRestore: () => Promise<void>;
  /** Release the deferred pre-restore diff upload. Always call after a
   *  saveForRestore attempt, including when the restore request fails. */
  finishRestoreSave: () => void;
  retry: () => void;
  /** Diff the OPEN session live (same inputs as the close-time diff) and return
   *  a highlighted display document for the in-progress current version, which
   *  has no stored files yet. Null when no session is open or the diff fails. */
  previewSession: () => SessionPreview | null;
  /** Whether the current document still has an in-progress editing session. */
  isSessionOpen: () => boolean;
  /** Close any preceding edits, apply the native accept operation, then save
   *  that confirmation as its own Robin-attributed history version. */
  acceptTrackedChanges: (
    acceptance: TrackedChangeAcceptance,
    accept: () => void
  ) => Promise<void>;
}

async function gzip(text: string): Promise<Blob> {
  // S3 serves the .gz verbatim and the viewer inflates; a runtime without
  // CompressionStream (older jsdom) falls back to the raw bytes.
  const CS = (globalThis as any).CompressionStream;
  if (typeof CS === 'undefined') return new Blob([text]);
  const stream = new Blob([text]).stream().pipeThrough(new CS('gzip'));
  return new Response(stream).blob();
}

function uniqueRevisionRuns(runs: RevisionRun[]): RevisionRun[] {
  const seen = new Set<string>();
  return runs.filter((run) => {
    const key = JSON.stringify([run.kind, run.text, run.group ?? null]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function useDocxHistorySession(
  opts: UseDocxHistorySessionOptions
): UseDocxHistorySessionResult {
  const {
    editor,
    loading,
    readOnly,
    host,
    currentUser,
    envelopeId,
    openNonce,
    exportDoc,
    save,
    canSave
  } = opts;

  const mountedRef = useRef(true);
  const ownedSessions = useRef(new Set<string>());
  const [status, updateStatus] = useState<SaveStatus>('clean');
  const [savedAt, updateSavedAt] = useState<Date | null>(null);
  const [saveError, updateSaveError] = useState<string | null>(null);
  const setStatus = (value: SaveStatus) => {
    if (mountedRef.current) updateStatus(value);
  };
  const setSavedAt = (value: Date | null) => {
    if (mountedRef.current) updateSavedAt(value);
  };
  const setSaveError = (
    value: string | null | ((current: string | null) => string | null)
  ) => {
    if (mountedRef.current) updateSaveError(value);
  };

  // Live inputs behind refs so the engine (built once) reads fresh values.
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const saveRef = useRef(save);
  saveRef.current = save;
  const exportRef = useRef(exportDoc);
  exportRef.current = exportDoc;
  const hostRef = useRef(host);
  hostRef.current = host;
  const canSaveRef = useRef(canSave);
  canSaveRef.current = canSave;
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
  // The document as the session began — the diff baseline (S0). This MUST be the
  // pristine document from BEFORE the first edit: the diff attributes S0 → F to
  // the authors, so a post-first-edit S0 loses that edit (and, for a same-author
  // session with no boundary slices, loses ALL highlights). It cannot be captured
  // in onEdit, which fires on contentChange AFTER the edit applies — so we snapshot
  // it when the document finishes opening (below) and refresh it after each close.
  const baselineRef = useRef<string | null>(null);
  // The starting document copied into s0 for the currently-open session.
  const s0Ref = useRef<string | null>(null);
  // The author of the final segment (last boundary → close): the F slice's
  // author for the diff. Updated on every edit.
  const currentAuthorRef = useRef<string>('you');
  // contentChange is emitted AFTER an edit. Retain the previous document for
  // BOTH directions of author switch, including typing between Robin batches.
  const lastSnapshotRef = useRef<string | null>(null);
  // Text Robin authored this session, captured on each assistant edit WHILE its
  // revision is live — so it survives the user accepting the suggestion before
  // the version closes. Stored on the change list to keep accepted Robin edits
  // coloured as Robin at view time (deduped by kind, text, and group).
  const robinRunsRef = useRef<RevisionRun[]>([]);
  // Present only while the review rail is applying an accept operation. It
  // changes both attribution (the accepted text remains Robin's) and the diff
  // baseline (the selected revisions are rendered rejected at S0).
  const acceptanceRef = useRef<TrackedChangeAcceptance | null>(null);
  const documentEpochRef = useRef(0);
  const finalizeRef = useRef<Promise<unknown>>(Promise.resolve());
  const holdFinalDiffForRestoreRef = useRef(false);
  const releaseFinalDiffRef = useRef<(() => void) | null>(null);

  // Build the engine exactly once; its inner functions read the refs above.
  const engineRef = useRef<ReturnType<typeof buildEngine> | null>(null);
  if (!engineRef.current) engineRef.current = buildEngine();
  const engine = engineRef.current;

  function buildEngine() {
    const slices = createSliceStore();
    const documentWrites = createDocumentSaveQueue();
    const pendingArtifacts = new Set<Promise<void>>();
    const failedArtifacts = new Map<string, () => Promise<void>>();
    const reportError = (error: unknown) => {
      setSaveError(
        error instanceof Error ? error.message : 'Could not save document'
      );
      setStatus('error');
    };
    const canPersist = () => {
      const ed = editorRef.current;
      return (
        mountedRef.current &&
        !!ed &&
        !ed.isDestroyed &&
        !loadingRef.current &&
        !readOnlyRef.current &&
        !isOpeningDocument(ed) &&
        !isAssistantWriting(ed)
      );
    };
    // Close/checkpoint uploads mutate the same backend row. Keep them in one
    // FIFO so an older checkpoint can never complete after a newer final close.
    let closeQueue: Promise<void> = Promise.resolve();

    const uploadArtifacts = async (
      h: DocxHistoryHost,
      sessionId: string,
      payload: Parameters<DocxHistoryHost['closeVersion']>[1],
      finalSfdt: string
    ): Promise<void> => {
      try {
        await h.closeVersion(sessionId, payload);
        clearLocalVersionArtifacts(sessionId, finalSfdt);
        failedArtifacts.delete(sessionId);
        if (!failedArtifacts.size)
          setSaveError((current) =>
            current === ARTIFACT_UPLOAD_ERROR ? null : current
          );
      } catch (error) {
        // Retain the encoded upload, not every full author-boundary snapshot,
        // and retry through the same FIFO as newer checkpoints.
        failedArtifacts.set(sessionId, () =>
          uploadArtifacts(h, sessionId, payload, finalSfdt)
        );
        setSaveError(ARTIFACT_UPLOAD_ERROR);
        setStatus('error');
        throw error;
      }
    };

    // The closing session's diff inputs, captured SYNCHRONOUSLY at close time.
    // Anything serialized later (after the PATCH round-trip) can already carry
    // the next session's edits — or a binding/engine write that flipped the
    // last-edit author to the viewer — which is exactly how assistant edits
    // were being mis-attributed.
    interface CloseSnapshot {
      host: DocxHistoryHost | null | undefined;
      fStr: string | null;
      fAuthor: string;
      s0: string | null;
      slices: Slice[];
      slicesComplete: boolean;
      robinRuns: RevisionRun[];
      acceptance: TrackedChangeAcceptance | null;
    }

    const closeSession = async (
      sessionId: string,
      authors: DocxSaveMeta['authors'],
      snap: CloseSnapshot
    ) => {
      const h = snap.host;
      if (!h || !snap.fStr) return;
      const fStr = snap.fStr;
      const fDoc = JSON.parse(fStr);
      const finalSha256 = contentHash(normalizeForDiff(fDoc));
      const confirmedStart = snap.acceptance
        ? normalizeForDiff(JSON.parse(snap.acceptance.beforeSfdt), {
            rejectRevisionIds: snap.acceptance.revisionIds
          })
        : null;
      const startSha256 = confirmedStart
        ? contentHash(confirmedStart)
        : snap.s0
        ? contentHash(normalizeForDiff(JSON.parse(snap.s0)))
        : '';

      // Diff the session into per-author hunks. The stored slices are the
      // author-boundary snapshots; F is the closing state. A tab-death session
      // (no S0) or a diff failure degrades to docx-only (no highlights).
      let changesJson: Blob | undefined;
      let changeCount: number | null = null;
      let formatChangeCount: number | null = null;
      try {
        if (snap.s0) {
          // Missing author boundaries cannot produce trustworthy attribution.
          if (!snap.slicesComplete)
            throw new Error('History slice limit reached');
          const diffSlices = snap.acceptance
            ? [{ sfdt: fDoc, author: ROBIN.key }]
            : [
                ...snap.slices.map((s) => ({
                  sfdt: JSON.parse(s.sfdt as string),
                  author: s.author,
                  endedAt: s.endedAt
                })),
                { sfdt: fDoc, author: snap.fAuthor }
              ];
          const changes = diffSession(
            confirmedStart ?? JSON.parse(snap.s0),
            diffSlices,
            sessionId,
            {
              timeBudgetMs: 4000
            }
          );
          if (changes.degraded?.includes('time-budget'))
            throw new Error('History diff timed out');
          changes.attribution = 'slices';
          if (snap.acceptance) changes.confirmed = true;
          changeCount = changes.changeCount;
          formatChangeCount = changes.formatChangeCount;
          // Attach Robin's captured runs so accepted Robin edits stay coloured
          // as Robin at view time. Bounded well under the backend's 512KB change
          // limit; if Robin authored more than the budget, drop the runs and let
          // attribution degrade to today's behaviour rather than risk rejection.
          const ROBIN_RUNS_BUDGET = 100_000;
          // The preceding pending-edit version has already closed when the user
          // accepts it, so its in-memory Robin runs have been reset. Recover the
          // original groups from the acceptance snapshot for the confirmation
          // version; this is the version later copied by Restore.
          const acceptanceRuns = snap.acceptance
            ? collectRobinRuns(
                JSON.parse(snap.acceptance.beforeSfdt),
                snap.acceptance.revisionIds
              )
            : [];
          const robinRuns = uniqueRevisionRuns([
            ...snap.robinRuns,
            ...acceptanceRuns
          ]);
          if (robinRuns.length) {
            const capped: RevisionRun[] = [];
            let used = 0;
            for (const r of robinRuns) {
              used += r.text.length;
              if (used > ROBIN_RUNS_BUDGET) break;
              capped.push(r);
            }
            if (capped.length === robinRuns.length && capped.length)
              changes.robinRuns = capped;
          }
          // Session activity includes accepts and edits that were later undone.
          // Persist only authors whose final revisions the viewer can render.
          const display = applyHunks(fDoc, changes);
          changes.trackedAuthors = trackedAuthorKeys(display);
          changesJson = await gzip(JSON.stringify(changes));
          // Serve this exact document from memory while the upload is pending.
          // Upgrade-only: an older checkpoint draining from the queue must not
          // clobber a newer close's registration for the same session.
          const existing = localVersionArtifactsFor(sessionId);
          if (mountedRef.current && (!existing || existing.finalSfdt === fStr))
            registerLocalVersionArtifacts(sessionId, {
              finalSfdt: fStr,
              changes
            });
        }
      } catch {
        // Diff failed (unexpected SFDT shape, over budget): upload F alone so
        // the version still opens, with the one-colour fallback at view time.
        changesJson = undefined;
        changeCount = null;
        formatChangeCount = null;
      }

      await uploadArtifacts(
        h,
        sessionId,
        {
          finalSfdtGz: await gzip(fStr),
          changesJson,
          changeCount,
          formatChangeCount,
          finalSha256,
          startSha256,
          authors
        },
        fStr
      );
    };

    const queueClose = (
      sessionId: string,
      authors: DocxSaveMeta['authors'],
      snap: CloseSnapshot
    ): Promise<void> => {
      const next = closeQueue.then(() =>
        closeSession(sessionId, authors, snap)
      );
      closeQueue = next.catch(() => undefined);
      return next;
    };

    const finalizeSession = async (meta: {
      sessionId: string;
      sessionStartedAt: string;
      authors: DocxSaveMeta['authors'];
    }) => {
      // Restore only needs the DOCX snapshot to be durable before it can
      // replace the live document. Its SFDT/diff upload can safely attach to
      // the now-closed pre-restore row afterwards (the backend permits this
      // late close), so keep it off the click's critical path.
      const deferDiffForRestore = holdFinalDiffForRestoreRef.current;
      holdFinalDiffForRestoreRef.current = false;
      // Create the release gate before persistence so a failed restore can
      // release it too; retrying that snapshot must not strand its artifacts.
      const diffReady = deferDiffForRestore
        ? new Promise<void>((resolve) => {
            releaseFinalDiffRef.current = resolve;
          })
        : Promise.resolve();
      scheduler.cancel();
      // Capture the closing session's diff inputs before the first await: F,
      // its author, S0 and the boundary slices all belong to THIS session, and
      // the PATCH round-trip below leaves plenty of time for the next session's
      // edits (or an engine write) to corrupt them.
      let fStr: string | null = null;
      try {
        fStr = editorRef.current?.serialize() ?? null;
      } catch {
        fStr = null; // Serialize failed: the row keeps its docx pair only.
      }
      const snap: CloseSnapshot = {
        host: hostRef.current,
        fStr,
        fAuthor: currentAuthorRef.current,
        s0: s0Ref.current,
        slices: slices.all(),
        slicesComplete: slices.isComplete(),
        robinRuns: [...robinRunsRef.current],
        acceptance: acceptanceRef.current
      };
      // Register the closing document immediately: a restore (or prefetch) can
      // reach this row before its deferred diff/SFDT upload has even started.
      ownedSessions.current.add(meta.sessionId);
      if (fStr && mountedRef.current)
        registerLocalVersionArtifacts(meta.sessionId, { finalSfdt: fStr });
      slices.clear();
      s0Ref.current = null;
      // Hand the captured runs to the snapshot and start the next session fresh.
      robinRunsRef.current = [];
      acceptanceRef.current = null;
      // The just-closed document is the baseline for the NEXT session's diff —
      // set it now so edits landing while this close is in flight diff cleanly
      // into their own session.
      baselineRef.current = fStr;
      // A timer cancellation does not stop a PATCH already in flight. Drain it
      // before the closing save so an older autosave cannot arrive afterward and
      // overwrite the just-closed session with stale bytes.
      try {
        // Start DOCX serialization alongside F, before yielding to another edit.
        // Capture the destination too: a document switch may replace the refs.
        const saveSnapshot = saveRef.current;
        const exported = exportRef.current();
        exported.catch(() => undefined);
        let artifacts = Promise.resolve();
        const result = await documentWrites.submit(async () => {
          const blob = await exported;
          const result = await saveSnapshot(blob, {
            sessionId: meta.sessionId,
            sessionStartedAt: meta.sessionStartedAt,
            authors: meta.authors,
            closeSession: true
          });
          artifacts = diffReady.then(() =>
            queueClose(meta.sessionId, meta.authors, snap)
          );
          pendingArtifacts.add(artifacts);
          artifacts
            .then(() => {
              setSavedAt(new Date());
              setStatus(tracker.isOpen() ? 'dirty' : 'saved');
              if (!failedArtifacts.size) setSaveError(null);
            })
            .catch(() => undefined)
            .finally(() => pendingArtifacts.delete(artifacts));
          return result;
        });
        await artifacts;
        return result;
      } catch (error) {
        if (!failedArtifacts.size) reportError(error);
        // The document PATCH is the persistence boundary. Do not resolve an
        // explicit save (or continue a restore) when those bytes were rejected.
        throw error;
      }
    };

    // A turn ending during an in-flight save must force the NEXT snapshot's
    // checkpoint too; completing the older save cannot consume that request.
    let requestedCheckpoint = 0;
    let savedCheckpoint = 0;
    const scheduler = createAutosaveScheduler({
      save: async () => {
        const meta = tracker.currentMeta();
        if (!meta) return;
        const saveDocument = saveRef.current;
        const epoch = documentEpochRef.current;
        const checkpointRequest = requestedCheckpoint;
        const checkpoint = prepareCheckpoint(
          checkpointRequest > savedCheckpoint
        );
        const exported = exportRef.current();
        exported.catch(() => undefined);
        await documentWrites.submit(async () => {
          const blob = await exported;
          return saveDocument(blob, {
            sessionId: meta.sessionId,
            sessionStartedAt: meta.sessionStartedAt,
            authors: meta.authors
          });
        });
        if (!failedArtifacts.size) setSaveError(null);
        // Piggyback a throttled redline checkpoint on the successful autosave:
        // the PATCH persists only the docx, so a session abandoned before close
        // (reload / navigation) would otherwise store a version with NO
        // highlights. This keeps the open row's diff at most one autosave stale.
        if (epoch === documentEpochRef.current) {
          checkpoint?.();
          savedCheckpoint = checkpointRequest;
        }
      },
      canSave: () => {
        if (!canPersist()) return false;
        return canSaveRef.current ? canSaveRef.current() : true;
      },
      onError: reportError,
      onStatus: (s) => {
        setStatus(failedArtifacts.size ? 'error' : s);
        if (s === 'saved') setSavedAt(new Date());
      }
    });

    const tracker = createSessionTracker({
      // onEdit is post-mutation. If a background tab delayed the idle timer,
      // keep the session intact rather than closing with the next edit in F.
      closeIdleOnEdit: false,
      onSliceBoundary: (author) => {
        const ed = editorRef.current;
        if (!ed) return;
        try {
          const before = lastSnapshotRef.current ?? baselineRef.current;
          if (before) slices.push(before, author.key);
        } catch {
          // Slice lost: the diff falls back to coarser attribution.
        }
      },
      onClose: (reason, meta) => {
        if (reason === 'reset') {
          scheduler.cancel();
          slices.clear();
          s0Ref.current = null;
          lastSnapshotRef.current = null;
          robinRunsRef.current = [];
          acceptanceRef.current = null;
          // A new document invalidates the old baseline; the open-capture effect
          // snapshots the fresh one.
          baselineRef.current = null;
          return;
        }
        finalizeRef.current = finalizeSession(meta);
        // Idle/turn-end closes are fire-and-forget, but must not create an
        // unhandled rejection when the persistence boundary fails. Explicit
        // Save still awaits the original promise above and receives the error.
        finalizeRef.current.catch(() => undefined);
      }
    });

    // Persist the open session's redlines WITHOUT closing it, so a session
    // abandoned before it closes (reload / navigation / tab-death) still stores
    // a version WITH its highlights. Runs at an assistant turn's end (forced)
    // and piggybacked on autosaves (throttled). closeSession only uploads
    // final_sfdt + changes — it does NOT close the row on the backend — so
    // editing continues in the same session afterwards.
    let lastCheckpointAt = 0;
    const prepareCheckpoint = (force = false): (() => void) | undefined => {
      if (!force && Date.now() - lastCheckpointAt < CHECKPOINT_MIN_INTERVAL_MS)
        return;
      const meta = tracker.currentMeta();
      if (!meta || !s0Ref.current) return;
      let fStr: string | null = null;
      try {
        fStr = editorRef.current?.serialize() ?? null;
      } catch {
        fStr = null;
      }
      if (!fStr) return;
      const snap: CloseSnapshot = {
        host: hostRef.current,
        fStr,
        fAuthor: currentAuthorRef.current,
        s0: s0Ref.current,
        slices: slices.all(),
        slicesComplete: slices.isComplete(),
        robinRuns: [...robinRunsRef.current],
        acceptance: acceptanceRef.current
      };
      lastCheckpointAt = Date.now();
      ownedSessions.current.add(meta.sessionId);
      // Refresh the history list after the checkpoint files are uploaded. A
      // refresh on the DOCX autosave alone can read the pre-checkpoint row and
      // leave an already-selected Current version without its stepper.
      return () => {
        const pending = queueClose(meta.sessionId, meta.authors, snap);
        pendingArtifacts.add(pending);
        pending
          .then(() => {
            setSavedAt(new Date());
            if (!failedArtifacts.size && scheduler.status() === 'saved')
              setStatus('saved');
          })
          .catch(() => undefined)
          .finally(() => pendingArtifacts.delete(pending));
      };
    };
    const checkpointSession = () => {
      if (!tracker.isOpen()) return;
      requestedCheckpoint++;
      // The backend requires the session's DOCX save before its artifacts.
      // Use the normal save gate/queue and keep the editing session open.
      scheduler.touch();
      scheduler.flush().catch(() => undefined);
    };

    // After a reload the backend can have a current row containing live tracked
    // revisions while the in-memory tracker has no open session. Preserve that
    // row before native acceptance removes the revisions; otherwise the only
    // durable snapshot is the later confirmed one and both history rows look
    // approved. The backend close endpoint accepts this late artifact upload
    // for the current row even when its original session is already closed.
    const preservePendingCurrentVersion = async (
      acceptance: TrackedChangeAcceptance
    ) => {
      const h = hostRef.current;
      if (!h) return;
      try {
        const current = (await h.listVersions()).find(
          (version) => version.is_current && version.session_id
        );
        if (!current?.session_id) return;
        // A stored checkpoint contains the original per-author slices' diff.
        // Reconstructing it from today's pending revisions would erase human
        // edits and earlier accepted Robin edits. Only recover missing artifacts.
        if (current.final_sfdt || current.changes) return;

        // With no original baseline we can preserve the document and known
        // authors, but cannot reconstruct the session from pending edits alone.
        const snap: CloseSnapshot = {
          host: h,
          fStr: acceptance.beforeSfdt,
          fAuthor: ROBIN.key,
          s0: null,
          slices: [],
          slicesComplete: true,
          robinRuns: [],
          acceptance: null
        };
        await queueClose(current.session_id, [], snap);
        setSavedAt(new Date());
      } catch {
        // Version history is a sidecar to native review. A stale/missing row or
        // unavailable list endpoint must not prevent the user accepting edits.
      }
    };

    return {
      slices,
      documentWrites,
      flushArtifacts: () => Promise.all([...pendingArtifacts]),
      retryArtifacts: async () => {
        for (const [sessionId, retry] of [...failedArtifacts]) {
          const next = closeQueue.then(() => {
            if (failedArtifacts.get(sessionId) === retry) return retry();
          });
          closeQueue = next.catch(() => undefined);
          await next;
        }
      },
      reportError,
      canPersist,
      scheduler,
      tracker,
      checkpointSession,
      preservePendingCurrentVersion
    };
  }

  const {
    scheduler,
    tracker,
    checkpointSession,
    preservePendingCurrentVersion
  } = engine;

  // Reset before capturing the replacement document, even if the old tracker
  // was already closed (tracker.reset alone does not fire onClose in that case).
  useEffect(() => {
    documentEpochRef.current++;
    engine.documentWrites.resetResult();
    tracker.reset();
    scheduler.cancel();
    engine.slices.clear();
    s0Ref.current = null;
    baselineRef.current = null;
    lastSnapshotRef.current = null;
    robinRunsRef.current = [];
    acceptanceRef.current = null;
  }, [envelopeId, openNonce, tracker, scheduler, engine]);

  // Snapshot the pristine document as the diff baseline once it finishes opening
  // and no session is in flight. This is the true pre-edit S0 the diff needs;
  // capturing it at edit time is too late (contentChange fires post-edit).
  useEffect(() => {
    if (readOnly || loading || !editor) return;
    if (tracker.isOpen()) return; // Mid-session: don't clobber the baseline.
    try {
      baselineRef.current = editor.serialize();
      lastSnapshotRef.current = baselineRef.current;
    } catch {
      /* keep whatever baseline we had */
    }
  }, [editor, loading, readOnly, tracker, envelopeId, openNonce]);

  const onEdit = useCallback(
    (info: { assistant: boolean }) => {
      if (readOnly || !hostRef.current) return;
      const ed = editorRef.current;
      // Start of a new session: baseline it on the pristine pre-edit document
      // snapshot. Fall back to a live serialize only if no baseline was captured
      // (keeps behaviour no worse than before on that edge).
      if (!tracker.isOpen() && ed) {
        s0Ref.current = baselineRef.current ?? ed.serialize();
      }
      // Native acceptance fires contentChange as a user action, but the text
      // being confirmed was authored by Robin. Keep that content attribution.
      const actor = acceptanceRef.current
        ? ROBIN
        : info.assistant
        ? ROBIN
        : currentUserRef.current;
      currentAuthorRef.current = actor.key;
      tracker.noteEdit(actor);
      let snapshot: string | null = null;
      try {
        snapshot = ed?.serialize() ?? null;
      } catch {
        // Do not reuse a stale snapshot as evidence for the next boundary.
      }
      lastSnapshotRef.current = snapshot;
      // Snapshot Robin's authored runs now, while their revisions are still live
      // (the user may accept them before this version closes, after which they
      // are unrecoverable). Deduped by kind, text, and group; only runs on
      // assistant edits.
      if (info.assistant && snapshot) {
        try {
          const runs = collectRobinRuns(JSON.parse(snapshot));
          if (runs.length) {
            const seen = new Set(
              robinRunsRef.current.map(
                (r) => `${r.kind} ${r.text} ${r.group ?? ''}`
              )
            );
            for (const r of runs) {
              const key = `${r.kind} ${r.text} ${r.group ?? ''}`;
              if (!seen.has(key)) {
                seen.add(key);
                robinRunsRef.current.push(r);
              }
            }
          }
        } catch {
          /* best-effort; attribution falls back to the diff's slice author */
        }
      }
      scheduler.touch();
    },
    [readOnly, scheduler, tracker]
  );

  // Assistant turn START snapshots the pre-batch document (the user→Robin
  // slice boundary); turn END checkpoints (uploads the turn's redlines) but
  // leaves the session open so user + assistant edits share it.
  useEffect(() => {
    if (!editor || !host || readOnly) return undefined;
    return onAssistantSessionChange(editor, (active) => {
      if (active) {
        try {
          lastSnapshotRef.current = editor.serialize();
        } catch {
          lastSnapshotRef.current = null;
        }
      } else {
        // An assistant turn ending no longer CLOSES the session — user and
        // assistant edits share one session (a version is cut on save / idle /
        // restore instead). Save its DOCX first, then checkpoint its redlines,
        // while keeping the session open. Every turn bypasses the highlight
        // throttle, but not the binding gate or ordered document-save queue.
        checkpointSession();
      }
    });
  }, [editor, host, readOnly, checkpointSession]);

  // Idle sessions close on their own.
  useEffect(() => {
    if (!host || readOnly) return undefined;
    const iv = setInterval(() => {
      if (engine.canPersist() && (!canSaveRef.current || canSaveRef.current()))
        tracker.checkIdle();
    }, IDLE_CHECK_MS);
    return () => clearInterval(iv);
  }, [host, readOnly, tracker, engine]);

  // Finalization/signing can make the editor read-only while a retry timer is
  // armed. No further autosave is valid once that transition happens.
  useEffect(() => {
    if (readOnly) scheduler.cancel();
  }, [readOnly, scheduler]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      documentEpochRef.current++;
      scheduler.cancel();
      engine.slices.clear();
      baselineRef.current = null;
      s0Ref.current = null;
      lastSnapshotRef.current = null;
      robinRunsRef.current = [];
      releaseFinalDiffRef.current?.();
      releaseFinalDiffRef.current = null;
      for (const sessionId of ownedSessions.current)
        clearLocalVersionArtifacts(sessionId);
      ownedSessions.current.clear();
    };
  }, [scheduler, engine]);

  useEffect(() => {
    const doc = featheryDoc();
    const checkpointBeforeHide = () => {
      if (
        doc.visibilityState === 'hidden' &&
        tracker.isOpen() &&
        engine.canPersist()
      )
        scheduler.flush().catch(() => undefined);
    };
    doc.addEventListener('visibilitychange', checkpointBeforeHide);
    return () =>
      doc.removeEventListener('visibilitychange', checkpointBeforeHide);
  }, [scheduler, tracker, engine]);

  const explicitSave = useCallback(async () => {
    if (!tracker.isOpen() && !engine.documentWrites.pending()) {
      await engine.flushArtifacts();
      await engine.retryArtifacts();
      setSaveError(null);
      return engine.documentWrites.flush();
    }
    if (!engine.canPersist() || (canSaveRef.current && !canSaveRef.current()))
      throw new DocumentPersistenceError(
        'Wait for the current edit or binding validation to finish before saving.',
        'blocked'
      );
    tracker.noteExplicitSave();
    const result = await engine.documentWrites.flush();
    await engine.flushArtifacts();
    await engine.retryArtifacts();
    setSaveError(null);
    setStatus(tracker.isOpen() ? 'dirty' : 'saved');
    return result;
  }, [tracker, engine]);

  const saveForRestore = useCallback(async () => {
    if (!engine.canPersist() || (canSaveRef.current && !canSaveRef.current()))
      throw new DocumentPersistenceError(
        'Wait for the current edit or binding validation to finish before restoring.',
        'blocked'
      );
    if (tracker.isOpen()) {
      holdFinalDiffForRestoreRef.current = true;
      tracker.noteExplicitSave();
    }
    await engine.documentWrites.flush();
  }, [tracker, engine]);

  const finishRestoreSave = useCallback(() => {
    const release = releaseFinalDiffRef.current;
    releaseFinalDiffRef.current = null;
    if (release) {
      // Let React paint the restored editor before CPU-heavy diffing begins.
      // The close endpoint accepts the preserved session after the restore, so
      // yielding one task does not change which history row receives it.
      setTimeout(release, 0);
    }
  }, []);

  const acceptTrackedChanges = useCallback(
    async (acceptance: TrackedChangeAcceptance, accept: () => void) => {
      const documentEpoch = documentEpochRef.current;
      // Cut the preceding editing session while the suggestion is still
      // pending. The confirmation then becomes a distinct version.
      if (!tracker.isOpen()) await preservePendingCurrentVersion(acceptance);
      if (documentEpoch !== documentEpochRef.current)
        throw new Error(
          'The document changed before the suggestion could be accepted'
        );
      while (tracker.isOpen()) {
        tracker.noteExplicitSave();
        await finalizeRef.current;
        if (documentEpoch !== documentEpochRef.current)
          throw new Error(
            'The document changed before the suggestion could be accepted'
          );
      }

      // A user can type while the preceding save is in flight. Flush that
      // session too and capture the actual pre-accept document, synchronously.
      acceptance = {
        ...acceptance,
        beforeSfdt: editorRef.current?.serialize() ?? acceptance.beforeSfdt
      };
      acceptanceRef.current = acceptance;
      baselineRef.current = acceptance.beforeSfdt;
      try {
        accept();
        // A native resolve can stall or settle only part of a group. Confirm
        // what actually left the document, never every revision requested by
        // the button (that would label still-live suggestions as approved).
        const beforeIds = new Set<string>(
          (JSON.parse(acceptance.beforeSfdt).revisions ?? []).map(
            (revision: any) => revision.revisionId
          )
        );
        const after = JSON.parse(editorRef.current.serialize());
        const pendingIds = new Set<string>(
          (after.revisions ?? []).map((revision: any) => revision.revisionId)
        );
        const resolvedIds = acceptance.revisionIds.filter(
          (id) => beforeIds.has(id) && !pendingIds.has(id)
        );
        if (!resolvedIds.length) {
          acceptanceRef.current = null;
          return;
        }
        acceptanceRef.current = { ...acceptance, revisionIds: resolvedIds };
        // Syncfusion normally emits contentChange synchronously. Keep the
        // persistence contract intact if a version emits no event here.
        if (!tracker.isOpen()) {
          s0Ref.current = acceptance.beforeSfdt;
          currentAuthorRef.current = ROBIN.key;
          tracker.noteEdit(ROBIN);
        }
        tracker.noteExplicitSave();
        await finalizeRef.current;
      } catch (error) {
        acceptanceRef.current = null;
        throw error;
      }
    },
    [preservePendingCurrentVersion, tracker]
  );

  const retry = useCallback(() => {
    explicitSave().catch(engine.reportError);
  }, [explicitSave, engine]);

  // Live equivalent of closeSession's diff, but returns the display document
  // instead of uploading. Used to show highlights for the in-progress current
  // version (no stored files yet). Reuses the exact same inputs and engine.
  const previewSession = useCallback((): SessionPreview | null => {
    const ed = editorRef.current;
    const sessionId = tracker.currentMeta()?.sessionId;
    if (!ed || !sessionId || !s0Ref.current || !engine.slices.isComplete())
      return null;
    try {
      const fDoc = JSON.parse(ed.serialize());
      const diffSlices = [
        ...engine.slices.all().map((s) => ({
          sfdt: JSON.parse(s.sfdt as string),
          author: s.author,
          endedAt: s.endedAt
        })),
        { sfdt: fDoc, author: currentAuthorRef.current }
      ];
      const startDoc = JSON.parse(s0Ref.current);
      // The backend removes net-zero versions. Do not display intermediate
      // author-boundary edits after the document has been fully undone.
      const unchanged =
        contentHash(normalizeForDiff(startDoc)) ===
        contentHash(normalizeForDiff(fDoc));
      const changes = diffSession(
        startDoc,
        unchanged
          ? [{ sfdt: fDoc, author: currentAuthorRef.current }]
          : diffSlices,
        sessionId,
        { timeBudgetMs: 4000 }
      );
      changes.attribution = 'slices';
      if (changes.degraded?.includes('time-budget')) return null;
      // Same re-attribution the stored close path applies (closeSession): hand
      // the captured Robin runs to applyHunks so a Robin edit the user just
      // accepted in THIS open session stays coloured as Robin in the live
      // "Current" preview instead of falling back to the viewer ('you').
      if (robinRunsRef.current.length) changes.robinRuns = robinRunsRef.current;
      const display = applyHunks(fDoc, changes);
      return {
        sessionId,
        authors: trackedAuthorKeys(display).map((key) =>
          key === ROBIN.key ? ROBIN : { ...currentUserRef.current, key }
        ),
        sfdt: JSON.stringify(display),
        // Same grouping as the steppers: a Robin turn counts as one edit.
        editCount: countEditGroups(display),
        formatCount: changes.formatChangeCount,
        pendingCount: countPendingGroups(display)
      };
    } catch {
      return null;
    }
  }, [engine, tracker]);

  const isSessionOpen = useCallback(() => tracker.isOpen(), [tracker]);

  return useMemo(
    () => ({
      error: saveError,
      status,
      savedAt,
      onEdit,
      save: explicitSave,
      saveForRestore,
      finishRestoreSave,
      retry,
      previewSession,
      isSessionOpen,
      acceptTrackedChanges
    }),
    [
      saveError,
      status,
      savedAt,
      onEdit,
      explicitSave,
      saveForRestore,
      finishRestoreSave,
      retry,
      previewSession,
      isSessionOpen,
      acceptTrackedChanges
    ]
  );
}
