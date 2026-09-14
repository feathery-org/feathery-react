import React, {
  RefObject,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';
import { getPositionKey } from '../../../utils/hideAndRepeats';
import {
  getContainerById,
  getFieldsInRepeat,
  getRepeatContainerRowCount,
  resolveAddRowActions
} from '../../../utils/repeat';
import { isFixedContainer } from '../StyledContainer/hooks/useFixedContainer';
import { announceReorder, subscribeToReorderAnnouncements } from './announce';
import { useRowDrag } from './useRowDrag';
import {
  GRIP_CLASS,
  GUTTER_WIDTH,
  HANDLE_ATTR,
  INSERT_CLASS,
  REORDER_CLASS,
  RESOLVED_SURFACE_VAR,
  STEP_CLASS,
  clusterInsideStyles,
  clusterStyles,
  gripStyles,
  insertBadgeStyles,
  insertInsideStyles,
  insertInsideStylesAbove,
  insertStyles,
  insertStylesAbove,
  stepStyles,
  visuallyHidden
} from './styles';
import { featheryWindow } from '../../../utils/browser';

/**
 * The instructions node every handle points `aria-describedby` at.
 *
 * Scoped to the form: a page can carry several Feathery forms, and a fixed id
 * would have each form's handles described by whichever form rendered first.
 */
export const reorderInstructionsId = (formId: string) =>
  `feathery-repeat-reorder-instructions-${formId}`;

/**
 * Fills its button rather than sitting at a fixed size inside it: a 9px glyph
 * in a 16px box leaves an unsplittable half pixel either side, so the plus
 * drifts off centre. The viewBox does the centring in exact units instead.
 */
const Plus = () => (
  <svg
    width='100%'
    height='100%'
    viewBox='0 0 18 18'
    preserveAspectRatio='xMidYMid meet'
    aria-hidden='true'
  >
    <path
      d='M9 5v8M5 9h8'
      stroke='currentColor'
      strokeWidth='1.6'
      strokeLinecap='round'
    />
  </svg>
);

/** Points at the seam the row would step to, so the two read as a pair. */
const Chevron = ({ up }: { up: boolean }) => (
  <svg width='10' height='10' viewBox='0 0 10 10' aria-hidden='true'>
    <path
      d={up ? 'M2 6.5L5 3.5l3 3' : 'M2 3.5L5 6.5l3-3'}
      fill='none'
      stroke='currentColor'
      strokeWidth='1.6'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

/**
 * The nearest background the row is actually sitting on.
 *
 * Containers are transparent by default, so the colour that matters is usually
 * several levels up. Everything the chrome draws already inherits its ink from
 * the form through `currentColor`; this is the other half, so the seam's badge
 * matches a dark theme instead of punching a white hole in it.
 */
const resolveSurface = (from: HTMLElement): string | null => {
  let el: HTMLElement | null = from;
  while (el) {
    const bg = getComputedStyle(el).backgroundColor;
    // Anything with alpha above zero counts; the shorthand and the rgba form
    // are both how a browser reports "nothing painted here".
    if (bg && bg !== 'transparent' && !/,\s*0\s*\)$/.test(bg)) return bg;
    el = el.parentElement;
  }
  return null;
};

/** The conventional six-dot drag affordance. */
const Grip = () => (
  <svg width='10' height='16' viewBox='0 0 10 16' aria-hidden='true'>
    {[3, 8, 13].map((y) =>
      [3, 7].map((x) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r='1.35' fill='currentColor' />
      ))
    )}
  </svg>
);

export interface RepeatRowReorder {
  index: number;
  ordinal: number;
  renderedCount: number;
  /** Which absolute repeat indices are on screen, in absolute order. */
  visible: boolean[];
  /** This form instance, so live region and handles agree on one channel. */
  formId: string;
  /**
   * This container within this form. Two reorderable containers on a step both
   * have a row at any given index, so a focus handoff has to name the track as
   * well as the row.
   */
  trackId: string;
  /** False on a lone row: there is nothing to reorder it against. */
  canReorder: boolean;
  /** False once the container has reached the author's row cap. */
  canInsert: boolean;
  onMove: (from: number, to: number) => boolean;
  onInsert: (at: number) => boolean;
}

/**
 * Decides whether this container node is a reorderable repeat row, and gathers
 * what the handle needs. Returns null whenever reordering would be unsafe or
 * meaningless, so `Container` can mount the handle unconditionally.
 */
export function useRepeatRowReorder(
  node: any,
  form: any
): RepeatRowReorder | null {
  const activeStep = form.activeStep;
  const index = node.repeat;

  if (!node.repeatRoot || !node.properties?.reorderable) return null;
  if (typeof index !== 'number' || !activeStep) return null;

  // A fixed container renders a second copy of itself with the same props, so
  // the row marker would appear twice and the track would see 2N rows.
  if (isFixedContainer(node, undefined, form.formSettings?.mobileBreakpoint))
    return null;

  // A submit in flight owns a repeat index of its own (button loaders carry
  // one), and a half-permuted payload would go out with it.
  if (Object.keys(form.buttonLoaders ?? {}).length) return null;

  const container = getContainerById(activeStep, node.id);
  if (!container) return null;

  // Row count driven purely by text variables leaves updateRepeatValues with
  // nothing to permute.
  if (!getFieldsInRepeat(activeStep, container).length) return null;

  const rowCount = getRepeatContainerRowCount(activeStep, container);
  // Excludes the phantom trailing row a 'set_value' trigger renders past the
  // end of the data - it has no row behind it to move or insert against.
  if (rowCount < 1 || index >= rowCount) return null;

  // A lone row has nothing to reorder against, but it can still be the anchor
  // for adding the second one, so it keeps the seam and loses only the grip.
  const canReorder = rowCount >= 2;

  // The badge counts what the user can see: a hide_if in the middle must not
  // make the visible rows read 1, 3, 4. Counted in absolute order, which is
  // screen order for every track the SDK itself lays out; a custom stylesheet
  // that reverses the track would need DOM measurement to number correctly,
  // and this hook runs at render time with nothing to measure.
  // Trimmed to the rows the data actually has: with a 'set_value' trigger the
  // flags run one longer than the data, and counting that phantom row made
  // three rows label themselves "Row 1 of 4" and left the last row's down
  // button enabled with nowhere to go.
  const flags: boolean[] = (
    form.visiblePositions?.[getPositionKey(node)] ?? []
  ).slice(0, rowCount);
  const visible = flags.length ? flags : Array(rowCount).fill(true);
  const ordinal = visible.slice(0, index).filter(Boolean).length + 1;
  const renderedCount = visible.filter(Boolean).length;

  // A seam that cannot add a row should not be offered. insertRepeatedRow
  // refuses at the cap regardless, but a button that silently does nothing
  // reads as broken.
  //
  // Sorting and inserting are separate permissions: a list whose order carries
  // meaning often wants rearranging without growing. `insertable` is opt-out
  // rather than opt-in so containers that predate the split keep their seam.
  // One scan of the step answers both questions: is there anything that can
  // add a row here, and what ceiling does it impose. This runs per row on
  // every render, so it is not worth walking the step twice.
  const addRow = resolveAddRowActions(activeStep, container.id);
  const canInsert =
    node.properties?.insertable !== false &&
    addRow.exists &&
    (addRow.cap === null || rowCount < addRow.cap);
  if (!canReorder && !canInsert) return null;

  return {
    index,
    ordinal,
    renderedCount,
    visible,
    formId: form.formInstanceId,
    trackId: `${form.formInstanceId}:${container.id}`,
    canReorder,
    canInsert,
    onMove: (from: number, to: number) =>
      Boolean(form.moveRepeatedRow?.(container, from, to)),
    onInsert: (at: number) => Boolean(form.insertRepeatedRow?.(container, at))
  };
}

export const RepeatRowHandle = ({
  index,
  ordinal,
  renderedCount,
  visible,
  formId,
  trackId,
  canReorder,
  canInsert,
  onMove,
  onInsert,
  rowRef
}: RepeatRowReorder & { rowRef: RefObject<HTMLElement | null> }) => {
  const clusterRef = useRef<HTMLDivElement>(null);

  // Which seam the `+` sits on. Bottom is the resting choice: touch fires no
  // hover, so a coarse pointer never gets a chance to pick a side.
  const [seamAbove, setSeamAbove] = useState(false);

  // Whether the gutter had room to hang in. See the offset effect below.
  const [inside, setInside] = useState(false);

  // An absolutely positioned child is offset from its ancestor's padding box,
  // which sits inside the border. So a static offset is eaten by a thick
  // outline and the chrome ends up drawn over it. Measuring the border keeps
  // the gutter outside the box however heavy the outline gets.
  useEffect(() => {
    const cluster = clusterRef.current;
    const row = rowRef.current;
    if (!cluster || !row) return;

    const apply = () => {
      const win = featheryWindow();
      const style = getComputedStyle(row);
      const border =
        parseFloat(style.borderInlineStartWidth || style.borderLeftWidth) || 0;
      const gutter = GUTTER_WIDTH + border;

      // The gutter hangs off the outside of the row, so it needs somewhere to
      // hang. A full-bleed row - a phone, or any form sitting flush to the
      // viewport edge - leaves none, and the whole cluster lands off-screen
      // with no horizontal scroll to reach it. That is worse on touch than on
      // a pointer: the chrome is permanently visible there and the grip cannot
      // be dragged, so an off-screen cluster means the row cannot be reordered
      // at all. Falling inside the row overlaps its leading edge, which is a
      // smaller price than a control nobody can reach.
      const rect = row.getBoundingClientRect();
      // An unmeasured row - before first layout, or anywhere without a layout
      // engine - reads as a zero rect, which is not the same as no room. Keep
      // the designed position and let the observer correct it once the row has
      // a real box.
      const measured = rect.width > 0 || rect.height > 0;
      const space =
        style.direction === 'rtl' ? win.innerWidth - rect.right : rect.left;

      const fits = !measured || space >= gutter;
      setInside(!fits);
      // Only the gutter position depends on the border. The inside variant
      // centres itself on the row's top edge, so it must be left to the
      // stylesheet rather than pinned by a measured offset.
      if (fits) cluster.style.insetInlineStart = `-${gutter}px`;
      else cluster.style.removeProperty('inset-inline-start');

      // Published on the row so both the cluster and the seam inherit it.
      const resolved = resolveSurface(row);
      if (resolved) row.style.setProperty(RESOLVED_SURFACE_VAR, resolved);
      else row.style.removeProperty(RESOLVED_SURFACE_VAR);
    };
    apply();

    const win = featheryWindow();
    win.addEventListener('resize', apply);
    const Observer = (win as any).ResizeObserver;
    const observer = Observer ? new Observer(apply) : null;
    observer?.observe(row);
    return () => {
      win.removeEventListener('resize', apply);
      observer?.disconnect();
    };
    // The offset depends on the row's border width and on how much room sits
    // outside it, and the observer plus the resize listener are what watch
    // those. Re-running per render rebuilt an observer and forced a style
    // resolution for every row on every keystroke. `canReorder` is a dep
    // because the cluster only exists once there is a grip to put in it.
  }, [rowRef, canReorder]);

  // The `+` belongs on the boundary the filler is pointing at, so it follows
  // the pointer to whichever edge of the row is nearer. State only changes when
  // the half changes, so a move across one half is not a re-render per pixel.
  useEffect(() => {
    const row = rowRef.current;
    if (!row || !canInsert) return;

    const onPointerMove = (event: any) => {
      const rect = row.getBoundingClientRect();
      if (!rect.height) return;
      const above = event.clientY < rect.top + rect.height / 2;
      setSeamAbove((prev) => (prev === above ? prev : above));
    };

    row.addEventListener('pointermove', onPointerMove);
    return () => row.removeEventListener('pointermove', onPointerMove);
  }, [rowRef, canInsert]);

  // Built from the same flags as the badge below, so what a move announces and
  // what the handle calls itself can never drift apart.
  const positionLabel = useCallback(
    (abs: number) =>
      `${visible.slice(0, abs).filter(Boolean).length + 1} of ${renderedCount}`,
    [visible, renderedCount]
  );
  const announce = useCallback(
    (message: string) => announceReorder(formId, message),
    [formId]
  );

  const { dragging, handleRef, handleProps, move } = useRowDrag({
    index,
    trackId,
    onMove,
    positionLabel,
    announce,
    disabled: !canReorder
  });

  /**
   * Dragging is not the only way to move a row: SC 2.5.7 wants a single-pointer
   * path, and the arrow keys do not count because that criterion is about
   * pointer input. These run the same step the keys do.
   *
   * Ends are disabled by ordinal rather than measured, which keeps them
   * agreeing with the handle's own "Row N of M" label. On a track a customer's
   * own CSS has reversed, that label is already counted in absolute order, so
   * this shares the limitation instead of adding a second one.
   */
  const stepButton = (up: boolean) => (
    <button
      type='button'
      className={STEP_CLASS}
      css={stepStyles}
      disabled={up ? ordinal === 1 : ordinal === renderedCount}
      aria-label={up ? `Move row ${ordinal} up` : `Move row ${ordinal} down`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        move(up ? -1 : 1);
      }}
    >
      <Chevron up={up} />
    </button>
  );

  return (
    <>
      {canInsert && (
        <button
          type='button'
          className={INSERT_CLASS}
          css={{
            ...(seamAbove ? insertStylesAbove : insertStyles),
            // Same fallback the cluster takes: with no gutter to sit in, the
            // seam returns to the centre of the row rather than off screen.
            ...(inside
              ? seamAbove
                ? insertInsideStylesAbove
                : insertInsideStyles
              : {})
          }}
          aria-label={
            seamAbove
              ? `Add a row above row ${ordinal}`
              : `Add a row below row ${ordinal}`
          }
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onInsert(seamAbove ? index : index + 1);
          }}
        >
          <span css={insertBadgeStyles}>
            <Plus />
          </span>
        </button>
      )}
      {canReorder && (
        <div
          ref={clusterRef}
          className={REORDER_CLASS}
          css={inside ? clusterInsideStyles : clusterStyles}
        >
          {stepButton(true)}
          <button
            {...{ [HANDLE_ATTR]: '' }}
            ref={handleRef as any}
            type='button'
            className={GRIP_CLASS}
            css={gripStyles}
            aria-roledescription='sortable row handle'
            aria-label={`Row ${ordinal} of ${renderedCount}`}
            aria-describedby={reorderInstructionsId(formId)}
            aria-pressed={dragging}
            {...handleProps}
          >
            <Grip />
          </button>
          {stepButton(false)}
        </div>
      )}
    </>
  );
};

/**
 * One polite live region per form. Rendered by Grid rather than by the handle
 * so screen readers see a single stable node instead of one per row.
 */
export const ReorderLiveRegion = ({ formId }: { formId: string }) => {
  const [message, setMessage] = useState('');
  useEffect(
    () => subscribeToReorderAnnouncements(formId, setMessage),
    [formId]
  );

  return (
    <>
      <span id={reorderInstructionsId(formId)} css={visuallyHidden}>
        Drag the handle to move this row, or press the arrow keys while it is
        focused. The buttons above and below the handle move the row one place
        without dragging.
      </span>
      <span
        role='status'
        aria-live='polite'
        aria-atomic='true'
        css={visuallyHidden}
      >
        {message}
      </span>
    </>
  );
};
