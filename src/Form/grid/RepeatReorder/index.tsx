import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getPositionKey } from '../../../utils/hideAndRepeats';
import {
  getContainerById,
  getFieldsInRepeat,
  getRepeatContainerRowCount,
  getRepeatMaxRows
} from '../../../utils/repeat';
import { isFixedContainer } from '../StyledContainer/hooks/useFixedContainer';
import { announceReorder, subscribeToReorderAnnouncements } from './announce';
import { useRowDrag } from './useRowDrag';
import {
  GRIP_CLASS,
  GUTTER_WIDTH,
  HANDLE_ATTR,
  INSERT_CLASS,
  MENU_CLASS,
  MENU_ITEM_CLASS,
  REORDER_CLASS,
  clusterStyles,
  gripStyles,
  insertStyles,
  menuItemStyles,
  menuStyles,
  visuallyHidden
} from './styles';
import { featheryDoc, featheryWindow } from '../../../utils/browser';

/**
 * The instructions node every handle points `aria-describedby` at.
 *
 * Scoped to the form: a page can carry several Feathery forms, and a fixed id
 * would have each form's handles described by whichever form rendered first.
 */
export const reorderInstructionsId = (formId: string) =>
  `feathery-repeat-reorder-instructions-${formId}`;

/** The conventional six-dot drag affordance. */
/**
 * Fills its button rather than sitting inside it at a fixed size.
 *
 * A fixed 9px glyph inside a 16px content box leaves 3.5px either side, and the
 * browser cannot split that pixel - it rounds one way, so the plus drifts down
 * and to the right of the square it is supposed to be centred in. Letting the
 * SVG fill the box removes the fractional offset, and the viewBox does the
 * centring in its own units where it is exact.
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
  // end of the data.
  if (rowCount < 2 || index >= rowCount) return null;

  // The badge counts what the user can see: a hide_if in the middle must not
  // make the visible rows read 1, 3, 4. Counted in absolute order, which is
  // screen order for every track the SDK itself lays out; a custom stylesheet
  // that reverses the track would need DOM measurement to number correctly,
  // and this hook runs at render time with nothing to measure.
  const flags: boolean[] = form.visiblePositions?.[getPositionKey(node)] ?? [];
  const visible = flags.length ? flags : Array(rowCount).fill(true);
  const ordinal = visible.slice(0, index).filter(Boolean).length + 1;
  const renderedCount = visible.filter(Boolean).length;

  // A seam that cannot add a row should not be offered. insertRepeatedRow
  // refuses at the cap regardless, but a button that silently does nothing
  // reads as broken.
  const maxRows = getRepeatMaxRows(activeStep, container.id);
  const canInsert = maxRows === null || rowCount < maxRows;

  return {
    index,
    ordinal,
    renderedCount,
    visible,
    formId: form.formInstanceId,
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
  canInsert,
  onMove,
  onInsert
}: RepeatRowReorder) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const clusterRef = useRef<HTMLDivElement>(null);

  // An absolutely positioned child is offset from its ancestor's padding box,
  // which sits inside the border. So a static offset is eaten by a thick
  // outline and the chrome ends up drawn over it. Measuring the border keeps
  // the gutter outside the box however heavy the outline gets.
  useEffect(() => {
    const cluster = clusterRef.current;
    const row = cluster?.parentElement;
    if (!cluster || !row) return;

    const apply = () => {
      const style = getComputedStyle(row);
      const border =
        parseFloat(style.borderInlineStartWidth || style.borderLeftWidth) || 0;
      cluster.style.insetInlineStart = `-${GUTTER_WIDTH + border}px`;
    };
    apply();

    const Observer = (featheryWindow() as any).ResizeObserver;
    if (!Observer) return;
    const observer = new Observer(apply);
    observer.observe(row);
    return () => observer.disconnect();
    // Mount only: the offset depends on the row's border width, and the
    // observer is what watches that. Re-running per render rebuilt an observer
    // and forced a style resolution for every row on every keystroke.
  }, []);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

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

  const { dragging, move, handleRef, handleProps } = useRowDrag({
    index,
    onMove,
    positionLabel,
    announce,
    // Tapping the grip is the single-pointer alternative to dragging, which
    // WCAG 2.2 SC 2.5.7 requires and a keyboard path does not satisfy.
    onTap: () => setMenuOpen((open) => !open)
  });

  useEffect(() => {
    if (!menuOpen) return;

    const doc = featheryDoc();
    const onDown = (event: any) => {
      if (!menuRef.current?.contains(event.target)) closeMenu();
    };
    const onKey = (event: any) => {
      if (event.key !== 'Escape') return;
      closeMenu();
      handleRef.current?.focus();
    };

    doc.addEventListener('pointerdown', onDown);
    doc.addEventListener('keydown', onKey);
    return () => {
      doc.removeEventListener('pointerdown', onDown);
      doc.removeEventListener('keydown', onKey);
    };
  }, [menuOpen, closeMenu, handleRef]);

  const label = `Row ${ordinal} of ${renderedCount}`;
  const step = (direction: -1 | 1) => {
    closeMenu();
    move(direction);
  };

  const insertButton = (
    <button
      type='button'
      className={INSERT_CLASS}
      css={insertStyles}
      aria-label={`Add a row below row ${ordinal}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onInsert(index + 1);
      }}
    >
      <Plus />
    </button>
  );

  return (
    <>
      {canInsert && insertButton}
      <div ref={clusterRef} className={REORDER_CLASS} css={clusterStyles}>
        <button
          {...{ [HANDLE_ATTR]: '' }}
          ref={handleRef as any}
          type='button'
          className={GRIP_CLASS}
          css={gripStyles}
          aria-roledescription='sortable row handle'
          aria-label={label}
          aria-describedby={reorderInstructionsId(formId)}
          aria-haspopup='menu'
          aria-expanded={menuOpen}
          aria-pressed={dragging}
          {...handleProps}
        >
          <Grip />
        </button>
        {menuOpen && (
          <div
            ref={menuRef}
            className={MENU_CLASS}
            css={menuStyles}
            role='menu'
            aria-label={`Move ${label}`}
          >
            <button
              type='button'
              role='menuitem'
              className={MENU_ITEM_CLASS}
              css={menuItemStyles}
              disabled={ordinal <= 1}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                step(-1);
              }}
            >
              Move up
            </button>
            <button
              type='button'
              role='menuitem'
              className={MENU_ITEM_CLASS}
              css={menuItemStyles}
              disabled={ordinal >= renderedCount}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                step(1);
              }}
            >
              Move down
            </button>
          </div>
        )}
      </div>
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
        Drag the handle to move this row, press the arrow keys to move it, or
        activate the handle for move options.
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
