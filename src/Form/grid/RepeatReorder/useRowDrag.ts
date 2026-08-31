import { useCallback, useEffect, useRef, useState } from 'react';
import { featheryDoc } from '../../../utils/browser';
import {
  axisFromFlexDirection,
  displacementByAbs,
  displacementFor,
  mainAxisCoord,
  mainAxisExtent,
  RowSnapshot,
  steppedTargetIndex,
  targetIndexFromCenter,
  TrackAxis
} from './geometry';
import { announceReorder } from './announce';
import { consumeRowFocus, requestRowFocus } from './focus';
import { ROW_ATTR } from './styles';

// Enough movement to tell a drag from a tap, so tapping the grip still just
// focuses it and leaves the keyboard path usable.
const DRAG_THRESHOLD_PX = 4;

interface DragState {
  pointerId: number;
  index: number;
  row: HTMLElement;
  track: HTMLElement;
  rows: RowSnapshot[];
  axis: TrackAxis;
  start: number;
  /** Centre of the dragged row along the main axis, before it moved. */
  restingCenter: number;
  dragging: boolean;
  to: number | null;
}

export interface RowDragOptions {
  /** Absolute repeat index of this row. */
  index: number;
  /** Total rows the container's data has. */
  rowCount: number;
  onMove: (from: number, to: number) => boolean;
  /** Fired when the grip is pressed and released without a drag. */
  onTap?: () => void;
  disabled?: boolean;
}

const rowElements = (track: HTMLElement): HTMLElement[] =>
  Array.from(track.children).filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement && el.hasAttribute(ROW_ATTR)
  );

const snapshot = (elements: HTMLElement[]): RowSnapshot[] =>
  elements.map((el) => {
    const rect = el.getBoundingClientRect();
    return {
      abs: Number(el.getAttribute(ROW_ATTR)),
      rect: {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right
      }
    };
  });

/** Where the dragged row's centre sits before it has moved. */
const restingCenterOf = (rows: RowSnapshot[], abs: number, axis: TrackAxis) => {
  const row = rows.find((r) => r.abs === abs);
  if (!row) return 0;
  const start = axis.vertical ? row.rect.top : row.rect.left;
  return start + mainAxisExtent(row.rect, axis.vertical) / 2;
};

const rowElementByAbs = (track: HTMLElement, abs: number) =>
  track.querySelector<HTMLElement>(`[${ROW_ATTR}="${abs}"]`);

const axisTranslate = (offset: number, vertical: boolean) =>
  vertical ? `translateY(${offset}px)` : `translateX(${offset}px)`;

/**
 * Moves the rows to match where the drop would land.
 *
 * The dragged row tracks the pointer with no transition so it stays under the
 * cursor; the rows it displaces ease into their new places. Nothing is
 * reordered in the DOM - these are transforms on the existing nodes, which is
 * what keeps the positional React keys safe until the move is committed.
 */
const paintDrag = (state: DragState, offset: number, to: number | null) => {
  const { track, rows, axis } = state;

  const dragged = rowElementByAbs(track, state.index);
  if (dragged) {
    dragged.style.transition = 'none';
    dragged.style.transform = axisTranslate(offset, axis.vertical);
    dragged.style.zIndex = '2';
    dragged.style.position = dragged.style.position || 'relative';
  }

  if (to === null) return;
  const distance = displacementFor(rows, state.index, axis.vertical);
  const shifts = displacementByAbs(rows, state.index, to, distance, axis);

  Object.entries(shifts).forEach(([abs, shift]) => {
    const el = rowElementByAbs(track, Number(abs));
    if (!el) return;
    el.style.transition = 'transform 0.16s ease';
    el.style.transform = shift ? axisTranslate(shift, axis.vertical) : '';
  });
};

/** Puts every row back the way the stylesheet left it. */
const clearDrag = (state: DragState) => {
  rowElements(state.track).forEach((el) => {
    el.style.transition = '';
    el.style.transform = '';
    el.style.zIndex = '';
    el.style.opacity = '';
  });
};

export function useRowDrag({
  index,
  rowCount,
  onMove,
  onTap,
  disabled
}: RowDragOptions) {
  const handleRef = useRef<HTMLElement>(null);
  const stateRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);

  const finish = useCallback(
    (commit: boolean) => {
      const state = stateRef.current;
      if (!state) return;
      stateRef.current = null;

      featheryDoc().body.style.userSelect = '';
      clearDrag(state);
      // Releasing throws if the browser already dropped the capture, which is
      // exactly what happened on the pointercancel path into here.
      try {
        handleRef.current?.releasePointerCapture?.(state.pointerId);
      } catch {
        // already released
      }
      setDragging(false);

      if (!commit || state.to === null) {
        if (state.dragging) announceReorder('Move cancelled');
        return;
      }

      const to = state.to;
      if (to === index) return;
      if (!onMove(index, to)) return;

      announceReorder(`Row moved to position ${to + 1} of ${rowCount}`);
      requestRowFocus(to);
    },
    [index, rowCount, onMove]
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (disabled || stateRef.current) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;

      const handle = event.currentTarget;
      const row = handle.closest<HTMLElement>(`[${ROW_ATTR}]`);
      const track = row?.parentElement;
      if (!row || !track) return;

      // A repeat row's siblings include whatever else the author placed beside
      // the container, so rows are identified by their marker, not by position.
      // A lone row is still tracked: it cannot be dragged, but tapping it must
      // still reach the menu.
      const elements = rowElements(track);

      // The stylesheet decides the direction: subgrid `axis` is inverted
      // relative to CSS, and this also picks up the *-reverse variants.
      const axis = axisFromFlexDirection(
        getComputedStyle(track).flexDirection || 'column'
      );

      // Stop the container's own click actions from firing on grab-and-release.
      event.stopPropagation();
      event.preventDefault();

      handleRef.current = handle;
      handle.setPointerCapture?.(event.pointerId);
      const snapshotRows = snapshot(elements);
      stateRef.current = {
        pointerId: event.pointerId,
        index,
        row,
        track,
        rows: snapshotRows,
        axis,
        start: mainAxisCoord(event.clientX, event.clientY, axis),
        restingCenter: restingCenterOf(snapshotRows, index, axis),
        dragging: false,
        to: null
      };
    },
    [disabled]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const state = stateRef.current;
      if (!state || event.pointerId !== state.pointerId) return;

      const coord = mainAxisCoord(event.clientX, event.clientY, state.axis);
      if (!state.dragging) {
        // Nothing to reorder against, so movement never becomes a drag.
        if (state.rows.length < 2) return;
        if (Math.abs(coord - state.start) < DRAG_THRESHOLD_PX) return;
        state.dragging = true;
        featheryDoc().body.style.userSelect = 'none';
        setDragging(true);
        announceReorder(`Row ${index + 1} grabbed`);
      }

      // Rects are the ones captured at grab time. Live shifting is done with
      // transforms, which do not affect layout, so those rects stay true for
      // the whole gesture and row heights never have to be assumed uniform.
      const offset = coord - state.start;
      // The row's centre, not the pointer: the grip sits at the row's corner,
      // so the pointer trails the row it is carrying.
      const to = targetIndexFromCenter(
        state.rows,
        index,
        state.restingCenter + offset,
        state.axis
      );
      const changed = to !== state.to;
      state.to = to;
      paintDrag(state, offset, to);
      if (!changed) return;

      if (to !== index)
        announceReorder(`Moving to position ${to + 1} of ${rowCount}`);
    },
    [index, rowCount]
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const state = stateRef.current;
      if (!state || event.pointerId !== state.pointerId) return;
      event.stopPropagation();

      // A press that never crossed the drag threshold is a tap, which opens the
      // menu - the single-pointer alternative to dragging.
      const dragged = state.dragging;
      finish(dragged);
      if (!dragged) onTap?.();
    },
    [finish, onTap]
  );

  const onPointerCancel = useCallback(() => finish(false), [finish]);

  const move = useCallback(
    (direction: -1 | 1) => {
      const track = handleRef.current?.closest<HTMLElement>(
        `[${ROW_ATTR}]`
      )?.parentElement;
      const rows = track ? snapshot(rowElements(track)) : [];

      // Stepping by rendered position rather than by index keeps a hidden row
      // from swallowing a keypress.
      const to = steppedTargetIndex(rows, index, direction);
      if (to === null || !onMove(index, to)) return;

      announceReorder(`Row moved to position ${to + 1} of ${rowCount}`);
      requestRowFocus(to);
    },
    [index, rowCount, onMove]
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (disabled) return;

      if (event.key === 'Escape') {
        if (stateRef.current) {
          event.preventDefault();
          finish(false);
        }
        return;
      }

      // Both axis pairs are accepted: which one is "forward" depends on styles
      // the handle cannot see while it is only focused, not dragging.
      let direction: -1 | 1 | null = null;
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') direction = -1;
      else if (event.key === 'ArrowDown' || event.key === 'ArrowRight')
        direction = 1;
      if (direction === null) return;

      event.preventDefault();
      event.stopPropagation();
      move(direction);
    },
    [disabled, finish, move]
  );

  // No dep array: the claim is checked on every render, which is exactly when
  // the destination row has just been re-rendered by the move.
  useEffect(() => {
    if (consumeRowFocus(index)) handleRef.current?.focus();
  });

  // A drag interrupted by an unmount would otherwise leave the page unselectable.
  useEffect(
    () => () => {
      if (stateRef.current) {
        stateRef.current = null;
        featheryDoc().body.style.userSelect = '';
      }
    },
    []
  );

  return {
    dragging,
    move,
    handleRef,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture: onPointerCancel,
      onKeyDown,
      onClick: (event: React.MouseEvent) => event.stopPropagation()
    }
  };
}
