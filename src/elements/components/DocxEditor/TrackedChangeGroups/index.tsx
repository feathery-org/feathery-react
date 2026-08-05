import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  listRevisionGroups,
  resolveRevisionsAsOneUndo,
  RevisionGroupItem
} from '../../../../assistant/tools/docx/syncfusionDocumentOps';
import { setActiveInlineRevision } from '../useDocxEditor';
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

// 'update-premium-2026' -> 'Update premium 2026'. The id is the assistant's
// own kebab/snake label; render it as a title rather than as code.
const humanizeGroupId = (id: string) => {
  const spaced = id.replace(/[-_]+/g, ' ').trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : id;
};

// A replace chip is one edit backed by two revisions; every resolve path
// must settle both with the one decision.
const chipRevisions = (chip: ChipView) =>
  chip.partner ? [chip.revision, chip.partner] : [chip.revision];

const itemRevisions = (item: RevisionGroupItem) =>
  item.partner ? [item.revision, item.partner] : [item.revision];

function TrackedChangeGroups({ editor, hidden, onHiddenChange }: Props) {
  // Only live (pending) revisions render; a resolved edit disappears from
  // the rail and reappears if the resolution is undone.
  const [groups, setGroups] = useState<GroupView[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // The edit the document cursor sits inside (or the chip last clicked);
  // its chip is expanded, ringed, scrolled to, and shows its own actions.
  const [activeRevision, setActiveRevision] = useState<any>(null);
  // Keyboard stepping reads this ref, not state: selectRevision echoes a
  // synchronous selectionChange that can resolve to a NEIGHBOUR and make
  // every arrow press skip an edit.
  const activeRevisionRef = useRef<any>(null);
  const ignoreSelectionRef = useRef(false);
  const rowRefs = useRef(new Map<any, HTMLDivElement>());
  const panelRef = useRef<HTMLDivElement>(null);

  // Syncfusion steals focus into its editable div on every selection change;
  // panel actions must take it back or the next J/K press moves the DOCUMENT
  // CARET instead of stepping chips.
  const refocusPanel = () => {
    panelRef.current?.focus({ preventScroll: true });
  };

  const commitActiveRevision = useCallback(
    (revision: any) => {
      activeRevisionRef.current = revision;
      setActiveRevision(revision);
      setActiveInlineRevision(editor, revision);
    },
    [editor]
  );

  const refresh = useCallback(() => {
    let views: ReturnType<typeof listRevisionGroups> = [];
    try {
      views = listRevisionGroups(editor);
    } catch {
      views = [];
    }
    setGroups(
      views.map((view) => ({
        key: groupKeyOf(view.changeSetId, view.group),
        // A human view's "group" IS the author name; keep it verbatim.
        title: view.untagged ? view.group : humanizeGroupId(view.group),
        untagged: view.untagged,
        chips: view.items.map((item) => ({
          revision: item.revision,
          partner: item.partner,
          revisionType: item.revisionType,
          text: item.text,
          beforeText: item.beforeText,
          author: item.author
        }))
      }))
    );
  }, [editor]);

  // contentChange (edits, resolutions, undo — one per keystroke) refreshes
  // on a trailing debounce; documentChange (a DIFFERENT document opened in
  // place) rebuilds immediately so stale cards never linger.
  useEffect(() => {
    if (!editor) return;
    refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const debouncedRefresh = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, CONTENT_REFRESH_DEBOUNCE_MS);
    };
    editor.addEventListener?.('contentChange', debouncedRefresh);
    editor.addEventListener?.('documentChange', refresh);
    return () => {
      clearTimeout(timer);
      editor.removeEventListener?.('contentChange', debouncedRefresh);
      editor.removeEventListener?.('documentChange', refresh);
    };
  }, [editor, refresh]);

  // Inline click → rail navigation via the native cursor→revision mapping.
  // Programmatic chip focus sets ignoreSelectionRef so its selectionChange
  // echo cannot re-land on a neighbouring edit.
  useEffect(() => {
    if (!editor) return;
    const onSelectionChange = () => {
      if (ignoreSelectionRef.current) return;
      let revisions: any[] = [];
      try {
        const current = editor.selection?.getCurrentRevision?.();
        revisions = Array.isArray(current) ? current : current ? [current] : [];
      } catch {
        revisions = [];
      }
      if (revisions.length) {
        try {
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
        } catch {
          // A torn-down selection mid-teardown must not take the panel down.
        }
      }
      // The cursor is not on an assistant edit: nothing is active.
      commitActiveRevision(null);
    };
    editor.addEventListener?.('selectionChange', onSelectionChange);
    return () => {
      editor.removeEventListener?.('selectionChange', onSelectionChange);
      activeRevisionRef.current = null;
      setActiveInlineRevision(editor, null);
    };
  }, [editor, commitActiveRevision, onHiddenChange]);

  // Bring the newly active chip into view once it exists (its group may have
  // been collapsed until this same update expanded it).
  useEffect(() => {
    if (!activeRevision) return;
    rowRefs.current.get(activeRevision)?.scrollIntoView?.({
      block: 'nearest'
    });
  });

  // Non-cascading resolve (native accept/reject settles whatever is
  // CONTIGUOUS, not the group), wrapped as ONE undo step.
  const settleRevisions = (revisions: any[], isAccept: boolean) => {
    try {
      resolveRevisionsAsOneUndo(editor, revisions, isAccept);
    } catch {
      // A stale revision range must not take the panel down.
    }
  };

  const resolveChips = (chips: ChipView[], isAccept: boolean) => {
    if (!chips.length) return;
    const revisions = chips.flatMap(chipRevisions).filter(Boolean);
    settleRevisions(revisions, isAccept);
    refresh();
    // Resolving the last edit unmounts the rail — focus would land on
    // <body>, where nobody sees the next ⌘Z.
    let remaining = 0;
    try {
      remaining = listRevisionGroups(editor).length;
    } catch {
      remaining = 0;
    }
    if (remaining) refocusPanel();
    else editor?.focusIn?.();
  };

  const focusChip = (chip: ChipView) => {
    const group = groups.find((mem) => mem.chips.includes(chip));
    if (group) {
      setExpanded((prev) =>
        prev[group.key] ? prev : { ...prev, [group.key]: true }
      );
    }
    commitActiveRevision(chip.revision);
    // Suppress selectRevision's selectionChange echo (sync + trailing
    // microtask) so it cannot reassign activeRevision.
    ignoreSelectionRef.current = true;
    try {
      // skipGroupSelect keeps navigation on this exact chip — the public
      // revision.select() may expand to the adjacent same-author/type group.
      const selection = editor?.selectionModule;
      if (typeof selection?.selectRevision === 'function') {
        selection.selectRevision(chip.revision, undefined, undefined, true);
        // Explicit scroll too: some host/layout combos suppress the implicit
        // one while focus stays in the rail.
        if (selection.start && selection.end) {
          editor.documentHelper?.scrollToPosition?.(
            selection.start,
            selection.end
          );
        }
      } else {
        chip.revision?.select?.();
      }
    } catch {
      // Navigation is best-effort; a disposed range is simply not selectable.
    } finally {
      queueMicrotask(() => {
        ignoreSelectionRef.current = false;
      });
    }
    refocusPanel();
  };

  const allChips = groups.flatMap((group) => group.chips);

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
          onKeyDown={onPanelKeyDown}
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
            onResolveAll={(isAccept) => resolveChips(allChips, isAccept)}
          />
          <div
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
                activeRevision={activeRevision}
                chipRef={(chip) => (el) => {
                  if (el) rowRefs.current.set(chip.revision, el);
                  else rowRefs.current.delete(chip.revision);
                }}
                onFocusChip={focusChip}
                onResolveChips={resolveChips}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default TrackedChangeGroups;
