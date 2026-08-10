import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  listRevisionGroups,
  resolveLiveRevisionGroupsAsOneUndo,
  resolveRevisionsAsOneUndo,
  RevisionGroupItem
} from '../../../../utils/documentEditorPrimitives';
import { isAssistantWriting } from '../../../../assistant/tools/docx/syncfusionDocumentOps';
import { featheryWindow } from '../../../../utils/browser';
import { isOpeningDocument, setActiveInlineRevisions } from '../useDocxEditor';
import BookmarkTab from './BookmarkTab';
import RailHead from './RailHead';
import GroupCard from './GroupCard';
import { ChipView, GroupView } from './types';
import { ACCENT_LINE, INK, LINE, PANEL } from './styles';

// Review rail for pending tracked changes: one card per assistant accept
// group (plus one per human author), expanding to −/+ diff "chips" with
// per-chip, per-card and rail-wide resolution — all through the
// non-cascading path as ONE undo unit. Resolved edits leave the rail;
// an undo brings them back via the contentChange refresh.
//
// This file owns all state and editor wiring; BookmarkTab / RailHead /
// GroupCard / ChangeChip are presentational.

interface Props {
  editor: any;
  /** Host-owned visibility (drawer handle, ✕, inline click all agree);
   *  stays mounted while hidden so the listeners keep running. */
  hidden?: boolean;
  onHiddenChange?: (hidden: boolean) => void;
}

// contentChange fires once per keystroke; one trailing refresh after typing
// pauses is enough for the rail (refresh walks every revision + getRange).
const CONTENT_REFRESH_DEBOUNCE_MS = 150;

const groupKeyOf = (changeSetId: string, group: string) =>
  `${changeSetId} ${group}`;

// Forces a real paint before `fn` runs. A single setTimeout(0) doesn't: the
// browser coalesces the state-update paint with whatever runs in the same
// frame, so the spinner never reached the screen for a fast resolve.
function afterNextPaint(fn: () => void): void {
  const win = featheryWindow() as any;
  if (typeof win.requestAnimationFrame !== 'function') {
    setTimeout(fn, 0);
    return;
  }
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    fn();
  };
  win.requestAnimationFrame(() => win.requestAnimationFrame(run));
  // Hidden tabs suspend rAF entirely; the timeout guarantees the deferred
  // work still runs (a hidden tab has no paint to wait for anyway).
  setTimeout(run, 100);
}

// The single containment boundary for editor faults in this file: one guard
// at each UI/EJ2 event entry (render/effect faults go to the host's
// RailErrorBoundary instead). Everything beneath it - reads, refreshes,
// resolution calls - throws normally, so a mid-operation failure surfaces
// here rather than being swallowed at its call site. Contained errors log at
// the browser's verbose/debug level: teardown noise stays out of production
// logs, but a RECURRING failure - a real regression - stays visible.
const handleEditorEvent = (fn: () => void) => {
  try {
    fn();
  } catch (error) {
    console.debug('Feathery: tracked-changes rail editor call failed.', error);
  }
};

// An instance on its way out is an EXPECTED state, not a fault: EJ2 throws on
// any touch of a destroyed editor, and the destroy can land between an
// isDestroyed check and the read after it. Such a read means "no editor" and
// nothing more. Anything else - a real fault in a read of a LIVE editor - is a
// programming error and must still reach the boundary, which is why this asks
// the instance rather than swallowing every failure here.
const isTornDown = (editor: any): boolean => {
  try {
    return !editor || editor.isDestroyed === true || !editor.revisions;
  } catch {
    return true;
  }
};

// 'update-premium-2026' -> 'Update premium 2026'. The id is the assistant's
// own kebab/snake label; render it as a title rather than as code.
const humanizeGroupId = (id: string) => {
  const spaced = id.replace(/[-_]+/g, ' ').trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : id;
};

// A chip is one EDIT, and an edit is a paragraph's worth of change backed by
// however many revisions SyncFusion authored for it - its runs, its paragraph
// mark, and for a replace both halves. Every resolve path must settle all of
// them with the one decision, or the chip's own paragraph boundary can be
// resolved the opposite way from its text.
const chipRevisions = (chip: ChipView) => [
  ...(chip.revisions ?? [chip.revision]),
  ...(chip.partnerRevisions ?? (chip.partner ? [chip.partner] : []))
];

const itemRevisions = (item: RevisionGroupItem) => [
  ...item.revisions,
  ...(item.partnerRevisions ?? [])
];

function TrackedChangeGroups({ editor, hidden, onHiddenChange }: Props) {
  // Only live (pending) revisions render; a resolved edit disappears from
  // the rail and reappears if the resolution is undone.
  const [groups, setGroups] = useState<GroupView[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Which bulk action is running, for RailHead's spinner. The resolve loop
  // is synchronous, so it's deferred past a paint (see afterNextPaint).
  const [resolvingAll, setResolvingAll] = useState<'accept' | 'reject' | null>(
    null
  );
  // The edits ringed in the document — a group-title click rings the whole
  // group. First entry is primary: what stepping and scroll-into-view use.
  const [activeRevisions, setActiveRevisions] = useState<any[]>([]);
  // Keyboard stepping reads this ref, not state: selectRevision echoes a
  // synchronous selectionChange that can resolve to a NEIGHBOUR and make
  // every arrow press skip an edit.
  const activeRevisionRef = useRef<any>(null);
  const ignoreSelectionRef = useRef(false);
  const rowRefs = useRef(new Map<any, HTMLDivElement>());
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollBoxRef = useRef<HTMLDivElement>(null);

  // Syncfusion steals focus into its editable div on every selection change;
  // panel actions must take it back or the next J/K press moves the DOCUMENT
  // CARET instead of stepping chips.
  const refocusPanel = () => {
    panelRef.current?.focus({ preventScroll: true });
  };

  const commitActiveRevisions = useCallback(
    (revisions: any[]) => {
      activeRevisionRef.current = revisions[0] ?? null;
      // Keep the previous state identity when nothing changed: every caret
      // move fires this, and a fresh [] each time would re-render the whole
      // rail per keystroke.
      setActiveRevisions((prev) =>
        prev.length === revisions.length &&
        revisions.every((revision, index) => revision === prev[index])
          ? prev
          : revisions
      );
      setActiveInlineRevisions(editor, revisions);
    },
    [editor]
  );
  const commitActiveRevision = useCallback(
    (revision: any) => commitActiveRevisions(revision ? [revision] : []),
    [commitActiveRevisions]
  );

  // Live revision count, for the new-edit fast path below.
  const lastRevisionCountRef = useRef(0);
  const revisionCount = useCallback(() => {
    const changes = editor?.revisions?.changes;
    if (Array.isArray(changes)) return changes.length;
    return editor?.revisions?.length ?? 0;
  }, [editor]);

  const refresh = useCallback(() => {
    const views = listRevisionGroups(editor);
    lastRevisionCountRef.current = revisionCount();
    // Neither a (re)load nor an assistant batch is something the user asked
    // to review, so nothing stays expanded through one.
    if (isOpeningDocument(editor) || isAssistantWriting(editor)) {
      setExpanded({});
    }
    setGroups(
      views.map((view) => ({
        key: groupKeyOf(view.changeSetId, view.group),
        changeSetId: view.changeSetId,
        group: view.group,
        // A human view's "group" IS the author name; keep it verbatim.
        title: view.untagged ? view.group : humanizeGroupId(view.group),
        untagged: view.untagged,
        chips: view.items.map((item) => ({
          revision: item.revision,
          revisions: item.revisions,
          partner: item.partner,
          partnerRevisions: item.partnerRevisions,
          revisionType: item.revisionType,
          text: item.text,
          beforeText: item.beforeText,
          author: item.author
        }))
      }))
    );
  }, [editor, revisionCount]);

  // contentChange fires once per keystroke. A change to the REVISION COUNT
  // (an edit arriving or resolving) lands in the rail immediately — the
  // inline wash and the selectionChange expansion already happened this
  // frame, and a card popping in a beat later reads as lag. Only text growth
  // inside an existing revision rides the trailing debounce. documentChange
  // (a DIFFERENT document opened in place) also rebuilds immediately.
  useEffect(() => {
    if (!editor) return;
    // EJ2 teardown race: a destroyed instance throws on any touch, so read it as "no editor".
    if (editor.isDestroyed) {
      setGroups([]);
      return;
    }
    // The read that reaches the host's boundary if it throws - and a destroy
    // racing this effect is not what that boundary is for.
    try {
      refresh();
    } catch (error) {
      if (!isTornDown(editor)) throw error;
      setGroups([]);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onContentChange = () =>
      handleEditorEvent(() => {
        clearTimeout(timer);
        // Every op changes the revision count, so refreshing immediately on
        // each one is O(n^2) across a batch whose intermediate state nobody
        // sees. Debounce instead: one refresh once the batch settles.
        const suppressed =
          isOpeningDocument(editor) || isAssistantWriting(editor);
        if (!suppressed && revisionCount() !== lastRevisionCountRef.current)
          refresh();
        else timer = setTimeout(refresh, CONTENT_REFRESH_DEBOUNCE_MS);
      });
    const onDocumentChange = () => handleEditorEvent(refresh);
    editor.addEventListener?.('contentChange', onContentChange);
    editor.addEventListener?.('documentChange', onDocumentChange);
    return () => {
      clearTimeout(timer);
      // EJ2 teardown race: destroy can land between this check and the
      // removeEventListener calls, so those need their own guard too.
      if (editor.isDestroyed) return;
      try {
        editor.removeEventListener?.('contentChange', onContentChange);
        editor.removeEventListener?.('documentChange', onDocumentChange);
      } catch {
        // Torn down mid-unsubscribe: nothing left to detach from.
      }
    };
  }, [editor, refresh, revisionCount]);

  // Inline click → rail navigation via the native cursor→revision mapping.
  // Programmatic chip focus sets ignoreSelectionRef so its selectionChange
  // echo cannot re-land on a neighbouring edit.
  useEffect(() => {
    // EJ2 teardown race: subscribing on a destroyed instance throws.
    if (!editor || editor.isDestroyed) return;
    const onSelectionChange = () =>
      handleEditorEvent(() => {
        if (ignoreSelectionRef.current) return;
        // Same window refresh() collapses for. Without this, each op expands
        // whichever group it lands on and refresh() collapses it right back.
        if (isOpeningDocument(editor) || isAssistantWriting(editor)) return;
        const current = editor.selection?.getCurrentRevision?.();
        const revisions: any[] = Array.isArray(current)
          ? current
          : current
          ? [current]
          : [];
        if (revisions.length) {
          for (const view of listRevisionGroups(editor)) {
            for (const item of view.items) {
              // Either half of a replace counts as clicking that one edit.
              if (!itemRevisions(item).some((rev) => revisions.includes(rev)))
                continue;
              const key = groupKeyOf(view.changeSetId, view.group);
              setExpanded((prev) =>
                prev[key] ? prev : { ...prev, [key]: true }
              );
              commitActiveRevision(item.revision);
              // An inline click is an explicit ask for the review panel.
              onHiddenChange?.(false);
              return;
            }
          }
        }
        // The cursor is not on an assistant edit: nothing is active.
        commitActiveRevision(null);
      });
    editor.addEventListener?.('selectionChange', onSelectionChange);
    return () => {
      // EJ2 teardown race: the destroy can land between this check and the
      // removeEventListener call, so isDestroyed alone isn't enough.
      if (!editor.isDestroyed) {
        try {
          editor.removeEventListener?.('selectionChange', onSelectionChange);
        } catch {
          // Torn down mid-unsubscribe: nothing left to detach from.
        }
      }
      activeRevisionRef.current = null;
      setActiveInlineRevisions(editor, []);
    };
  }, [editor, commitActiveRevision, onHiddenChange]);

  // Scroll only the rail's own scrollbox: scrollIntoView walks every
  // scrollable ancestor and would yank the whole form viewport.
  useEffect(() => {
    const primary = activeRevisions[0];
    if (!primary) return;
    const row = rowRefs.current.get(primary);
    const box = scrollBoxRef.current;
    if (!row || !box || box.scrollHeight <= box.clientHeight) return;
    const rowTop =
      row.getBoundingClientRect().top -
      box.getBoundingClientRect().top +
      box.scrollTop;
    const rowBottom = rowTop + row.offsetHeight;
    if (rowTop < box.scrollTop) box.scrollTop = rowTop;
    else if (rowBottom > box.scrollTop + box.clientHeight)
      box.scrollTop = rowBottom - box.clientHeight;
  });

  // Each native accept/reject moves the selection, firing a real
  // selectionChange — one unguarded rail rescan per revision without this.
  const suppressingSelectionEcho = (fn: () => void) => {
    ignoreSelectionRef.current = true;
    try {
      fn();
    } finally {
      queueMicrotask(() => {
        ignoreSelectionRef.current = false;
      });
    }
  };

  // Non-cascading resolve (native accept/reject settles whatever is
  // CONTIGUOUS, not the group), wrapped as ONE undo step.
  const resolveChips = (chips: ChipView[], isAccept: boolean) => {
    if (!chips.length) return;
    const revisions = chips.flatMap(chipRevisions).filter(Boolean);
    suppressingSelectionEcho(() =>
      resolveRevisionsAsOneUndo(editor, revisions, isAccept)
    );
    refresh();
    // Resolving the last edit unmounts the rail — focus would land on
    // <body>, where nobody sees the next ⌘Z.
    if (listRevisionGroups(editor).length) refocusPanel();
    else editor?.focusIn?.();
  };

  const resolveGroups = (groupViews: GroupView[], isAccept: boolean) => {
    suppressingSelectionEcho(() =>
      resolveLiveRevisionGroupsAsOneUndo(editor, groupViews, isAccept)
    );
    refresh();
    if (listRevisionGroups(editor).length) refocusPanel();
    else editor?.focusIn?.();
  };

  // Accept all / Reject all: the same resolve, but a big batch blocks long
  // enough to be worth a spinner. See afterNextPaint.
  const resolveAllWithSpinner = (
    groupViews: GroupView[],
    isAccept: boolean
  ) => {
    if (resolvingAll) return;
    setResolvingAll(isAccept ? 'accept' : 'reject');
    afterNextPaint(() => {
      handleEditorEvent(() => resolveGroups(groupViews, isAccept));
      setResolvingAll(null);
    });
  };

  // Suppresses selectRevision's selectionChange echo (sync + trailing
  // microtask) so it can't reassign activeRevisions, then moves the cursor.
  const selectAndScrollToRevision = (revision: any) =>
    suppressingSelectionEcho(() => {
      // skipGroupSelect keeps navigation on this exact revision — the public
      // revision.select() may expand to the adjacent same-author/type group.
      const selection = editor?.selectionModule;
      if (typeof selection?.selectRevision === 'function') {
        selection.selectRevision(revision, undefined, undefined, true);
        // Explicit scroll too: some host/layout combos suppress the implicit
        // one while focus stays in the rail.
        if (selection.start && selection.end) {
          editor.documentHelper?.scrollToPosition?.(
            selection.start,
            selection.end
          );
        }
      } else {
        revision?.select?.();
      }
    });

  const focusChip = (chip: ChipView) => {
    const group = groups.find((mem) => mem.chips.includes(chip));
    if (group) {
      setExpanded((prev) =>
        prev[group.key] ? prev : { ...prev, [group.key]: true }
      );
    }
    commitActiveRevision(chip.revision);
    selectAndScrollToRevision(chip.revision);
    refocusPanel();
  };

  // Group-title click: navigate to the group's first edit but ring every
  // chip, and never expand — that's the caret's job alone.
  const focusGroupFirst = (group: GroupView) => {
    if (!group.chips.length) return;
    commitActiveRevisions(group.chips.flatMap(chipRevisions));
    selectAndScrollToRevision(group.chips[0].revision);
    refocusPanel();
  };

  const allChips = groups.flatMap((group) => group.chips);

  // O(1) chip lookups: a group-title click puts a whole group's revisions in
  // here, and every chip of every card checks membership per render.
  const activeRevisionSet = useMemo(
    () => new Set(activeRevisions),
    [activeRevisions]
  );

  const onPanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const key = event.key.toLowerCase();
    // The rail holds focus for J/K/A/R, so Syncfusion never sees undo/redo
    // chords pressed here — forward them to the document history.
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      if (key === 'z' || key === 'y') {
        event.preventDefault();
        event.stopPropagation();
        const history = editor?.editorHistory ?? editor?.editorHistoryModule;
        if (key === 'y' || event.shiftKey) history?.redo?.();
        else history?.undo?.();
      }
      return;
    }
    if (event.altKey) return;
    if (
      key === 'j' ||
      key === 'arrowdown' ||
      key === 'k' ||
      key === 'arrowup'
    ) {
      if (!allChips.length) return;
      event.preventDefault();
      event.stopPropagation();
      const direction = key === 'j' || key === 'arrowdown' ? 1 : -1;
      const current = activeRevisionRef.current;
      const currentIndex = allChips.findIndex(
        (chip) => chip.revision === current || chip.partner === current
      );
      const nextIndex =
        currentIndex < 0
          ? direction > 0
            ? 0
            : allChips.length - 1
          : (currentIndex + direction + allChips.length) % allChips.length;
      // focusChip hands focus back to the rail after Syncfusion's selection
      // steals it, so the next J/K/arrow key stays with this handler.
      focusChip(allChips[nextIndex]);
      return;
    }
    if (key !== 'a' && key !== 'r') return;
    const current = activeRevisionRef.current;
    const focused = allChips.find(
      (chip) => chip.revision === current || chip.partner === current
    );
    if (!focused) return;
    event.preventDefault();
    event.stopPropagation();
    resolveChips([focused], key === 'a');
  };

  if (!groups.length) return null;

  return (
    <div
      css={{
        position: 'relative',
        display: 'flex',
        flex: '0 0 auto',
        minHeight: 0
      }}
    >
      {onHiddenChange && hidden && (
        <BookmarkTab onExpand={() => onHiddenChange(false)} />
      )}
      {!hidden && (
        <div
          ref={panelRef}
          aria-label='Assistant tracked changes'
          tabIndex={0}
          onKeyDown={(event) => handleEditorEvent(() => onPanelKeyDown(event))}
          css={{
            width: 340,
            flex: '0 0 auto',
            borderLeft: `1px solid ${LINE}`,
            background: PANEL,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            fontSize: 13,
            color: INK,
            outline: 'none',
            '&:focus-visible': {
              boxShadow: `inset 0 0 0 2px ${ACCENT_LINE}`
            }
          }}
        >
          <RailHead
            pendingCount={allChips.length}
            onHide={onHiddenChange ? () => onHiddenChange(true) : undefined}
            onResolveAll={(isAccept) => resolveAllWithSpinner(groups, isAccept)}
            resolvingAll={resolvingAll}
          />
          <div
            ref={scrollBoxRef}
            css={{
              overflowY: 'auto',
              padding: '12px 12px 40px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              flex: 1,
              minHeight: 0
            }}
          >
            {groups.map((mem) => (
              <GroupCard
                key={mem.key}
                group={mem}
                isOpen={!!expanded[mem.key]}
                onToggle={() =>
                  setExpanded((prev) => ({
                    ...prev,
                    [mem.key]: !prev[mem.key]
                  }))
                }
                onNavigateFirst={() =>
                  handleEditorEvent(() => focusGroupFirst(mem))
                }
                activeRevisions={activeRevisionSet}
                chipRef={(chip) => (el) => {
                  if (el) rowRefs.current.set(chip.revision, el);
                  else rowRefs.current.delete(chip.revision);
                }}
                onFocusChip={(chip) => handleEditorEvent(() => focusChip(chip))}
                onResolveGroup={(isAccept) =>
                  handleEditorEvent(() => resolveGroups([mem], isAccept))
                }
                onResolveChips={(chips, isAccept) =>
                  handleEditorEvent(() => resolveChips(chips, isAccept))
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default TrackedChangeGroups;
