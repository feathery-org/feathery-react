// Layout constants. Rows and the header are fixed-height because the row
// virtualizer, the frozen-row region offset and the drag hit-testing all size
// themselves from these numbers.
export const ROW_HEIGHT = 24;
export const HEADER_HEIGHT = 26;
export const ROW_HEADER_WIDTH = 42;
export const DEFAULT_COLUMN_WIDTH = 140;
export const MIN_COLUMN_WIDTH = 56;
export const CELL_HORIZONTAL_PADDING = 10;

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
  accentSoft: '#eff6ff',
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
  cursor: 'cell',
  userSelect: 'none',
  WebkitUserSelect: 'none'
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

const gutterBase = {
  position: 'sticky',
  insetInlineStart: 0,
  flex: `0 0 ${ROW_HEADER_WIDTH}px`,
  width: `${ROW_HEADER_WIDTH}px`,
  padding: 0,
  margin: 0,
  color: colors.gray700,
  backgroundColor: colors.gray50,
  border: 0,
  borderRight: `1px solid ${colors.gray300}`,
  borderBottom: `1px solid ${colors.gray200}`,
  fontSize: '10px',
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
  backgroundColor: colors.accent
} as const;

export const columnHeaderStyle = {
  position: 'absolute',
  top: 0,
  flex: '0 0 auto',
  display: 'grid',
  placeItems: 'center',
  height: `${HEADER_HEIGHT}px`,
  padding: '0 5px',
  overflow: 'hidden',
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
  fontSize: '11px',
  fontWeight: 600,
  textAlign: 'center',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
} as const;

// Sticky pinned (frozen) columns sit above normal cells but below the gutter.
export const pinnedHeaderStyle = { position: 'sticky', zIndex: 24 } as const;
export const pinnedCellStyle = { position: 'sticky', zIndex: 12 } as const;
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
  overflow: 'hidden',
  backgroundColor: colors.white,
  borderRight: `1px solid ${colors.gray200}`,
  borderBottom: `1px solid ${colors.gray200}`,
  outline: 'none',
  cursor: 'cell',
  fontSize: '11px',
  whiteSpace: 'nowrap',
  // The selection outline is drawn on a pseudo-element so a range border can
  // straddle the 1px grid lines without shifting any cell's box.
  '&::after': {
    position: 'absolute',
    zIndex: 3,
    inset: '-1px',
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
  width: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis'
} as const;

export const cellSelectedStyle = {
  backgroundColor: colors.accentSoft
} as const;

export const cellFocusedStyle = {
  boxShadow: `inset 0 0 0 2px ${colors.accent}`
} as const;

export const cellFillPreviewStyle = {
  backgroundImage: `repeating-linear-gradient(135deg, ${colors.accentTint} 0 4px, rgba(29, 78, 216, 0.16) 4px 8px)`,
  outline: `1px dashed ${colors.accent}`,
  outlineOffset: '-2px'
} as const;

export const fillHandleStyle = {
  position: 'absolute',
  right: '-3px',
  bottom: '-3px',
  zIndex: 8,
  width: '7px',
  height: '7px',
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
  backgroundColor: colors.white,
  border: `2px solid ${colors.accent}`,
  outline: 'none',
  cursor: 'text',
  fontSize: '11px',
  fontFamily: 'inherit',
  userSelect: 'text',
  WebkitUserSelect: 'text'
} as const;

export const edgeVars = {
  top: { '--edge-top': '2px' },
  right: { '--edge-right': '2px' },
  bottom: { '--edge-bottom': '2px' },
  left: { '--edge-left': '2px' }
} as const;
