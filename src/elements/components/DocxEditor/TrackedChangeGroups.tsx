import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  listRevisionGroups,
  resolveRevisionsAsOneUndo,
  RevisionGroupItem
} from '../../../assistant/tools/syncfusionDocumentOps';
import { setActiveInlineRevision } from './useDocxEditor';

// Review rail for pending tracked changes: one card per assistant accept
// group (plus one per human author), expanding to −/+ diff "chips" with
// per-chip, per-card and rail-wide resolution — all through the
// non-cascading path as ONE undo unit. Resolved edits leave the rail;
// an undo brings them back via the contentChange refresh.

interface Props {
  editor: any;
  /** Host-owned visibility (drawer handle, ✕, inline click all agree);
   *  stays mounted while hidden so the listeners keep running. */
  hidden?: boolean;
  onHiddenChange?: (hidden: boolean) => void;
}

/** One pending edit as the rail shows it. */
interface ChipView {
  revision: any;
  partner?: any;
  revisionType: string;
  text: string;
  beforeText?: string;
  author?: string;
}

interface GroupView {
  key: string;
  title: string;
  /** One author's manual edits rather than an assistant accept group. */
  untagged?: boolean;
  chips: ChipView[];
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

const badgeOf = (revisionType: string) => {
  if (revisionType === 'Insertion' || revisionType === 'MoveTo')
    return { label: 'Added', color: ADD, background: ADD_WASH };
  if (revisionType === 'Deletion' || revisionType === 'MoveFrom')
    return { label: 'Removed', color: DEL, background: DEL_WASH };
  if (revisionType === 'Replace')
    return { label: 'Replaced', color: MOD, background: MOD_WASH };
  return { label: 'Edit', color: INK_2, background: PANEL_3 };
};

// The −/+ rows a chip's diff shows.
const diffRowsOf = (chip: ChipView) => {
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
const chipRevisions = (chip: ChipView) =>
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
      {/* Bookmark-tab handle, shown only while collapsed (✕ closes the
          panel). Overlaid, so it consumes no layout width. */}
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
                {`${allChips.length} pending`}
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
                onClick={() => resolveChips(allChips, true)}
              >
                Accept all
              </button>
              <button
                css={{ ...rejectBtn, height: 29 }}
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
              const isOpen = !!expanded[mem.key];
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
                    overflow: 'hidden'
                  }}
                >
                  <button
                    aria-expanded={isOpen}
                    aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${
                      mem.title
                    }`}
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
                      cursor: 'pointer',
                      '&:hover': { background: PANEL_2 }
                    }}
                  >
                    <span
                      aria-hidden
                      css={{
                        flex: 'none',
                        marginTop: 2,
                        color: INK_3,
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
                        {`${mem.chips.length} ${
                          mem.chips.length === 1 ? 'edit' : 'edits'
                        }`}
                      </span>
                    </span>
                  </button>
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
                      Accept {mem.chips.length}
                    </button>
                    <button
                      css={rejectBtn}
                      onClick={() => resolveChips(mem.chips, false)}
                    >
                      Reject {mem.chips.length}
                    </button>
                  </div>
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
                          !!activeRevision &&
                          (chip.revision === activeRevision ||
                            chip.partner === activeRevision);
                        const badge = badgeOf(chip.revisionType);
                        return (
                          <div
                            key={index}
                            role='button'
                            tabIndex={0}
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
                              cursor: 'pointer',
                              boxShadow: isActive
                                ? `0 0 0 3px ${ACCENT_WASH}, ${CARD_SHADOW}`
                                : undefined,
                              '&:hover': { background: PANEL_2 }
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
