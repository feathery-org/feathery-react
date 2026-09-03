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
import { contentHash, diffSession, normalizeForDiff } from './sfdtDiff/index';
import { createSessionTracker } from './sessionTracker';
import { createSliceStore } from './sliceStore';
import {
  DocxHistoryHost,
  DocxSaveMeta,
  SaveStatus,
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

export interface UseDocxHistorySessionResult {
  status: SaveStatus;
  savedAt: Date | null;
  /** Fire on every editor content change; index.tsx forwards useDocxEditor's
   *  onEdit here. */
  onEdit: (info: { assistant: boolean }) => void;
  /** Explicit Save: close the session now and resolve when it has persisted. */
  save: () => Promise<void>;
  retry: () => void;
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
  // The document as the session began, for the unchanged-session hash. (An
  // exact pre-first-edit S0 arrives with the diff PR; this is a close proxy.)
  const s0Ref = useRef<string | null>(null);
  // The author of the final segment (last boundary → close): the F slice's
  // author for the diff. Updated on every edit.
  const currentAuthorRef = useRef<string>('you');
  const finalizeRef = useRef<Promise<void>>(Promise.resolve());

  // Build the engine exactly once; its inner functions read the refs above.
  const engineRef = useRef<ReturnType<typeof buildEngine> | null>(null);
  if (!engineRef.current) engineRef.current = buildEngine();
  const engine = engineRef.current;

  function buildEngine() {
    const slices = createSliceStore();

    const closeSession = async (
      sessionId: string,
      authors: DocxSaveMeta['authors']
    ) => {
      const h = hostRef.current;
      const ed = editorRef.current;
      if (!h || !ed) return;
      const fStr = ed.serialize();
      const fDoc = JSON.parse(fStr);
      const finalSha256 = contentHash(normalizeForDiff(fDoc));
      const startSha256 = s0Ref.current
        ? contentHash(normalizeForDiff(JSON.parse(s0Ref.current)))
        : finalSha256;

      // Diff the session into per-author hunks. The stored slices are the
      // author-boundary snapshots; F is the closing state. A tab-death session
      // (no S0) or a diff failure degrades to docx-only (no highlights).
      let changesJson: Blob | undefined;
      let changeCount: number | null = null;
      let formatChangeCount: number | null = null;
      try {
        if (s0Ref.current) {
          const diffSlices = [
            ...slices.all().map((s) => ({
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
      await closeSession(meta.sessionId, meta.authors);
      slices.clear();
      s0Ref.current = null;
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
        if (ed) slices.push(ed.serialize(), author.key);
      },
      onClose: (reason, meta) => {
        if (reason === 'reset') {
          scheduler.cancel();
          slices.clear();
          s0Ref.current = null;
          return;
        }
        finalizeRef.current = finalizeSession(meta);
      }
    });

    return { slices, scheduler, tracker };
  }

  const { scheduler, tracker } = engine;

  const onEdit = useCallback(
    (info: { assistant: boolean }) => {
      if (readOnly || !hostRef.current) return;
      const ed = editorRef.current;
      if (!tracker.isOpen() && ed) s0Ref.current = ed.serialize();
      const actor = info.assistant ? ROBIN : currentUserRef.current;
      currentAuthorRef.current = actor.key;
      tracker.noteEdit(actor);
      scheduler.touch();
    },
    [readOnly, scheduler, tracker]
  );

  // Assistant turn end closes the session.
  useEffect(() => {
    if (!editor || !host || readOnly) return undefined;
    return onAssistantSessionChange(editor, (active) => {
      if (!active) tracker.noteTurnEnd();
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

  return { status, savedAt, onEdit, save: explicitSave, retry };
}
