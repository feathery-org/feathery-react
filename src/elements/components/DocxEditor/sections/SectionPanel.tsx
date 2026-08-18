import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react';
import { readSections, SectionNode } from './outline';
import { applyReorderTo, installReorderUndoBatching } from './applyReorder';
import { isAssistantWriting } from '../../../../assistant/tools/docx/syncfusionDocumentOps';
import { Diagnostic, SfdtDocument } from '../bindings/core/sfdtTypes';
import {
  INK,
  INK_3,
  LINE,
  PANEL_2,
  PANEL_3,
  PAPER
} from '../TrackedChangeGroups/styles';

// The Sections tab body: a hint line, then one draggable card per Word section
// (grip · name · kind · move chevrons). Click to select (shift = range,
// ⌘/ctrl = toggle); the grip is the drag handle. Dragging reorders the list
// live and the dragged card(s) preview translucent at the target slot; the move
// commits on drop. Both drag and the chevrons funnel through the apply layer,
// which serializes → permutes → re-opens the document. A refused move (e.g. one
// that would split a cross-section bookmark) leaves the document untouched and
// shows its reason. Reordering is only locked while the assistant is working.

interface Props {
  editor: any;
  /** open() does not reliably fire contentChange; mark dirty explicitly. */
  markDirty?: () => void;
}

const CONTENT_REFRESH_DEBOUNCE_MS = 150;

const KIND = '#9aa1ad'; // grip + move chevrons
const TEXT_MUTED = 'rgb(157 163 175)'; // subtitle + hint
const CARD_LINE = '#e4e6ea';
const SELECT_BG = '#eaf1fe';
const SELECT_BORDER = '#9dbcf0';

const guard = (fn: () => void): void => {
  try {
    fn();
  } catch (error) {
    console.debug('Feathery: section panel editor call failed.', error);
  }
};

// A 1×1 transparent image used as the drag image so the browser's free-floating
// drag ghost (which drifts on both axes) is hidden — only the in-list
// translucent placeholder shows, and it moves vertically.
let transparentDragImage: HTMLImageElement | null = null;
function getTransparentDragImage(): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null;
  if (!transparentDragImage) {
    transparentDragImage = new Image();
    transparentDragImage.src =
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  }
  return transparentDragImage;
}

const sameOrder = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

function Grip() {
  return (
    <svg width='10' height='14' viewBox='0 0 10 16' fill='currentColor'>
      <circle cx='3' cy='3' r='1.3' />
      <circle cx='7' cy='3' r='1.3' />
      <circle cx='3' cy='8' r='1.3' />
      <circle cx='7' cy='8' r='1.3' />
      <circle cx='3' cy='13' r='1.3' />
      <circle cx='7' cy='13' r='1.3' />
    </svg>
  );
}

const Chevron = ({ dir }: { dir: 'up' | 'down' }) => (
  <svg width='9' height='9' viewBox='0 0 12 12' fill='none'>
    <path
      d={dir === 'up' ? 'M2.5 7.5L6 4l3.5 3.5' : 'M2.5 4.5L6 8l3.5-3.5'}
      stroke='currentColor'
      strokeWidth='1.6'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

const LockIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox='0 0 16 16' fill='none'>
    <rect
      x='3.5'
      y='7'
      width='9'
      height='6.5'
      rx='1.3'
      stroke='currentColor'
      strokeWidth='1.4'
    />
    <path
      d='M5.5 7V5a2.5 2.5 0 0 1 5 0v2'
      stroke='currentColor'
      strokeWidth='1.4'
      strokeLinecap='round'
    />
  </svg>
);

const LOCK_TITLE = 'Locked until the assistant is done working';

const range = (a: number, b: number): number[] => {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const out: number[] = [];
  for (let i = lo; i <= hi; i++) out.push(i);
  return out;
};

export default function SectionList({ editor, markDirty }: Props) {
  const [nodes, setNodes] = useState<SectionNode[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [anchor, setAnchor] = useState<number | null>(null);
  // While dragging: the set of section indices being dragged and the live
  // visual order (original indices) so the dragged card(s) preview at target.
  const [draggingSet, setDraggingSet] = useState<number[] | null>(null);
  const [order, setOrder] = useState<number[] | null>(null);
  // Reordering is disabled while the assistant is writing (it's mutating the
  // same document). isAssistantWriting stays true for the whole editing turn.
  const [locked, setLocked] = useState(false);
  // The panel root; focused on card selection so keyboard undo/redo lands on our
  // handler (not the browser) even though the cards sit outside the editor.
  const panelRef = useRef<HTMLDivElement>(null);

  // A floating "popped out" copy of the grabbed card that follows the cursor
  // during a drag. Its LEFT is pinned to the card's original x (captured on
  // grab), so it never drifts sideways — only its top tracks the pointer. Moved
  // by direct style writes (ref) to stay smooth, so a drag re-renders nothing.
  const ghostRef = useRef<HTMLDivElement>(null);
  const dragMeta = useRef<{
    offsetY: number;
    left: number;
    width: number;
    startY: number;
  } | null>(null);
  const [ghostInfo, setGhostInfo] = useState<{
    label: string;
    summary: string;
    count: number;
  } | null>(null);

  const positionGhost = useCallback((clientY: number) => {
    const g = ghostRef.current;
    const m = dragMeta.current;
    if (!g || !m) return;
    g.style.top = `${clientY - m.offsetY}px`;
    g.style.left = `${m.left}px`;
    g.style.width = `${m.width}px`;
  }, []);

  // Place the ghost the instant it mounts (before the first dragover) so it
  // never flashes at the top-left corner.
  useLayoutEffect(() => {
    if (ghostInfo) positionGhost(dragMeta.current?.startY ?? 0);
  }, [ghostInfo, positionGhost]);

  // Prime the transparent drag image on mount so it's decoded before the first
  // drag — otherwise the browser shows its default (globe) ghost that once.
  useEffect(() => {
    getTransparentDragImage();
  }, []);

  // Install the reorder-aware undo/redo wrapper so one keyboard press (or the
  // toolbar button) collapses a whole multi-section move into one undo/redo.
  useEffect(() => {
    if (!editor) return;
    guard(() => installReorderUndoBatching(editor));
  }, [editor]);

  // Track whether the assistant is working. Editor events cover the writes; a
  // short poll catches the turn-end clear (which fires no editor event).
  useEffect(() => {
    if (!editor) return undefined;
    const check = () => setLocked(!!isAssistantWriting(editor));
    check();
    guard(() => editor.addEventListener?.('contentChange', check));
    guard(() => editor.addEventListener?.('selectionChange', check));
    const poll = setInterval(check, 400);
    return () => {
      clearInterval(poll);
      guard(() => editor.removeEventListener?.('contentChange', check));
      guard(() => editor.removeEventListener?.('selectionChange', check));
    };
  }, [editor]);

  const clearSelection = () => {
    setSelected([]);
    setAnchor(null);
  };

  const readNow = useCallback(() => {
    guard(() => {
      const sfdt = JSON.parse(editor.serialize()) as SfdtDocument;
      setNodes(readSections(sfdt).nodes);
    });
  }, [editor]);

  useEffect(() => {
    if (!editor) return undefined;
    readNow();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => guard(readNow), CONTENT_REFRESH_DEBOUNCE_MS);
    };
    guard(() => editor.addEventListener?.('contentChange', schedule));
    guard(() => editor.addEventListener?.('documentChange', schedule));
    return () => {
      if (timer) clearTimeout(timer);
      guard(() => editor.removeEventListener?.('contentChange', schedule));
      guard(() => editor.removeEventListener?.('documentChange', schedule));
    };
  }, [editor, readNow]);

  const reveal = useCallback(
    (index: number) => {
      guard(() => editor.selection?.select?.(`${index};0;0`, `${index};0;0`));
    },
    [editor]
  );

  /* ---------------- keyboard undo/redo ---------------- */

  // Ctrl/⌘+Z = undo, Ctrl/⌘+Shift+Z or Ctrl+Y = redo. We handle these on the
  // panel because, once a card is selected, focus is outside the Syncfusion
  // editor — so the editor never sees the key, and without preventDefault the
  // browser runs its own shortcut (e.g. Ctrl+Y opens chrome://history). Routing
  // through editorHistory.undo/redo also picks up the reorder batch wrapper, so
  // a whole multi-section move undoes/redoes in a single press.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      guard(() => editor?.editorHistory?.undo?.());
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault();
      guard(() => editor?.editorHistory?.redo?.());
    }
  };

  /* ---------------- selection ---------------- */

  const onSelect = (event: React.MouseEvent, node: SectionNode) => {
    // Pull keyboard focus into the panel so undo/redo keys hit onKeyDown.
    panelRef.current?.focus({ preventScroll: true });
    if (event.shiftKey && anchor != null) {
      setSelected(range(anchor, node.index));
    } else if (event.metaKey || event.ctrlKey) {
      setSelected((prev) =>
        prev.includes(node.index)
          ? prev.filter((i) => i !== node.index)
          : [...prev, node.index]
      );
      setAnchor(node.index);
    } else {
      setSelected([node.index]);
      setAnchor(node.index);
      reveal(node.index);
    }
  };

  /* ---------------- move ---------------- */

  // Reorder the panel list to match a just-applied order WITHOUT re-serializing
  // the editor — the reorder is a permutation, so positions/ids simply shift.
  // The debounced contentChange refresh reconciles any drift afterwards. This
  // keeps the drop instant instead of paying for another full serialize.
  const applyOrder = (finalOrder: number[]) => {
    const base = nodes.map((n) => n.index);
    if (sameOrder(finalOrder, base)) return; // dropped in place — nothing to do

    // Settle the list optimistically and immediately so the drop feels instant.
    setSelected([]);
    setAnchor(null);
    setNodes((prev) =>
      finalOrder
        .map((origIndex, newIndex) => {
          const node = prev.find((p) => p.index === origIndex);
          return node
            ? { ...node, index: newIndex, id: `ws-${newIndex}` }
            : null;
        })
        .filter((n): n is SectionNode => !!n)
    );

    // Defer the heavy editor apply (serialize + native SDK replay) one frame so
    // the browser paints the settled list first — running it synchronously on
    // drop is what caused the small drop lag. finalOrder is relative to the
    // current display order and the editor is kept in that same order, so
    // successive deferred applies compose correctly. On a refusal/no-op, re-sync
    // the list from the editor's real state.
    const runApply = () => {
      const result = applyReorderTo(editor, finalOrder, {
        markDirty,
        onDiagnostics: setDiagnostics
      });
      if (!result.moved) readNow();
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(runApply);
    } else {
      setTimeout(runApply, 0);
    }
  };

  const moveOne = (index: number, delta: number) => {
    const to = index + delta;
    const base = nodes.map((n) => n.index);
    if (to < 0 || to >= base.length) return;
    base.splice(to, 0, base.splice(index, 1)[0]);
    applyOrder(base);
  };

  /* ---------------- drag (grip handle, multi-select aware) ---------------- */

  const startDrag = (event: React.DragEvent, node: SectionNode) => {
    if (!node.movable || locked) return;
    // Dragging a card that's part of the current multi-selection drags the
    // whole selection; otherwise it drags (and selects) just that card.
    const set =
      selected.includes(node.index) && selected.length > 1
        ? [...selected].sort((a, b) => a - b)
        : [node.index];
    if (!(selected.includes(node.index) && selected.length > 1)) {
      setSelected([node.index]);
      setAnchor(node.index);
    }
    setDraggingSet(set);
    setOrder(nodes.map((n) => n.index));
    // Capture the card's on-screen box so the floating ghost aligns under the
    // cursor and keeps the card's original left (x stays fixed for the drag).
    const cardEl = (event.currentTarget as HTMLElement).closest(
      '[data-card]'
    ) as HTMLElement | null;
    const rect = cardEl?.getBoundingClientRect();
    if (rect) {
      dragMeta.current = {
        offsetY: event.clientY - rect.top,
        left: rect.left,
        width: rect.width,
        startY: event.clientY
      };
      setGhostInfo({
        label: node.label,
        summary: node.summary,
        count: set.length
      });
    }
    try {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(node.index));
      // Hide the browser's free-floating ghost (it drifts on x); the in-list
      // translucent placeholder is the only drag feedback, and it's y-only.
      const ghost = getTransparentDragImage();
      if (ghost) event.dataTransfer.setDragImage(ghost, 0, 0);
    } catch {
      /* dataTransfer unavailable in some environments */
    }
  };

  const dragOverRow = (event: React.DragEvent, overIndex: number) => {
    if (!draggingSet) return;
    event.preventDefault();
    try {
      event.dataTransfer.dropEffect = 'move';
    } catch {
      /* same */
    }
    if (draggingSet.includes(overIndex)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    setOrder((prev) => {
      if (!prev) return prev;
      const set = new Set(draggingSet);
      const without = prev.filter((i) => !set.has(i));
      const overPos = without.indexOf(overIndex);
      if (overPos < 0) return prev;
      const insertAt = after ? overPos + 1 : overPos;
      const next = without.slice();
      next.splice(insertAt, 0, ...draggingSet);
      // Bail out when the order is unchanged so dragging doesn't re-render the
      // list on every pointer move (the source of the drag lag).
      return sameOrder(next, prev) ? prev : next;
    });
  };

  const endDrag = () => {
    const finalOrder = order;
    setDraggingSet(null);
    setOrder(null);
    setGhostInfo(null);
    dragMeta.current = null;
    if (finalOrder) applyOrder(finalOrder);
  };

  /* ---------------- render ---------------- */

  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');
  const displayNodes =
    order != null
      ? order
          .map((i) => nodes.find((n) => n.index === i))
          .filter((n): n is SectionNode => !!n)
      : nodes;

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      css={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        outline: 'none'
      }}
    >
      <div
        onClick={clearSelection}
        css={{
          overflowY: 'auto',
          padding: '12px 12px 40px',
          flex: 1,
          minHeight: 0
        }}
      >
        <p
          css={{
            fontSize: 12.5,
            fontWeight: 400,
            color: TEXT_MUTED,
            lineHeight: 1.45,
            margin: '0 0 12px'
          }}
        >
          Drag to reorder — the document updates as you go. Sections come from
          headings, tables, and paragraph blocks.
        </p>

        {nodes.length === 0 && (
          <div css={{ color: INK_3, fontSize: 12.5 }}>
            No sections to reorder.
          </div>
        )}
        {nodes.length === 1 && (
          <div css={{ color: INK_3, fontSize: 12, marginBottom: 6 }}>
            This document has a single section, so there is nothing to reorder.
          </div>
        )}

        <div
          onDragOver={(e) => {
            if (!draggingSet) return;
            e.preventDefault();
            positionGhost(e.clientY);
          }}
          css={{ display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          {displayNodes.map((node) => {
            const isDragging = !!draggingSet?.includes(node.index);
            const isSelected = selected.includes(node.index);
            return (
              <div
                key={node.id}
                data-card
                title={locked ? LOCK_TITLE : undefined}
                onDragOver={(e) => dragOverRow(e, node.index)}
                onDrop={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(e, node);
                }}
                css={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  background: isSelected ? SELECT_BG : PAPER,
                  border: `1px solid ${isSelected ? SELECT_BORDER : CARD_LINE}`,
                  borderRadius: 9,
                  padding: '9px 10px',
                  userSelect: 'none',
                  opacity: isDragging ? 0.45 : locked ? 0.6 : 1
                }}
              >
                <span
                  draggable={node.movable && !locked}
                  onDragStart={(e) => startDrag(e, node)}
                  onDragEnd={endDrag}
                  aria-label={`Drag ${node.label}`}
                  title={locked ? LOCK_TITLE : undefined}
                  css={{
                    color: KIND,
                    display: 'flex',
                    flex: 'none',
                    cursor: locked
                      ? 'not-allowed'
                      : node.movable
                      ? 'grab'
                      : 'default',
                    '&:active': {
                      cursor:
                        node.movable && !locked ? 'grabbing' : 'not-allowed'
                    }
                  }}
                >
                  <Grip />
                </span>

                <span css={{ flex: 1, minWidth: 0 }}>
                  <span
                    css={{
                      display: 'block',
                      fontSize: 13,
                      fontWeight: 600,
                      color: INK,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {node.label}
                  </span>
                  <span
                    css={{
                      display: 'block',
                      fontSize: 11.5,
                      fontWeight: 400,
                      color: TEXT_MUTED,
                      marginTop: 1
                    }}
                  >
                    {node.summary}
                  </span>
                </span>

                <span
                  css={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flex: 'none',
                    color: KIND
                  }}
                  title={locked ? LOCK_TITLE : undefined}
                  onClick={(e) => e.stopPropagation()}
                >
                  {locked ? (
                    // While the assistant is working, the chevrons are inert —
                    // show a padlock here so each card reads as locked.
                    <LockIcon size={14} />
                  ) : (
                    <>
                      <button
                        type='button'
                        aria-label={`Move ${node.label} up`}
                        disabled={!node.movable || node.index === 0}
                        onClick={() => moveOne(node.index, -1)}
                        css={moveBtn}
                      >
                        <Chevron dir='up' />
                      </button>
                      <button
                        type='button'
                        aria-label={`Move ${node.label} down`}
                        disabled={
                          !node.movable || node.index === nodes.length - 1
                        }
                        onClick={() => moveOne(node.index, 1)}
                        css={moveBtn}
                      >
                        <Chevron dir='down' />
                      </button>
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {(errors.length > 0 || warnings.length > 0) && (
        <div
          css={{
            flex: '0 0 auto',
            borderTop: `1px solid ${LINE}`,
            padding: '8px 12px',
            fontSize: 12,
            background: PANEL_2
          }}
        >
          {errors.map((d, i) => (
            <div key={`e${i}`} css={{ color: '#b0302b' }}>
              {d.message}
            </div>
          ))}
          {warnings.map((d, i) => (
            <div key={`w${i}`} css={{ color: '#8a5a0e' }}>
              {d.message}
            </div>
          ))}
        </div>
      )}

      {ghostInfo && (
        <div
          ref={ghostRef}
          css={{
            position: 'fixed',
            top: 0,
            left: 0,
            pointerEvents: 'none',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            background: PAPER,
            border: `1px solid ${SELECT_BORDER}`,
            borderRadius: 9,
            padding: '9px 10px',
            boxShadow: '0 8px 22px rgba(17,24,39,0.22)',
            transform: 'scale(1.03)',
            opacity: 0.97
          }}
        >
          <span css={{ color: KIND, display: 'flex', flex: 'none' }}>
            <Grip />
          </span>
          <span css={{ flex: 1, minWidth: 0 }}>
            <span
              css={{
                display: 'block',
                fontSize: 13,
                fontWeight: 600,
                color: INK,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {ghostInfo.label}
            </span>
            <span
              css={{
                display: 'block',
                fontSize: 11.5,
                fontWeight: 400,
                color: TEXT_MUTED,
                marginTop: 1
              }}
            >
              {ghostInfo.summary}
            </span>
          </span>
          {ghostInfo.count > 1 && (
            <span
              css={{
                flex: 'none',
                minWidth: 18,
                height: 18,
                padding: '0 5px',
                borderRadius: 9,
                background: SELECT_BORDER,
                color: '#fff',
                fontSize: 11,
                fontWeight: 600,
                lineHeight: '18px',
                textAlign: 'center'
              }}
            >
              {ghostInfo.count}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const moveBtn = {
  width: 20,
  height: 14,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  background: 'transparent',
  color: KIND,
  borderRadius: 4,
  cursor: 'pointer',
  padding: 0,
  '&:hover': { color: INK, background: PANEL_3 },
  '&:disabled': { opacity: 0.3, cursor: 'default' }
} as const;
