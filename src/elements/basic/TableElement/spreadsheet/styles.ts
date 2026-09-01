// Layout constants. Rows and the header are fixed-height because the row
// virtualizer, the frozen-row region offset and the drag hit-testing all size
// themselves from these numbers.
export const ROW_HEIGHT = 32;
export const HEADER_HEIGHT = 34;
export const ROW_HEADER_WIDTH = 46;
// Cell text size. Rows and the header are sized off this, so bumping one
// without the other would clip descenders.
export const FONT_SIZE = 16;

// The grid pins its own typography rather than inheriting the form's theme:
// a display font, letter-spacing or an inherited line-height would break the
// fixed row height the virtualizer and drag hit-testing depend on.
export const GRID_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
export const DEFAULT_COLUMN_WIDTH = 160;
export const MIN_COLUMN_WIDTH = 64;
export const CELL_HORIZONTAL_PADDING = 10;

// With no sized height there is nothing to scroll inside, so an unbounded grid
// is capped here instead of growing down the page forever.
export const FIT_MAX_HEIGHT = 400;

/**
 * Pixel height to give the grid, or `undefined` when the element's own
 * container is already sized.
 *
 * The row virtualizer measures its scroll container, so a grid with no bounded
 * height renders NO rows at all — and, worse, its natural height is the whole
 * virtual canvas, which the element wrapper's `min-height: fit-content` then
 * locks in. Only `px` bounds the container upstream (the element applies it
 * itself); `%` is capped by the wrapper but still needs a definite height
 * here, and `fit` — the style panel's default — has nothing bounding it at all.
 *
 * The value is a flex-basis, not a cap: a `%` that resolves taller simply grows
 * past it, so the grid still fills a large percentage box.
 */
export function spreadsheetViewportHeight(
  heightUnit: string | undefined,
  rowCount: number
): number | undefined {
  if (heightUnit === 'px') return undefined;
  const content = HEADER_HEIGHT + rowCount * ROW_HEIGHT + 2;
  return Math.min(content, FIT_MAX_HEIGHT);
}

const colors = {
  white: '#ffffff',
  gray50: '#f9fafb',
  gray100: '#f3f4f6',
  gray200: '#e5e7eb',
  gray300: '#d1d5db',
  gray500: '#6b7280',
  gray700: '#374151',
  gray900: '#111827',
  accent: '#1d4ed8',
  accentDark: '#1e40af',
  accentSoft: '#eff6ff',
  accentHeader: '#dbeafe',
  accentTint: 'rgba(29, 78, 216, 0.08)'
} as const;

export const gridStyle = {
  position: 'relative',
  flex: '1 1 auto',
  minWidth: 0,
  minHeight: 0,
  overflow: 'auto',
  outline: 'none',
  overscrollBehavior: 'contain',
  backgroundColor: colors.white,
  cursor: 'default',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  // Every text property the form theme could inherit down is stated here, so
  // the grid renders identically whatever the surrounding form looks like.
  // Descendants inherit from the grid instead.
  fontFamily: GRID_FONT_FAMILY,
  fontSize: `${FONT_SIZE}px`,
  fontWeight: 400,
  fontStyle: 'normal',
  fontVariant: 'normal',
  lineHeight: 'normal',
  letterSpacing: 'normal',
  wordSpacing: 'normal',
  textTransform: 'none',
  textDecoration: 'none',
  textShadow: 'none',
  textAlign: 'start',
  color: colors.gray900
} as const;

export const canvasStyle = {
  position: 'relative',
  minWidth: '100%',
  // Keeps the pinned/sticky layers stacking against each other rather than
  // against anything the form renders around the table.
  isolation: 'isolate'
} as const;

export const rowStyle = {
  position: 'absolute',
  insetInlineStart: 0,
  top: 0,
  display: 'flex',
  width: '100%'
} as const;

export const headerRowStyle = {
  ...rowStyle,
  position: 'sticky',
  top: 0,
  zIndex: 30,
  height: `${HEADER_HEIGHT}px`,
  backgroundColor: colors.gray100,
  borderBottom: `1px solid ${colors.gray300}`
} as const;

export const frozenRegionStyle = {
  position: 'sticky',
  top: `${HEADER_HEIGHT}px`,
  zIndex: 20,
  width: '100%',
  backgroundColor: colors.white,
  boxShadow: '0 2px 2px -1px rgba(0, 0, 0, 0.25)'
} as const;

export const frozenRowStyle = { zIndex: 21 } as const;

/**
 * Lifts a row that the selection touches above the rows around it.
 *
 * Each row carries a `translateY`, which makes it a STACKING CONTEXT — so a
 * z-index on a cell only competes inside its own row and can never rise above
 * a different row. Without this the next row down paints its top grid line
 * over the range's bottom border, and clips the fill handle overhanging the
 * corner. Stays well below the frozen region (20/21) and the header (30).
 */
export const rowRaisedStyle = { zIndex: 2 } as const;

const gutterBase = {
  position: 'sticky',
  insetInlineStart: 0,
  flex: `0 0 ${ROW_HEADER_WIDTH}px`,
  width: `${ROW_HEADER_WIDTH}px`,
  padding: 0,
  margin: 0,
  boxSizing: 'border-box',
  color: colors.gray700,
  backgroundColor: colors.gray50,
  border: 0,
  borderRight: `1px solid ${colors.gray300}`,
  borderBottom: `1px solid ${colors.gray200}`,
  fontSize: `${FONT_SIZE - 4}px`,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'center',
  userSelect: 'none'
} as const;

export const cornerHeaderStyle = {
  ...gutterBase,
  height: `${HEADER_HEIGHT}px`,
  zIndex: 40,
  cursor: 'default',
  '&:hover': { backgroundColor: colors.gray200 }
} as const;

export const rowHeaderStyle = {
  ...gutterBase,
  zIndex: 26,
  height: `${ROW_HEIGHT}px`,
  cursor: 'default',
  '&:hover': { backgroundColor: colors.gray200 }
} as const;

export const headerSelectedStyle = {
  color: colors.white,
  backgroundColor: colors.accent,
  // The base header's hover rule would otherwise repaint the background grey
  // and leave the selected white text unreadable.
  '&:hover': { backgroundColor: colors.accentDark }
} as const;

// (6) The headers of a partly-selected row/column, so the selection's extent
// is readable off the gutter and header strip.
export const headerHighlightStyle = {
  backgroundColor: colors.accentHeader,
  color: colors.gray900
} as const;

export const columnHeaderStyle = {
  position: 'absolute',
  top: 0,
  flex: '0 0 auto',
  display: 'grid',
  placeItems: 'center',
  height: `${HEADER_HEIGHT}px`,
  padding: '0 5px',
  boxSizing: 'border-box',
  // Deliberately NOT `overflow: hidden`: the resize grip sits across the right
  // border and would be clipped. The label span truncates itself instead.
  backgroundColor: colors.gray100,
  borderRight: `1px solid ${colors.gray300}`,
  borderBottom: `1px solid ${colors.gray300}`,
  cursor: 'default',
  userSelect: 'none',
  '&:hover': { backgroundColor: colors.gray200 }
} as const;

export const columnHeaderLabelStyle = {
  display: 'block',
  width: '100%',
  overflow: 'hidden',
  color: colors.gray900,
  fontSize: `${FONT_SIZE - 2}px`,
  fontWeight: 600,
  textAlign: 'center',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
} as const;

// Sticky pinned (frozen) columns sit above normal cells but below the gutter.
// Cell z-index comes from `cellZIndex` so the selected case can stay above.
export const pinnedHeaderStyle = { position: 'sticky', zIndex: 24 } as const;
export const pinnedCellStyle = { position: 'sticky' } as const;
export const lastPinnedStyle = {
  boxShadow: '2px 0 3px -2px rgba(0, 0, 0, 0.35)'
} as const;

export const columnResizerStyle = {
  position: 'absolute',
  top: 0,
  right: '-3px',
  zIndex: 5,
  width: '7px',
  height: '100%',
  cursor: 'col-resize',
  touchAction: 'none',
  '&:hover': { backgroundColor: colors.accent }
} as const;

export const columnResizerActiveStyle = {
  backgroundColor: colors.accent
} as const;

export const dropIndicatorStyle = {
  position: 'absolute',
  top: 0,
  zIndex: 6,
  width: '2px',
  height: '100%',
  backgroundColor: colors.accent
} as const;

export const cellStyle = {
  position: 'absolute',
  top: 0,
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  height: `${ROW_HEIGHT}px`,
  padding: `0 ${CELL_HORIZONTAL_PADDING / 2}px`,
  // NOT `overflow: hidden`: that clips the fill handle straddling the corner.
  // The value span truncates the text instead.
  // The virtualizer lays cells out every `width` px, so the padding and the
  // grid line must be INSIDE that width — content-box would make each cell
  // overlap its right-hand neighbour and push the selection border past the
  // column boundary.
  boxSizing: 'border-box',
  backgroundColor: colors.white,
  borderRight: `1px solid ${colors.gray200}`,
  borderBottom: `1px solid ${colors.gray200}`,
  outline: 'none',
  cursor: 'default',
  fontSize: `${FONT_SIZE}px`,
  whiteSpace: 'nowrap',
  // The selection outline is drawn on a pseudo-element so it can appear on any
  // subset of edges without shifting the cell's box. It sits INSIDE the cell:
  // an outset border overhangs the neighbouring cell, which is a later
  // absolutely-positioned sibling and so paints over it — the right edge of a
  // range would go missing.
  '&::after': {
    position: 'absolute',
    zIndex: 3,
    inset: 0,
    borderColor: colors.accent,
    borderStyle: 'solid',
    borderWidth:
      'var(--edge-top, 0) var(--edge-right, 0) var(--edge-bottom, 0) var(--edge-left, 0)',
    content: '""',
    pointerEvents: 'none'
  }
} as const;

export const cellValueStyle = {
  display: 'block',
  // `minWidth: 0` lets this shrink inside the flex cell so the ellipsis
  // actually engages; the cell itself no longer clips.
  width: '100%',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
} as const;

export const cellSelectedStyle = {
  backgroundColor: colors.accentSoft
} as const;

export const cellFocusedStyle = {
  boxShadow: `inset 0 0 0 2px ${colors.accent}`
} as const;

/**
 * Stacking order for one cell, within its row.
 *
 * Cells are absolutely positioned siblings, so a later one paints its grid line
 * over an earlier one's selection border; a selected cell has to be lifted for
 * the blue to sit above the grey and for the fill handle to overhang the
 * corner. Pinned cells already sit above the scrolling ones, so a selected
 * pinned cell has to stay above THEM rather than dropping to the plain
 * selected level.
 */
export function cellZIndex(pinned: boolean, raised: boolean) {
  if (pinned) return raised ? 13 : 12;
  return raised ? 4 : undefined;
}

export const cellFillPreviewStyle = {
  backgroundImage: `repeating-linear-gradient(135deg, ${colors.accentTint} 0 4px, rgba(29, 78, 216, 0.16) 4px 8px)`,
  outline: `1px dashed ${colors.accent}`,
  outlineOffset: '-2px'
} as const;

export const fillHandleStyle = {
  position: 'absolute',
  // Straddles the bottom-right corner, centred on the grid intersection.
  // Possible because the cell no longer clips its overflow (the value span
  // truncates instead) and the selected cell is raised above its neighbours.
  right: '-4px',
  bottom: '-4px',
  zIndex: 8,
  width: '8px',
  height: '8px',
  backgroundColor: colors.accent,
  border: `1px solid ${colors.white}`,
  cursor: 'crosshair'
} as const;

export const cellEditorStyle = {
  position: 'absolute',
  zIndex: 10,
  inset: '-1px',
  width: 'calc(100% + 2px)',
  minWidth: '100%',
  height: 'calc(100% + 2px)',
  padding: `0 ${CELL_HORIZONTAL_PADDING / 2}px`,
  boxSizing: 'border-box',
  backgroundColor: colors.white,
  border: `2px solid ${colors.accent}`,
  outline: 'none',
  cursor: 'text',
  fontSize: `${FONT_SIZE}px`,
  fontFamily: 'inherit',
  userSelect: 'text',
  WebkitUserSelect: 'text'
} as const;

// A range's perimeter is deliberately lighter than the 2px ring on the focused
// cell, so the active cell still reads as the active one inside a selection.
export const edgeVars = {
  top: { '--edge-top': '1px' },
  right: { '--edge-right': '1px' },
  bottom: { '--edge-bottom': '1px' },
  left: { '--edge-left': '1px' }
} as const;

export const rowMenuStyle = {
  position: 'fixed',
  zIndex: 1000,
  display: 'flex',
  flexDirection: 'column',
  minWidth: '180px',
  padding: '4px',
  backgroundColor: colors.white,
  border: `1px solid ${colors.gray300}`,
  borderRadius: '6px',
  boxShadow: '0 6px 16px rgba(0, 0, 0, 0.18)',
  fontFamily: GRID_FONT_FAMILY,
  fontSize: `${FONT_SIZE - 2}px`,
  color: colors.gray900
} as const;

export const rowMenuItemStyle = {
  display: 'block',
  width: '100%',
  padding: '7px 10px',
  backgroundColor: 'transparent',
  border: 0,
  borderRadius: '4px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 'inherit',
  color: 'inherit',
  textAlign: 'start',
  '&:hover': { backgroundColor: colors.accentSoft }
} as const;

// The trailing "add a row" strip, styled as an affordance rather than data.
export const addRowStripStyle = {
  ...rowStyle,
  display: 'flex',
  alignItems: 'center',
  height: `${ROW_HEIGHT}px`,
  padding: 0,
  backgroundColor: colors.gray50,
  border: 0,
  borderTop: `1px solid ${colors.gray200}`,
  borderBottom: `1px solid ${colors.gray200}`,
  boxSizing: 'border-box',
  cursor: 'pointer',
  fontFamily: GRID_FONT_FAMILY,
  fontSize: `${FONT_SIZE - 2}px`,
  color: colors.gray500,
  textAlign: 'start',
  '&:hover': { backgroundColor: colors.accentSoft, color: colors.accent }
} as const;

export const addRowStripLabelStyle = {
  position: 'sticky',
  insetInlineStart: 0,
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  paddingInlineStart: `${ROW_HEADER_WIDTH / 2}px`,
  whiteSpace: 'nowrap'
} as const;
