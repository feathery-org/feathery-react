import React, {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState
} from 'react';
import {
  listRevisionGroups,
  resolveRevisionsAsOneUndo,
  RevisionGroupItem
} from '../../../assistant/tools/syncfusionDocumentOps';
import { setActiveInlineRevision } from './useDocxEditor';

// Review rail for assistant-authored tracked changes, one card per accept
// group. A card expands to its individual edits ("chips"), each rendered as
// a −/+ diff; the focused chip carries its own Accept/Reject, the card
// carries group-wide ones, and the rail head carries Accept all/Reject all.
// Resolution goes through the non-cascading single-revision path wrapped as
// ONE undo unit. Resolved chips stay visible with their verdict (faded), and
// a fully resolved group collapses to a "done" card — a session memory,
// cleared when a different document opens. Human tracked edits carry no
// group tag and are never shown here.

interface Props {
  editor: any;
  /** Controlled visibility: the host owns it so the drawer handle, the
   *  panel's own ✕, and click-on-an-inline-edit all agree. The component
   *  stays mounted while hidden so those listeners keep running. */
  hidden?: boolean;
  onHiddenChange?: (hidden: boolean) => void;
  /** Lets the host show one undo toast for every panel resolution. */
  onResolve?: (message: string) => void;
}

type Verdict = 'accepted' | 'rejected' | 'resolved';

/** One edit as the rail remembers it: live while pending, snapshot after. */
interface ChipMem {
  revision: any;
  partner?: any;
  revisionType: string;
  text: string;
  beforeText?: string;
  author?: string;
  verdict?: Verdict;
}

interface GroupMem {
  key: string;
  title: string;
  /** One author's manual edits rather than an assistant accept group. */
  untagged?: boolean;
  chips: ChipMem[];
}

// ---------------------------------------------------------------------------
// Design tokens (mockup light palette).
// ---------------------------------------------------------------------------
const INK = '#171a1c';
const INK_2 = '#464c50';
const INK_3 = '#6b7276';
const LINE = '#e0e4e6';
const LINE_STRONG = '#c8cfd2';
const PANEL = '#f8f9fa';
const PANEL_2 = '#f1f3f4';
const PANEL_3 = '#e6eaec';
const PAPER = '#ffffff';
const ADD = '#0e7a4d';
const ADD_WASH = 'rgba(14, 122, 77, 0.11)';
const DEL = '#b0302b';
const DEL_WASH = 'rgba(176, 48, 43, 0.10)';
const MOD = '#8a5a0e';
const MOD_WASH = 'rgba(138, 90, 14, 0.13)';
const ACCENT_LINE = 'rgba(43, 49, 52, 0.34)';
const ACCENT_WASH = 'rgba(43, 49, 52, 0.07)';
const MONO =
  '"SF Mono", ui-monospace, "JetBrains Mono", "Cascadia Mono", Menlo, Consolas, monospace';
const CARD_SHADOW = '0 1px 2px rgba(23, 26, 28, 0.06)';

const btn = {
  height: 27,
  flex: 1,
  border: `1px solid ${LINE_STRONG}`,
  borderRadius: 8,
  background: PAPER,
  color: INK_2,
  fontSize: 11.5,
  fontWeight: 550,
  cursor: 'pointer',
  padding: 0,
  whiteSpace: 'nowrap' as const,
  '&:hover': { background: PANEL_3, color: INK },
  '&:disabled': { opacity: 0.36, cursor: 'default' }
};

// Reject warms to red on hover; accept stays neutral (mockup behavior).
const rejectBtn = {
  ...btn,
  '&:hover': { borderColor: '#d08984', color: DEL, background: DEL_WASH }
};

const groupKeyOf = (changeSetId: string, group: string) =>
  `${changeSetId} ${group}`;

// 'update-premium-2026' -> 'Update premium 2026'. The id is the assistant's
// own kebab/snake label; render it as a title rather than as code.
const humanizeGroupId = (id: string) => {
  const spaced = id.replace(/[-_]+/g, ' ').trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : id;
};

const badgeOf = (revisionType: string) => {
  if (revisionType === 'Insertion' || revisionType === 'MoveTo')
    return { label: 'Added', color: ADD, background: ADD_WASH };
  if (revisionType === 'Deletion' || revisionType === 'MoveFrom')
    return { label: 'Removed', color: DEL, background: DEL_WASH };
  if (revisionType === 'Replace')
    return { label: 'Replaced', color: MOD, background: MOD_WASH };
  return { label: 'Edit', color: INK_2, background: PANEL_3 };
};

const resolutionLabelOf = (chip: ChipMem) => {
  if (chip.revisionType === 'Insertion' || chip.revisionType === 'MoveTo')
    return 'Added';
  if (chip.revisionType === 'Deletion' || chip.revisionType === 'MoveFrom')
    return 'Removed';
  if (chip.revisionType === 'Replace') return 'Modified';
  return 'Tracked';
};

// The −/+ rows a chip's diff shows.
const diffRowsOf = (chip: ChipMem) => {
  const rows: Array<{ sign: '−' | '+'; text: string; del: boolean }> = [];
  if (chip.revisionType === 'Replace') {
    rows.push({ sign: '−', text: chip.beforeText ?? '', del: true });
    rows.push({ sign: '+', text: chip.text, del: false });
  } else if (
    chip.revisionType === 'Deletion' ||
    chip.revisionType === 'MoveFrom'
  ) {
    rows.push({ sign: '−', text: chip.text, del: true });
  } else {
    rows.push({ sign: '+', text: chip.text, del: false });
  }
  return rows;
};

// A replace chip is one edit backed by two revisions; every resolve path
// must settle both with the one decision.
const chipRevisions = (chip: ChipMem) =>
  chip.partner ? [chip.revision, chip.partner] : [chip.revision];

const itemRevisions = (item: RevisionGroupItem) =>
  item.partner ? [item.revision, item.partner] : [item.revision];

const caretSvg = (
  <svg width='11' height='11' viewBox='0 0 16 16' fill='none' aria-hidden>
    <path
      d='M6 3.5 10.5 8 6 12.5'
      stroke='currentColor'
      strokeWidth='1.8'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

function TrackedChangeGroups({
  editor,
  hidden,
  onHiddenChange,
  onResolve
}: Props) {
  // Session memory of every edit the rail has seen, keyed by group. Live
  // items merge into it on refresh; resolved chips keep their snapshot and
  // verdict. Mutated in place, with a reducer tick to re-render.
  const memoryRef = useRef<Map<string, GroupMem>>(new Map());
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // The edit the document cursor sits inside (or the chip last clicked);
  // its chip is expanded, ringed, scrolled to, and shows its own actions.
  const [activeRevision, setActiveRevision] = useState<any>(null);
  // Mirrors activeRevision for keyboard stepping: selectRevision fires
  // selectionChange synchronously, and that handler must not fight the
  // chip we just chose (it can resolve to a neighbour and skip every other
  // edit). The ref is the keyboard handler's source of truth.
  const activeRevisionRef = useRef<any>(null);
  const ignoreSelectionRef = useRef(false);
  const rowRefs = useRef(new Map<any, HTMLDivElement>());
  const panelRef = useRef<HTMLDivElement>(null);

  // Syncfusion's enableAutoFocus steals keyboard focus into its editable div
  // whenever the selection changes (selectRevision, accept/reject re-layout).
  // Every panel-initiated action must hand focus back to the rail, or the
  // next arrow/J/K press moves the DOCUMENT CARET instead of stepping chips —
  // which reads as the keyboard skipping edits.
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
    const memory = memoryRef.current;
    let views: ReturnType<typeof listRevisionGroups> = [];
    try {
      views = listRevisionGroups(editor);
    } catch {
      views = [];
    }
    const matched = new Set<ChipMem>();
    for (const view of views) {
      const key = groupKeyOf(view.changeSetId, view.group);
      let mem = memory.get(key);
      if (!mem) {
        mem = {
          key,
          // A human view's "group" IS the author name; keep it verbatim.
          title: view.untagged ? view.group : humanizeGroupId(view.group),
          untagged: view.untagged,
          chips: []
        };
        memory.set(key, mem);
      }
      for (const item of view.items) {
        const revs = itemRevisions(item);
        let chip = mem.chips.find((c) =>
          revs.some((rev) => rev === c.revision || rev === c.partner)
        );
        if (!chip) {
          // An undone resolution comes back as NEW revision objects; revive
          // the matching snapshot by content instead of duplicating it.
          chip = mem.chips.find(
            (c) =>
              !!c.verdict &&
              !matched.has(c) &&
              c.revisionType === item.revisionType &&
              c.text === item.text &&
              c.beforeText === item.beforeText
          );
        }
        if (chip) {
          chip.revision = item.revision;
          chip.partner = item.partner;
          chip.revisionType = item.revisionType;
          chip.text = item.text;
          chip.beforeText = item.beforeText;
          chip.author = item.author;
          chip.verdict = undefined;
          matched.add(chip);
        } else {
          const fresh: ChipMem = {
            revision: item.revision,
            partner: item.partner,
            revisionType: item.revisionType,
            text: item.text,
            beforeText: item.beforeText,
            author: item.author
          };
          mem.chips.push(fresh);
          matched.add(fresh);
        }
      }
    }
    // A chip that vanished without a panel verdict was resolved elsewhere.
    for (const mem of memory.values()) {
      for (const chip of mem.chips) {
        if (!matched.has(chip) && !chip.verdict) chip.verdict = 'resolved';
      }
    }
    bump();
  }, [editor]);

  // Assistant edits, manual edits and accept/reject all land as content
  // changes; documentChange means a DIFFERENT document opened in place, so
  // the review memory starts over.
  useEffect(() => {
    if (!editor) return;
    refresh();
    const onDocumentChange = () => {
      memoryRef.current.clear();
      refresh();
    };
    editor.addEventListener?.('contentChange', refresh);
    editor.addEventListener?.('documentChange', onDocumentChange);
    return () => {
      editor.removeEventListener?.('contentChange', refresh);
      editor.removeEventListener?.('documentChange', onDocumentChange);
    };
  }, [editor, refresh]);

  // Clicking a tracked change inline in the document navigates the rail to
  // that edit. getCurrentRevision() is the same cursor→revision mapping the
  // native pane uses on selection change; recompute the groups inside the
  // handler so the lookup never works from a stale closure.
  // Programmatic chip focus (keyboard/click) selects a revision on purpose —
  // ignore the echo selectionChange so Syncfusion's cursor mapping cannot
  // overwrite the chip we just stepped to (adjacent edits otherwise land on
  // the neighbour and every arrow key appears to skip one).
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

  // Resolve a set of revisions through the non-cascading single-revision
  // path (a revision's public accept/reject can be SyncFusion's native
  // handler, which resolves whatever is CONTIGUOUS to it — not the group),
  // wrapped so the whole set is ONE undo step.
  const settleRevisions = (revisions: any[], isAccept: boolean) => {
    try {
      resolveRevisionsAsOneUndo(editor, revisions, isAccept);
    } catch {
      // A stale revision range must not take the panel down.
    }
  };

  const stampVerdicts = (revisions: any[], verdict: Verdict) => {
    const set = new Set(revisions);
    for (const mem of memoryRef.current.values()) {
      for (const chip of mem.chips) {
        if (
          (chip.revision && set.has(chip.revision)) ||
          (chip.partner && set.has(chip.partner))
        )
          chip.verdict = verdict;
      }
    }
  };

  const resolveChips = (chips: ChipMem[], isAccept: boolean) => {
    const pending = chips.filter((chip) => !chip.verdict);
    if (!pending.length) return;
    const revisions = pending.flatMap(chipRevisions).filter(Boolean);
    settleRevisions(revisions, isAccept);
    stampVerdicts(revisions, isAccept ? 'accepted' : 'rejected');
    refresh();
    const subject =
      pending.length === 1
        ? `${resolutionLabelOf(pending[0])} change`
        : `${pending.length} changes`;
    onResolve?.(`${subject} ${isAccept ? 'accepted' : 'rejected'}.`);
    refocusPanel();
  };

  const focusChip = (chip: ChipMem) => {
    if (chip.verdict) return;
    const group = [...memoryRef.current.values()].find((mem) =>
      mem.chips.includes(chip)
    );
    if (group) {
      setExpanded((prev) =>
        prev[group.key] ? prev : { ...prev, [group.key]: true }
      );
    }
    commitActiveRevision(chip.revision);
    // Suppress the selectionChange echo from selectRevision (sync, and any
    // trailing updateFocus microtask) so it cannot reassign activeRevision.
    ignoreSelectionRef.current = true;
    try {
      // The public revision.select() may expand the selection to Syncfusion's
      // adjacent same-author/type group. Its internal selector accepts a
      // skipGroupSelect flag, which keeps navigation on this exact chip.
      const selection = editor?.selectionModule;
      if (typeof selection?.selectRevision === 'function') {
        selection.selectRevision(chip.revision, undefined, undefined, true);
        // selectRevision normally scrolls while painting the selection. Make
        // the jump explicit as well: some host/layout combinations suppress
        // that implicit scroll while focus remains in the review rail.
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

  const groups = [...memoryRef.current.values()];
  const allChips = groups.flatMap((mem) => mem.chips);
  const pendingChips = allChips.filter((chip) => !chip.verdict);
  const totalPending = allChips.filter((chip) => !chip.verdict).length;

  const onPanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (
      key === 'j' ||
      key === 'arrowdown' ||
      key === 'k' ||
      key === 'arrowup'
    ) {
      if (!pendingChips.length) return;
      event.preventDefault();
      event.stopPropagation();
      const direction = key === 'j' || key === 'arrowdown' ? 1 : -1;
      const current = activeRevisionRef.current;
      const currentIndex = pendingChips.findIndex(
        (chip) => chip.revision === current || chip.partner === current
      );
      const nextIndex =
        currentIndex < 0
          ? direction > 0
            ? 0
            : pendingChips.length - 1
          : (currentIndex + direction + pendingChips.length) %
            pendingChips.length;
      // focusChip hands focus back to the rail after Syncfusion's selection
      // steals it, so the next J/K/arrow key stays with this handler.
      focusChip(pendingChips[nextIndex]);
      return;
    }
    if (key !== 'a' && key !== 'r') return;
    const current = activeRevisionRef.current;
    const focused = pendingChips.find(
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
      {/* Bookmark-tab handle on the window's right edge, shown only while the
          panel is collapsed (the panel's ✕ is the way to close it). Overlaid,
          so it consumes no layout width. */}
      {onHiddenChange && hidden && (
        <button
          aria-label='Expand suggested changes'
          aria-expanded={false}
          title='Expand suggested changes'
          onClick={() => onHiddenChange(false)}
          css={{
            position: 'absolute',
            left: -26,
            top: 24,
            width: 26,
            height: 56,
            border: `1px solid ${LINE}`,
            borderRight: 'none',
            borderRadius: '8px 0 0 8px',
            background: PANEL,
            boxShadow: '-2px 0 4px rgba(0, 0, 0, 0.06)',
            cursor: 'pointer',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            color: INK_3,
            zIndex: 1,
            '&:hover': { background: PANEL_2, color: INK }
          }}
        >
          ‹
        </button>
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
          {/* Rail head: title, pending counter, bulk actions. */}
          <div
            css={{
              padding: '14px 14px 12px',
              borderBottom: `1px solid ${LINE}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              flex: '0 0 auto'
            }}
          >
            <div css={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <div css={{ fontWeight: 650, fontSize: 13 }}>
                Suggested changes
              </div>
              <em
                css={{
                  fontFamily: MONO,
                  fontSize: 10.5,
                  fontStyle: 'normal',
                  color: INK_3
                }}
              >
                {totalPending ? `${totalPending} pending` : 'all clear'}
              </em>
              {onHiddenChange && (
                <button
                  aria-label='Hide suggested changes'
                  title='Hide suggested changes'
                  onClick={() => onHiddenChange(true)}
                  css={{
                    marginLeft: 'auto',
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    padding: 2,
                    borderRadius: 4,
                    fontSize: 12,
                    lineHeight: 1,
                    color: INK_3,
                    '&:hover': { background: PANEL_3, color: INK }
                  }}
                >
                  ✕
                </button>
              )}
            </div>
            <div css={{ display: 'flex', gap: 6 }}>
              <button
                css={{ ...btn, height: 29 }}
                disabled={!totalPending}
                onClick={() => resolveChips(allChips, true)}
              >
                Accept all
              </button>
              <button
                css={{ ...rejectBtn, height: 29 }}
                disabled={!totalPending}
                onClick={() => resolveChips(allChips, false)}
              >
                Reject all
              </button>
            </div>
          </div>

          {/* Group cards. */}
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
            {groups.map((mem) => {
              const pending = mem.chips.filter((chip) => !chip.verdict);
              const done = !pending.length;
              const isOpen = !!expanded[mem.key] && !done;
              return (
                <div
                  key={mem.key}
                  css={{
                    position: 'relative',
                    flex: 'none',
                    background: PAPER,
                    border: `1px solid ${LINE}`,
                    borderRadius: 10,
                    boxShadow: CARD_SHADOW,
                    overflow: 'hidden',
                    opacity: done ? 0.5 : 1
                  }}
                >
                  <button
                    aria-expanded={isOpen}
                    aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${
                      mem.title
                    }`}
                    disabled={done}
                    onClick={() =>
                      setExpanded((prev) => ({
                        ...prev,
                        [mem.key]: !isOpen
                      }))
                    }
                    css={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '11px 11px 11px 10px',
                      width: '100%',
                      border: 'none',
                      background: 'none',
                      textAlign: 'left',
                      font: 'inherit',
                      color: 'inherit',
                      cursor: done ? 'default' : 'pointer',
                      '&:hover': done ? {} : { background: PANEL_2 }
                    }}
                  >
                    <span
                      aria-hidden
                      css={{
                        flex: 'none',
                        marginTop: 2,
                        color: INK_3,
                        opacity: done ? 0 : 1,
                        display: 'inline-flex',
                        transform: isOpen ? 'rotate(90deg)' : 'none',
                        transition: 'transform 0.18s ease'
                      }}
                    >
                      {caretSvg}
                    </span>
                    <span
                      css={{
                        flex: 1,
                        minWidth: 0,
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 7
                      }}
                    >
                      <b
                        css={{
                          fontSize: 12.5,
                          fontWeight: 600,
                          lineHeight: 1.35
                        }}
                      >
                        {mem.title}
                      </b>
                      <span
                        css={{
                          flex: 'none',
                          fontFamily: MONO,
                          fontSize: 10,
                          color: INK_3,
                          background: PANEL_2,
                          border: `1px solid ${LINE}`,
                          borderRadius: 99,
                          padding: '1px 6px',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {done
                          ? `${mem.chips.length} done`
                          : `${pending.length} of ${mem.chips.length}`}
                      </span>
                    </span>
                  </button>
                  {!done && (
                    <div
                      css={{
                        display: 'flex',
                        gap: 6,
                        padding: '0 11px 10px 31px'
                      }}
                    >
                      <button
                        css={btn}
                        onClick={() => resolveChips(mem.chips, true)}
                      >
                        Accept {pending.length}
                      </button>
                      <button
                        css={rejectBtn}
                        onClick={() => resolveChips(mem.chips, false)}
                      >
                        Reject {pending.length}
                      </button>
                    </div>
                  )}
                  {isOpen && (
                    <div
                      css={{
                        position: 'relative',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        padding: '2px 11px 13px 31px'
                      }}
                    >
                      {/* Spine descending from the caret through the chips. */}
                      <span
                        aria-hidden
                        css={{
                          position: 'absolute',
                          left: 15,
                          top: -4,
                          bottom: 13,
                          width: 1,
                          background: LINE
                        }}
                      />
                      {mem.chips.map((chip, index) => {
                        const isActive =
                          !chip.verdict &&
                          !!activeRevision &&
                          (chip.revision === activeRevision ||
                            chip.partner === activeRevision);
                        const badge = badgeOf(chip.revisionType);
                        return (
                          <div
                            key={index}
                            role='button'
                            tabIndex={chip.verdict ? -1 : 0}
                            ref={(el) => {
                              if (el) rowRefs.current.set(chip.revision, el);
                              else rowRefs.current.delete(chip.revision);
                            }}
                            onClick={() => focusChip(chip)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                focusChip(chip);
                              }
                            }}
                            aria-current={isActive || undefined}
                            css={{
                              position: 'relative',
                              background: PAPER,
                              border: `1px solid ${
                                isActive ? ACCENT_LINE : LINE
                              }`,
                              borderRadius: 9,
                              padding: '9px 10px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 8,
                              cursor: chip.verdict ? 'default' : 'pointer',
                              opacity: chip.verdict ? 0.44 : 1,
                              boxShadow: isActive
                                ? `0 0 0 3px ${ACCENT_WASH}, ${CARD_SHADOW}`
                                : undefined,
                              '&:hover': chip.verdict
                                ? {}
                                : { background: PANEL_2 }
                            }}
                          >
                            {/* Connector from the spine to this chip. */}
                            <span
                              aria-hidden
                              css={{
                                position: 'absolute',
                                left: -16,
                                top: 18,
                                width: 12,
                                height: 1,
                                background: LINE
                              }}
                            />
                            <div
                              css={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 7
                              }}
                            >
                              <span
                                css={{
                                  flex: 'none',
                                  fontFamily: MONO,
                                  fontSize: 9.5,
                                  letterSpacing: '0.04em',
                                  textTransform: 'uppercase',
                                  fontWeight: 600,
                                  padding: '1.5px 6px',
                                  borderRadius: 4,
                                  color: badge.color,
                                  background: badge.background
                                }}
                              >
                                {badge.label}
                              </span>
                              {chip.author && (
                                <span
                                  css={{
                                    fontSize: 10.5,
                                    color: INK_3,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    minWidth: 0
                                  }}
                                >
                                  {chip.author}
                                </span>
                              )}
                              {chip.verdict && (
                                <span
                                  css={{
                                    marginLeft: 'auto',
                                    flex: 'none',
                                    fontFamily: MONO,
                                    fontSize: 9.5,
                                    letterSpacing: '0.03em',
                                    textTransform: 'uppercase',
                                    fontWeight: 600,
                                    color:
                                      chip.verdict === 'accepted'
                                        ? ADD
                                        : chip.verdict === 'rejected'
                                        ? DEL
                                        : INK_3
                                  }}
                                >
                                  {chip.verdict}
                                </span>
                              )}
                            </div>
                            <div
                              css={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 2,
                                fontFamily: MONO,
                                fontSize: 11,
                                lineHeight: 1.55
                              }}
                            >
                              {diffRowsOf(chip).map((row, rowIndex) => (
                                <div
                                  key={rowIndex}
                                  css={{
                                    display: 'flex',
                                    gap: 7,
                                    padding: '3px 7px',
                                    borderRadius: 5,
                                    background: row.del ? DEL_WASH : ADD_WASH,
                                    color: row.del ? DEL : ADD
                                  }}
                                >
                                  <span
                                    css={{
                                      flex: 'none',
                                      fontWeight: 700,
                                      opacity: 0.8
                                    }}
                                  >
                                    {row.sign}
                                  </span>
                                  <span
                                    css={{
                                      minWidth: 0,
                                      overflowWrap: 'anywhere',
                                      ...(row.text
                                        ? {}
                                        : {
                                            fontStyle: 'italic',
                                            color: INK_3
                                          })
                                    }}
                                  >
                                    {row.text || 'Structural change'}
                                  </span>
                                </div>
                              ))}
                            </div>
                            {isActive && (
                              <div css={{ display: 'flex', gap: 6 }}>
                                <button
                                  aria-label='Accept this edit'
                                  css={{ ...btn, height: 26 }}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    resolveChips([chip], true);
                                  }}
                                >
                                  Accept
                                </button>
                                <button
                                  aria-label='Reject this edit'
                                  css={{ ...rejectBtn, height: 26 }}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    resolveChips([chip], false);
                                  }}
                                >
                                  Reject
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default TrackedChangeGroups;
