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
  /**
   * The row's own inline `position` before the drag borrowed it. The lift needs
   * a positioned box for its z-index, but an author may have set `position`
   * deliberately, and an inline value left behind outranks their stylesheet for
   * the rest of the session.
   */
  rowPosition: string;
  /** Centre of the dragged row along the main axis, before it moved. */
  restingCenter: number;
  dragging: boolean;
  to: number | null;
}

export interface RowDragOptions {
  /** Absolute repeat index of this row. */
  index: number;
  onMove: (from: number, to: number) => boolean;
  /**
   * Renders an absolute repeat index as the position a person sees, e.g.
   * "2 of 3". Supplied by the handle, which is what knows how many rows are on
   * screen, so the spoken position always matches the handle's own label.
   */
  positionLabel: (abs: number) => string;
  /** Sends a message to this form's live region. */
  announce: (message: string) => void;
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

/**
 * Which way the track runs, read off the stylesheet.
 *
 * Subgrid `axis` is inverted relative to CSS, so the computed style is the only
 * trustworthy source, and it also picks up the *-reverse variants. Both the
 * pointer grab and the keyboard step read it here so they cannot disagree.
 */
const trackAxis = (track: HTMLElement) =>
  axisFromFlexDirection(getComputedStyle(track).flexDirection || 'column');

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

  // The node captured at grab time, so the element whose `position` is
  // borrowed here is exactly the one clearDrag restores it on.
  const dragged = state.row;
  dragged.style.transition = 'none';
  dragged.style.transform = axisTranslate(offset, axis.vertical);
  dragged.style.zIndex = '2';
  dragged.style.position = dragged.style.position || 'relative';

  if (to === null) return;
  const distance = displacementFor(rows, state.index, axis);
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
  // Only the dragged row had its position borrowed, and it goes back to
  // whatever it was - an empty string when there was no inline value, which
  // hands the property back to the stylesheet.
  state.row.style.position = state.rowPosition;
};

export function useRowDrag({
  index,
  onMove,
  positionLabel,
  announce,
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
        if (state.dragging) announce('Move cancelled');
        return;
      }

      const to = state.to;
      if (to === state.index) return;
      if (!onMove(state.index, to)) return;

      announce(`Row moved to position ${positionLabel(to)}`);
      requestRowFocus(to);
    },
    [onMove, positionLabel, announce]
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

      const axis = trackAxis(track);

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
        rowPosition: row.style.position,
        restingCenter: restingCenterOf(snapshotRows, index, axis),
        dragging: false,
        to: null
      };
    },
    // `index` matters: a repeat row's React key is its rendered position, so
    // the row a slot holds changes whenever a hide_if opens or closes a gap
    // above it. Without the dep this closure would keep grabbing the index the
    // slot held on its first render.
    [disabled, index]
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
        announce(`Row ${positionLabel(state.index)} grabbed`);
      }

      // Rects are the ones captured at grab time. Live shifting is done with
      // transforms, which do not affect layout, so those rects stay true for
      // the whole gesture and row heights never have to be assumed uniform.
      const offset = coord - state.start;
      // The row's centre, not the pointer: the grip sits at the row's corner,
      // so the pointer trails the row it is carrying.
      // state.index, not the live prop: one from-index for the whole gesture,
      // so a hide_if firing mid-drag cannot split the paint from the math.
      const to = targetIndexFromCenter(
        state.rows,
        state.index,
        state.restingCenter + offset,
        state.axis
      );
      const changed = to !== state.to;
      state.to = to;
      paintDrag(state, offset, to);
      if (!changed) return;

      if (to !== state.index)
        announce(`Moving to position ${positionLabel(to)}`);
    },
    [positionLabel, announce]
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const state = stateRef.current;
      if (!state || event.pointerId !== state.pointerId) return;
      event.stopPropagation();

      // A press that never crossed the drag threshold is a tap. onPointerDown
      // preventDefault()s to keep the container's click actions out of a grab,
      // and that also suppresses the browser's own focus, so a tap has to place
      // focus itself - otherwise the arrow keys are unreachable by pointer.
      const dragged = state.dragging;
      finish(dragged);
      if (!dragged) {
        handleRef.current?.focus();
        onTap?.();
      }
    },
    [finish, onTap]
  );

  const onPointerCancel = useCallback(() => finish(false), [finish]);

  const move = useCallback(
    (direction: -1 | 1) => {
      const track = handleRef.current?.closest<HTMLElement>(
        `[${ROW_ATTR}]`
      )?.parentElement;
      if (!track) return;
      const rows = snapshot(rowElements(track));

      // Stepping by rendered position rather than by index keeps a hidden row
      // from swallowing a keypress, and the axis keeps "up" meaning up on
      // screen however the track is laid out.
      const to = steppedTargetIndex(rows, index, direction, trackAxis(track));
      if (to === null || !onMove(index, to)) return;

      announce(`Row moved to position ${positionLabel(to)}`);
      requestRowFocus(to);
    },
    [index, onMove, positionLabel, announce]
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
