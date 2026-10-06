import {
  FEATHERY_RED,
  TOOLBAR_HEIGHT,
  ZINC
} from '../../DocxEditor/DocxToolbar/styles';

export const FONTS = [
  'Arial',
  'Calibri',
  'Times New Roman',
  'Georgia',
  'Verdana',
  'Courier New',
  'Trebuchet MS',
  'Tahoma'
];

// Bullet-character library, mirroring PowerPoint's default bullet picker.
// Includes the arrow glyphs decks commonly use (→ and ➢) so they round-trip.
export const BULLET_CHARS = [
  '•',
  '○',
  '◦',
  '■',
  '□',
  '▪',
  '◆',
  '➢',
  '→',
  '✓',
  '–',
  '»'
];

// Numbering schemes (OOXML buAutoNum types) shown with a sample of their glyphs.
export const NUMBER_SCHEMES: { scheme: string; sample: string; label: string }[] =
  [
    { scheme: 'arabicPeriod', sample: '1.', label: '1. 2. 3.' },
    { scheme: 'arabicParenR', sample: '1)', label: '1) 2) 3)' },
    { scheme: 'alphaUcPeriod', sample: 'A.', label: 'A. B. C.' },
    { scheme: 'alphaLcParenR', sample: 'a)', label: 'a) b) c)' },
    { scheme: 'romanUcPeriod', sample: 'I.', label: 'I. II. III.' },
    { scheme: 'romanLcPeriod', sample: 'i.', label: 'i. ii. iii.' }
  ];

export const SHAPE_PRESETS = [
  {
    geometry: 'rect',
    label: 'Rectangle',
    cx: 2000000,
    cy: 1200000,
    icon: 'M4 6h16v12H4z'
  },
  {
    geometry: 'roundRect',
    label: 'Rounded rectangle',
    cx: 2000000,
    cy: 1200000,
    icon: 'M8 6h8a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-4a4 4 0 0 1 4-4Z'
  },
  {
    geometry: 'ellipse',
    label: 'Ellipse',
    cx: 1600000,
    cy: 1600000,
    icon: 'M12 5a8 6.5 0 1 0 0 13 8 6.5 0 1 0 0-13Z'
  },
  {
    geometry: 'triangle',
    label: 'Triangle',
    cx: 1600000,
    cy: 1400000,
    icon: 'M12 5 20 19H4z'
  },
  {
    geometry: 'diamond',
    label: 'Diamond',
    cx: 1600000,
    cy: 1600000,
    icon: 'M12 4l8 8-8 8-8-8z'
  }
] as const;

// Contextual table tools get a warm tint so they read as tied to the selection,
// mirroring PowerPoint's contextual-tab convention at Feathery visual weight.
export const AMBER = '#92610e';

export const styles = {
  wrap: {
    display: 'flex',
    flexDirection: 'column' as const,
    background: '#fff'
  },
  topRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    minHeight: TOOLBAR_HEIGHT,
    padding: '4px 8px',
    borderBottom: `1px solid ${ZINC[200]}`
  },
  // One persistent styling row: fixed height so contextual groups (table,
  // picture crop) never shift the editor below; popover menus use fixed
  // positioning, so scroll-clipping here cannot cut them off.
  pane: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    height: 42,
    flex: '0 0 auto',
    padding: '4px 8px',
    overflowX: 'auto' as const
  },
  menuPanel: (left: number, top: number, width: number) => ({
    position: 'fixed' as const,
    left,
    top,
    zIndex: 60,
    width,
    padding: 12,
    background: '#fff',
    border: `1px solid ${ZINC[200]}`,
    borderRadius: 8,
    boxShadow: '0 6px 18px rgba(23,26,28,.13)'
  }),
  menuRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 0 8px'
  },
  menuItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '6px 8px',
    border: 'none',
    borderRadius: 6,
    background: 'transparent',
    color: ZINC[700],
    fontSize: 12.5,
    textAlign: 'left' as const,
    cursor: 'pointer',
    '&:hover': { background: ZINC[100], color: ZINC[900] }
  },
  menuDivider: {
    height: 1,
    background: ZINC[200],
    margin: '6px 0'
  },
  menuHeading: {
    fontSize: 11,
    fontWeight: 600,
    color: ZINC[500],
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
    padding: '2px 2px 6px'
  },
  bulletGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 4
  },
  bulletCell: (on = false) => ({
    height: 34,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: `1px solid ${on ? ZINC[400] : ZINC[200]}`,
    borderRadius: 6,
    background: on ? ZINC[100] : '#fff',
    color: ZINC[700],
    fontSize: 16,
    lineHeight: 1,
    cursor: 'pointer',
    '&:hover': { background: ZINC[100], borderColor: ZINC[400] }
  }),
  numItem: (on = false) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    padding: '6px 8px',
    border: 'none',
    borderRadius: 6,
    background: on ? ZINC[100] : 'transparent',
    color: ZINC[700],
    fontSize: 12.5,
    textAlign: 'left' as const,
    cursor: 'pointer',
    '&:hover': { background: ZINC[100], color: ZINC[900] }
  }),
  numPreview: {
    fontSize: 12.5,
    fontWeight: 600,
    color: ZINC[700],
    minWidth: 42,
    whiteSpace: 'pre' as const
  },
  btn: (on = false, disabled = false) => ({
    height: 30,
    minWidth: 30,
    padding: '0 7px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    border: 'none',
    borderRadius: 6,
    background: on ? ZINC[200] : 'transparent',
    color: on ? ZINC[900] : ZINC[700],
    fontSize: 13,
    fontWeight: 500,
    cursor: disabled ? 'default' : 'pointer',
    whiteSpace: 'nowrap' as const,
    opacity: disabled ? 0.4 : 1,
    transition: 'background .12s',
    '&:hover': disabled ? {} : { background: on ? ZINC[200] : ZINC[100] },
    '&:focus-visible': {
      outline: `2px solid ${FEATHERY_RED}`,
      outlineOffset: 1
    }
  }),
  select: {
    height: 30,
    border: `1px solid ${ZINC[200]}`,
    borderRadius: 6,
    // Native caret spacing is not controllable, so draw our own chevron and
    // reserve room for it with padding-right.
    appearance: 'none' as const,
    WebkitAppearance: 'none' as const,
    MozAppearance: 'none' as const,
    backgroundColor: '#fff',
    backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#71717a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>'
    )}")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 9px center',
    color: ZINC[700],
    fontSize: 12.5,
    padding: '0 28px 0 10px',
    cursor: 'pointer',
    '&:hover': { backgroundColor: ZINC[100] },
    '&:disabled': { opacity: 0.4, cursor: 'default' }
  },
  num: (wide = false) => ({
    width: wide ? 60 : 48,
    height: 30,
    border: `1px solid ${ZINC[200]}`,
    borderRadius: 6,
    background: '#fff',
    color: ZINC[700],
    fontSize: 12.5,
    padding: '0 6px',
    '&:disabled': { opacity: 0.4 }
  }),
  color: {
    width: 30,
    height: 30,
    padding: 2,
    background: '#fff',
    border: `1px solid ${ZINC[200]}`,
    borderRadius: 6,
    cursor: 'pointer',
    '&:disabled': { opacity: 0.4, cursor: 'default' }
  },
  sep: {
    width: 1,
    height: 22,
    background: ZINC[200],
    margin: '0 5px',
    flex: '0 0 auto'
  },
  label: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '.05em',
    textTransform: 'uppercase' as const,
    color: ZINC[400],
    padding: '0 4px',
    whiteSpace: 'nowrap' as const
  },
  cropLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    fontSize: 11,
    color: ZINC[500]
  },
  slideIndicator: {
    fontSize: 12,
    color: ZINC[400],
    padding: '0 8px',
    whiteSpace: 'nowrap' as const
  },
  tableInsert: { position: 'relative' as const },
  tableMenu: {
    position: 'absolute' as const,
    top: '100%',
    left: 0,
    zIndex: 40,
    width: 166,
    padding: 8,
    background: '#fff',
    border: `1px solid ${ZINC[200]}`,
    borderRadius: 8,
    boxShadow: '0 6px 18px rgba(23,26,28,.13)'
  },
  tableLabel: {
    display: 'block',
    marginBottom: 6,
    color: ZINC[700],
    fontSize: 12
  },
  tableGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(8, 16px)',
    gap: 3
  },
  tableCell: (active: boolean) => ({
    width: 16,
    height: 16,
    padding: 0,
    border: `1px solid ${active ? FEATHERY_RED : ZINC[300]}`,
    background: active ? 'rgba(226,98,110,.18)' : '#fff',
    cursor: 'pointer'
  })
};
