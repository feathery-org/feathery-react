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
export const MENU_CLASS = 'feathery-repeat-reorder-menu';
export const MENU_ITEM_CLASS = 'feathery-repeat-reorder-menu-item';
export const INSERT_CLASS = 'feathery-repeat-insert';

export const ROW_ATTR = 'data-feathery-repeat-row';
export const HANDLE_ATTR = 'data-feathery-reorder-handle';

/**
 * The chrome sits in a gutter beside the row. It hangs off the outer container
 * rather than the inner one, so a thicker border or more padding pushes the
 * content in without ever reaching the dots.
 */
export const GUTTER_WIDTH = 28;

const ink = 'var(--feathery-repeat-handle-ink, currentColor)';
const surface = 'var(--feathery-repeat-menu-surface, #fff)';

/** Revealed by the row, so a resting form carries no extra furniture. */
export const clusterStyles = {
  position: 'absolute' as const,
  insetBlockStart: 0,
  insetInlineStart: `-${GUTTER_WIDTH}px`,
  width: `${GUTTER_WIDTH - 6}px`,
  color: ink,
  pointerEvents: 'none' as const,
  opacity: 0,
  transition: 'opacity 0.12s ease',
  // Hover cannot be the only way in. Touch never fires it, so on a coarse
  // pointer the handle is simply always there.
  '@media (hover: none)': { opacity: 1 }
};

/** Applied to the row so its own hover drives the chrome. */
export const rowRevealStyles = {
  [`&:hover .${REORDER_CLASS}, &:focus-within .${REORDER_CLASS}`]: {
    opacity: 1
  },
  [`&:hover .${INSERT_CLASS}, &:focus-within .${INSERT_CLASS}`]: { opacity: 1 }
};

export const gripStyles = {
  position: 'absolute' as const,
  insetBlockStart: 0,
  insetInlineStart: '50%',
  transform: 'translateX(-50%)',
  pointerEvents: 'auto' as const,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '20px',
  height: '24px',
  padding: 0,
  border: 0,
  background: 'none',
  color: 'inherit',
  borderRadius: '4px',
  cursor: 'grab',
  opacity: 0.5,
  transition: 'opacity 0.12s ease',
  // Required for a pointer drag to survive a touch gesture; scoped to the grip
  // so scrolling anywhere else in the form is unaffected.
  touchAction: 'none' as const,
  '&:hover, &:focus-visible': { opacity: 1 },
  '&:active': { cursor: 'grabbing', opacity: 1 }
};

export const menuStyles = {
  position: 'absolute' as const,
  insetBlockStart: 0,
  insetInlineStart: '100%',
  marginInlineStart: '4px',
  zIndex: 4,
  pointerEvents: 'auto' as const,
  minWidth: '132px',
  padding: '4px',
  background: surface,
  color: 'inherit',
  font: 'inherit',
  fontSize: '13px',
  border: '1px solid',
  borderColor: 'rgba(0, 0, 0, 0.12)',
  borderRadius: '8px',
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)'
};

export const menuItemStyles = {
  display: 'block',
  width: '100%',
  padding: '6px 10px',
  border: 0,
  background: 'none',
  color: 'inherit',
  font: 'inherit',
  fontSize: '13px',
  textAlign: 'start' as const,
  borderRadius: '5px',
  cursor: 'pointer',
  '&:hover:not(:disabled), &:focus-visible': {
    background: 'rgba(0, 0, 0, 0.06)'
  },
  '&:disabled': { opacity: 0.35, cursor: 'default' }
};

/** Sits on the seam below a row, centred so it reads as "insert here". */
export const insertStyles = {
  position: 'absolute' as const,
  insetInlineStart: '50%',
  insetBlockEnd: 0,
  transform: 'translate(-50%, 50%)',
  zIndex: 3,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '18px',
  height: '18px',
  padding: 0,
  border: '1px solid',
  borderColor: 'currentColor',
  borderRadius: '5px',
  background: surface,
  color: ink,
  cursor: 'pointer',
  opacity: 0,
  transition: 'opacity 0.12s ease',
  '&:hover, &:focus-visible': { opacity: 1 },
  '@media (hover: none)': { opacity: 0.6 }
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
