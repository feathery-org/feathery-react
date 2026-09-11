// Ties the pure autosave engine (tracker + slice store + scheduler) to a live
// DocumentEditor and the history I/O host. It owns nothing the engine already
// owns; it only bridges editor signals in and persistence out.
//
// PR 2 scope: sessions drive an autosave PATCH carrying the session id, and a
// session close persists the final document. The close-time DIFF (per-author
// highlights) lands in a later PR — closeVersion is called with F only, and a
// backend that has not shipped the close endpoint yet simply leaves the row
// with its docx pair (a one-colour fallback at view time).
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  isAssistantWriting,
  onAssistantSessionChange
} from '../../../../assistant/tools/docx/syncfusionDocumentOps';
import { isOpeningDocument } from '../useDocxEditor';
import { createAutosaveScheduler } from './autosaveScheduler';
import {
  applyHunks,
  contentHash,
  countEditGroups,
  countPendingGroups,
  diffSession,
  normalizeForDiff
} from './sfdtDiff/index';
import { createSessionTracker } from './sessionTracker';
import { createSliceStore } from './sliceStore';
import {
  DocxHistoryHost,
  DocxSaveMeta,
  SaveStatus,
  Slice,
  VersionAuthor
} from './types';

const ROBIN: VersionAuthor = {
  kind: 'assistant',
  key: 'robin',
  label: 'Robin'
};
const IDLE_CHECK_MS = 30_000;

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
  save: (blob: Blob, meta: DocxSaveMeta) => Promise<void>;
  /** Extra gate (the binding soft-gate): autosave holds while it is false. */
  canSave?: () => boolean;
}

/** The current session's live change list, as the viewer would render a stored
 *  version: `sfdt` is the applyHunks display document (highlights baked in). */
export interface SessionPreview {
  sfdt: string;
  editCount: number;
  formatCount: number;
  /** Assistant edits still tracked (not yet accepted) in this preview. */
  pendingCount: number;
}

export interface UseDocxHistorySessionResult {
  status: SaveStatus;
  savedAt: Date | null;
  /** Fire on every editor content change; index.tsx forwards useDocxEditor's
   *  onEdit here. */
  onEdit: (info: { assistant: boolean }) => void;
  /** Explicit Save: close the session now and resolve when it has persisted. */
  save: () => Promise<void>;
  retry: () => void;
  /** Diff the OPEN session live (same inputs as the close-time diff) and return
   *  a highlighted display document for the in-progress current version, which
   *  has no stored files yet. Null when no session is open or nothing changed. */
  previewSession: () => SessionPreview | null;
}

async function gzip(text: string): Promise<Blob> {
  // S3 serves the .gz verbatim and the viewer inflates; a runtime without
  // CompressionStream (older jsdom) falls back to the raw bytes.
  const CS = (globalThis as any).CompressionStream;
  if (typeof CS === 'undefined') return new Blob([text]);
  const stream = new Blob([text]).stream().pipeThrough(new CS('gzip'));
  return new Response(stream).blob();
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

  const [status, setStatus] = useState<SaveStatus>('clean');
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // Live inputs behind refs so the engine (built once) reads fresh values.
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
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
  // The document serialized at the instant an assistant turn STARTS. The
  // user→Robin slice boundary only fires on Robin's first contentChange — by
  // then the document already holds that first assistant op, so serializing at
  // the boundary would attribute it to the user. This pre-batch snapshot is the
  // correct end of the user's slice.
  const preTurnSnapshotRef = useRef<string | null>(null);
  const finalizeRef = useRef<Promise<void>>(Promise.resolve());

  // Build the engine exactly once; its inner functions read the refs above.
  const engineRef = useRef<ReturnType<typeof buildEngine> | null>(null);
  if (!engineRef.current) engineRef.current = buildEngine();
  const engine = engineRef.current;

  function buildEngine() {
    const slices = createSliceStore();

    // The closing session's diff inputs, captured SYNCHRONOUSLY at close time.
    // Anything serialized later (after the PATCH round-trip) can already carry
    // the next session's edits — or a binding/engine write that flipped the
    // last-edit author to the viewer — which is exactly how assistant edits
    // were being mis-attributed.
    interface CloseSnapshot {
      fStr: string | null;
      fAuthor: string;
      s0: string | null;
      slices: Slice[];
    }

    const closeSession = async (
      sessionId: string,
      authors: DocxSaveMeta['authors'],
      snap: CloseSnapshot
    ) => {
      const h = hostRef.current;
      if (!h || !snap.fStr) return;
      const fStr = snap.fStr;
      const fDoc = JSON.parse(fStr);
      const finalSha256 = contentHash(normalizeForDiff(fDoc));
      const startSha256 = snap.s0
        ? contentHash(normalizeForDiff(JSON.parse(snap.s0)))
        : finalSha256;

      // Diff the session into per-author hunks. The stored slices are the
      // author-boundary snapshots; F is the closing state. A tab-death session
      // (no S0) or a diff failure degrades to docx-only (no highlights).
      let changesJson: Blob | undefined;
      let changeCount: number | null = null;
      let formatChangeCount: number | null = null;
      try {
        if (snap.s0) {
          const diffSlices = [
            ...snap.slices.map((s) => ({
              sfdt: JSON.parse(s.sfdt as string),
              author: s.author,
              endedAt: s.endedAt
            })),
            { sfdt: fDoc, author: snap.fAuthor }
          ];
          const changes = diffSession(
            JSON.parse(snap.s0),
            diffSlices,
            sessionId,
            {
              timeBudgetMs: 4000
            }
          );
          changeCount = changes.changeCount;
          formatChangeCount = changes.formatChangeCount;
          changesJson = await gzip(JSON.stringify(changes));
        }
      } catch {
        // Diff failed (unexpected SFDT shape, over budget): upload F alone so
        // the version still opens, with the one-colour fallback at view time.
        changesJson = undefined;
        changeCount = null;
        formatChangeCount = null;
      }

      try {
        await h.closeVersion(sessionId, {
          finalSfdtGz: await gzip(fStr),
          changesJson,
          changeCount,
          formatChangeCount,
          finalSha256,
          startSha256,
          authors
        });
      } catch {
        // Backend close endpoint unreachable: the row keeps its docx pair and
        // views with the one-colour fallback.
      }
    };

    const finalizeSession = async (meta: {
      sessionId: string;
      sessionStartedAt: string;
      authors: DocxSaveMeta['authors'];
    }) => {
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
      const snap = {
        fStr,
        fAuthor: currentAuthorRef.current,
        s0: s0Ref.current,
        slices: slices.all()
      };
      slices.clear();
      s0Ref.current = null;
      preTurnSnapshotRef.current = null;
      // The just-closed document is the baseline for the NEXT session's diff —
      // set it now so edits landing while this close is in flight diff cleanly
      // into their own session.
      baselineRef.current = fStr;
      try {
        const blob = await exportRef.current();
        await saveRef.current(blob, {
          sessionId: meta.sessionId,
          sessionStartedAt: meta.sessionStartedAt,
          authors: meta.authors,
          closeSession: true
        });
        setSavedAt(new Date());
        setStatus('saved');
      } catch {
        setStatus('error');
      }
      await closeSession(meta.sessionId, meta.authors, snap);
    };

    const scheduler = createAutosaveScheduler({
      save: async () => {
        const meta = tracker.currentMeta();
        if (!meta) return;
        const blob = await exportRef.current();
        await saveRef.current(blob, {
          sessionId: meta.sessionId,
          sessionStartedAt: meta.sessionStartedAt,
          authors: meta.authors
        });
      },
      canSave: () => {
        const ed = editorRef.current;
        if (!ed || loadingRef.current) return false;
        if (isOpeningDocument(ed) || isAssistantWriting(ed)) return false;
        return canSaveRef.current ? canSaveRef.current() : true;
      },
      onStatus: (s) => {
        setStatus(s);
        if (s === 'saved') setSavedAt(new Date());
      }
    });

    const tracker = createSessionTracker({
      onSliceBoundary: (author) => {
        const ed = editorRef.current;
        if (!ed) return;
        // The boundary fires on the incoming author's FIRST contentChange, so
        // the live document already contains that edit. For the user→Robin
        // switch we snapshotted the document at the turn-start edge — use it so
        // the outgoing user slice ends exactly where the user stopped and
        // Robin's first op is attributed to Robin, not the user.
        const preTurn = preTurnSnapshotRef.current;
        preTurnSnapshotRef.current = null;
        try {
          slices.push(preTurn ?? ed.serialize(), author.key);
        } catch {
          // Slice lost: the diff falls back to coarser attribution.
        }
      },
      onClose: (reason, meta) => {
        if (reason === 'reset') {
          scheduler.cancel();
          slices.clear();
          s0Ref.current = null;
          preTurnSnapshotRef.current = null;
          // A new document invalidates the old baseline; the open-capture effect
          // snapshots the fresh one.
          baselineRef.current = null;
          return;
        }
        finalizeRef.current = finalizeSession(meta);
      }
    });

    return { slices, scheduler, tracker };
  }

  const { scheduler, tracker } = engine;

  // Snapshot the pristine document as the diff baseline once it finishes opening
  // and no session is in flight. This is the true pre-edit S0 the diff needs;
  // capturing it at edit time is too late (contentChange fires post-edit).
  useEffect(() => {
    if (readOnly || loading || !editor) return;
    if (tracker.isOpen()) return; // Mid-session: don't clobber the baseline.
    try {
      baselineRef.current = editor.serialize();
    } catch {
      /* keep whatever baseline we had */
    }
  }, [editor, loading, readOnly, tracker]);

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
      const actor = info.assistant ? ROBIN : currentUserRef.current;
      currentAuthorRef.current = actor.key;
      tracker.noteEdit(actor);
      scheduler.touch();
    },
    [readOnly, scheduler, tracker]
  );

  // Assistant turn START snapshots the pre-batch document (the user→Robin
  // slice boundary); turn END closes the session.
  useEffect(() => {
    if (!editor || !host || readOnly) return undefined;
    return onAssistantSessionChange(editor, (active) => {
      if (active) {
        try {
          preTurnSnapshotRef.current = editor.serialize();
        } catch {
          preTurnSnapshotRef.current = null;
        }
      } else {
        preTurnSnapshotRef.current = null;
        tracker.noteTurnEnd();
      }
    });
  }, [editor, host, readOnly, tracker]);

  // Idle sessions close on their own.
  useEffect(() => {
    if (!host || readOnly) return undefined;
    const iv = setInterval(() => tracker.checkIdle(), IDLE_CHECK_MS);
    return () => clearInterval(iv);
  }, [host, readOnly, tracker]);

  // A new document (regenerate / envelope change) abandons the open session.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    tracker.reset();
  }, [envelopeId, openNonce, tracker]);

  const explicitSave = useCallback(async () => {
    tracker.noteExplicitSave();
    await finalizeRef.current;
  }, [tracker]);

  const retry = useCallback(() => scheduler.touch(), [scheduler]);

  // Live equivalent of closeSession's diff, but returns the display document
  // instead of uploading. Used to show highlights for the in-progress current
  // version (no stored files yet). Reuses the exact same inputs and engine.
  const previewSession = useCallback((): SessionPreview | null => {
    const ed = editorRef.current;
    if (!ed || !s0Ref.current) return null;
    try {
      const fDoc = JSON.parse(ed.serialize());
      const sessionId = tracker.currentMeta()?.sessionId ?? 'preview';
      const diffSlices = [
        ...engine.slices.all().map((s) => ({
          sfdt: JSON.parse(s.sfdt as string),
          author: s.author,
          endedAt: s.endedAt
        })),
        { sfdt: fDoc, author: currentAuthorRef.current }
      ];
      const changes = diffSession(
        JSON.parse(s0Ref.current),
        diffSlices,
        sessionId,
        { timeBudgetMs: 4000 }
      );
      if (!changes.hunks.length) return null;
      const display = applyHunks(fDoc, changes);
      return {
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

  return { status, savedAt, onEdit, save: explicitSave, retry, previewSession };
}
