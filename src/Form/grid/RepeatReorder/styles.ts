/**
 * The handle chrome inherits from the form instead of carrying a palette of its
 * own. Colour comes from `currentColor`, so it picks up whatever the theme set
 * on the row, and weight comes from opacity rather than a fixed grey - a hard
 * coded neutral looks wrong on any form that is not light with dark text.
 * Every value still routes through a custom property so a form's custom CSS can
 * override it, and every node carries a stable class name to target.
 */
export const REORDER_CLASS = 'feathery-repeat-reorder';
export const GRIP_CLASS = 'feathery-repeat-reorder-grip';
export const STEP_CLASS = 'feathery-repeat-reorder-step';
export const REMOVE_CLASS = 'feathery-repeat-reorder-remove';
export const INSERT_CLASS = 'feathery-repeat-insert';

export const ROW_ATTR = 'data-feathery-repeat-row';
/**
 * Which container a row belongs to.
 *
 * Repeat rows are not nested inside their own container in the DOM - every
 * container on a step renders its rows as siblings of every other container's,
 * under one shared parent. So the row marker alone cannot identify a track:
 * two containers both have a row 0. Rows carry their container as well, and
 * every lookup filters on both.
 */
export const TRACK_ATTR = 'data-feathery-repeat-track';
export const HANDLE_ATTR = 'data-feathery-reorder-handle';
/** Set on every row in a track for as long as one of them is being dragged. */
export const DRAGGING_ATTR = 'data-feathery-reorder-dragging';
/**
 * Set on a cluster that holds focus a keyboard put there. Focus a pointer
 * left behind does not count, so a clicked grip does not keep its row lit
 * after the pointer has moved on. See modality.ts.
 */
export const KEYBOARD_FOCUS_ATTR = 'data-feathery-reorder-keyboard-focus';

/**
 * The chrome sits in a gutter beside the row. It hangs off the outer container
 * rather than the inner one, so a thicker border or more padding pushes the
 * content in without ever reaching the dots.
 *
 * Wide enough for a 24px control plus a little air, because every
 * control in here has to meet the minimum target size.
 */
export const GUTTER_WIDTH = 30;

/**
 * Minimum hit area for every control, per WCAG 2.2 SC 2.5.8.
 *
 * The painted glyph stays small - the extra is transparent padding around it -
 * so meeting the minimum does not turn the quiet chrome into furniture.
 */
export const TARGET_SIZE = 24;

/**
 * Stacking for the row being carried.
 *
 * A lift has to clear whatever the form draws over its own content - the
 * hosted form's chrome sits at 10 - so a small number loses and the row is
 * dragged underneath text inputs and footers. High enough to clear ordinary
 * page furniture, low enough to stay under a modal.
 */
export const LIFT_Z_INDEX = 1000;

const ink = 'var(--feathery-repeat-handle-ink, currentColor)';

/**
 * The seam's badge has to sit on something opaque or the row shows through it.
 *
 * White was wrong on any form that is not light: the badge punched a bright
 * hole in a dark theme. The surface is resolved at runtime from the first
 * ancestor that actually paints a background (see RESOLVED_SURFACE_VAR) and
 * published as a custom property, with white left as the last resort. The
 * author-facing variable is checked first, so custom CSS still wins.
 */
const surface =
  'var(--feathery-repeat-insert-surface, ' +
  'var(--feathery-repeat-insert-surface-resolved, #fff))';

/**
 * Where the runtime-resolved background is published. Deliberately NOT the
 * author-facing name: an inline value would outrank a form's own stylesheet.
 */
export const RESOLVED_SURFACE_VAR = '--feathery-repeat-insert-surface-resolved';

/**
 * Revealed by the row, so a resting form carries no extra furniture.
 *
 * A column, because the grip is stacked between the two step buttons that are
 * the drag's single-pointer alternative (WCAG 2.2 SC 2.5.7).
 */
export const clusterStyles = {
  position: 'absolute' as const,
  // Half a target down, so the seam - which straddles the row's top edge, in
  // this same gutter - abuts the first step button instead of covering it.
  insetBlockStart: `${TARGET_SIZE / 2}px`,
  insetInlineStart: `-${GUTTER_WIDTH}px`,
  width: `${TARGET_SIZE}px`,
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  color: ink,
  pointerEvents: 'none' as const,
  opacity: 0,
  transition: 'opacity 0.12s ease',
  // Hover cannot be the only way in. Touch never fires it, so on a coarse
  // pointer the handle is simply always there.
  '@media (hover: none)': { opacity: 1 }
};

/**
 * The cluster when the leading seam beside it has been tucked inside the row.
 *
 * A tucked seam occupies the row's first target instead of straddling its
 * edge, so the cluster gives up a whole target rather than half of one. The
 * two still abut exactly; without this the seam would cover the step button.
 */
export const clusterStylesTucked = {
  ...clusterStyles,
  insetBlockStart: `${TARGET_SIZE}px`
};

/**
 * Where the cluster goes when the row is full bleed and the gutter has nothing
 * to hang in. It rides the row's top corner, laid out along the edge rather
 * than down it, so it covers the border instead of the first words of the
 * row's own label.
 *
 * The trailing corner, not the centre: the seam of the row above lands on this
 * same boundary, and centred it sat underneath the `+`. Labels are read from
 * the leading edge, so the trailing corner is the emptiest part of the row.
 */
export const clusterInsideStyles = {
  ...clusterStyles,
  // Back on the edge itself: inside the row the seam returns to the centre, so
  // there is nothing here to clear.
  insetBlockStart: 0,
  insetInlineStart: 'auto',
  insetInlineEnd: '8px',
  width: 'auto',
  flexDirection: 'row' as const,
  gap: '2px',
  padding: '0 4px',
  border: '1px solid',
  borderColor: 'currentColor',
  borderRadius: '5px',
  background: surface,
  transform: 'translateY(-50%)'
};

/** Applied to the row so its own hover drives the chrome. */
export const rowRevealStyles = {
  // The row under the pointer, or the row a keyboard user has reached. Not
  // plain `:focus-within`: a pointer click leaves focus on the grip as well,
  // and that kept a row lit long after the pointer had left it, so hovering
  // any other row showed two toolbars.
  [`&:hover .${REORDER_CLASS}, & .${REORDER_CLASS}[${KEYBOARD_FOCUS_ATTR}]`]: {
    opacity: 1
  },
  // Hover-only, so exactly one seam can show. Adding `:focus-within` lit both
  // the row being typed in and the row under the pointer, and those two seams
  // can be the same boundary. The button lights itself on :focus-visible, so
  // keyboard reach is unaffected.
  [`&:hover .${INSERT_CLASS}`]: { opacity: 1 },
  // No boundary is where it looks during a drag, so no seam is offered. The
  // `:hover` variant is spelled out so this wins on specificity, not on order.
  [`&[${DRAGGING_ATTR}] .${INSERT_CLASS},
    &[${DRAGGING_ATTR}]:hover .${INSERT_CLASS}`]: {
    opacity: 0,
    pointerEvents: 'none'
  }
};

const clusterButton = {
  pointerEvents: 'auto' as const,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  // The box is the hit area, not the drawing. Each glyph is its own small svg
  // centred in here, so the chrome looks the same as before but can be hit.
  width: `${TARGET_SIZE}px`,
  height: `${TARGET_SIZE}px`,
  padding: 0,
  border: 0,
  background: 'none',
  color: 'inherit',
  borderRadius: '4px',
  opacity: 0.5,
  transition: 'opacity 0.12s ease',
  '&:hover, &:focus-visible': { opacity: 1 }
};

/**
 * Moves the row one place without a drag, which is what SC 2.5.7 asks for.
 * Kept in the same gutter as the grip so every control reads as one cluster.
 */
export const stepStyles = {
  ...clusterButton,
  cursor: 'pointer',
  '&:disabled': { opacity: 0.2, cursor: 'default' }
};

/**
 * Removes the row. Last in the cluster and set a little apart from the step
 * buttons, so a hand reaching for "move down" does not land on "delete".
 */
export const removeStyles = {
  ...clusterButton,
  cursor: 'pointer',
  marginBlockStart: '4px'
};

export const gripStyles = {
  ...clusterButton,
  cursor: 'grab',
  // Required for a pointer drag to survive a touch gesture; scoped to the grip
  // so scrolling anywhere else in the form is unaffected.
  touchAction: 'none' as const,
  '&:active': { cursor: 'grabbing', opacity: 1 }
};

/**
 * Sits on the seam between two rows, on whichever edge of the row the pointer
 * is nearer, in the same gutter as the grip.
 *
 * Centred on the row it was 317px from the handle on a 600px row, so reaching
 * for one control meant leaving the other behind. In the gutter the whole set
 * reads as one cluster: the block axis still says WHICH seam, the inline axis
 * now agrees with the grip.
 */
const insertBase = {
  position: 'absolute' as const,
  insetInlineStart: `-${GUTTER_WIDTH}px`,
  width: `${TARGET_SIZE}px`,
  height: `${TARGET_SIZE}px`,
  zIndex: 3,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: 0,
  background: 'none',
  color: ink,
  cursor: 'pointer',
  opacity: 0,
  transition: 'opacity 0.12s ease',
  '&:hover, &:focus-visible': { opacity: 1 },
  '@media (hover: none)': { opacity: 0.6 }
};

/** The badge drawn inside the seam button, kept small while the button is not. */
export const insertBadgeStyles = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '18px',
  height: '18px',
  border: '1px solid',
  borderColor: 'currentColor',
  borderRadius: '5px',
  background: surface
};

/**
 * Where the seam goes when the gutter has no room - the same full-bleed case
 * that drives the cluster inside. Back to the centre of the row, which is
 * always on screen and clear of the cluster's trailing corner.
 */
const insertInsideBase = {
  insetInlineStart: '50%'
};

export const insertInsideStyles = {
  ...insertInsideBase,
  transform: 'translate(-50%, 50%)'
};

export const insertInsideStylesAbove = {
  ...insertInsideBase,
  transform: 'translate(-50%, -50%)'
};

/** On the seam below the row: insert after it. */
export const insertStyles = {
  ...insertBase,
  insetBlockEnd: 0,
  transform: 'translateY(50%)'
};

/** On the seam above the row: insert before it. */
export const insertStylesAbove = {
  ...insertBase,
  insetBlockStart: 0,
  transform: 'translateY(-50%)'
};

/**
 * The leading seam when there is no scrollback above it to straddle into.
 *
 * A container flush with the top of the page puts that boundary at the
 * document's own origin, so the half of the button that hangs above it is not
 * merely clipped - it cannot be scrolled to and it cannot be clicked. Tucking
 * the whole button inside the row keeps the one control that prepends a row
 * reachable; the seam reads as slightly low rather than as half a button.
 */
export const insertStylesAboveTucked = {
  ...insertBase,
  insetBlockStart: 0,
  transform: 'none'
};

export const visuallyHidden = {
  position: 'absolute' as const,
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: 0,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap' as const,
  border: 0
};
