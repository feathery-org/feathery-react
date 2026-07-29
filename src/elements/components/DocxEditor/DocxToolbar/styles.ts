// Shared palette + css-object styles for the docx editor toolbar.

export const ZINC = {
  50: '#fafafa',
  100: '#f4f4f5',
  200: '#e4e4e7',
  300: '#d4d4d8',
  400: '#a1a1aa',
  500: '#71717a',
  700: '#3f3f46',
  900: '#18181b'
};
// Feathery primary button colors (matches the dashboard Core Button default).
export const FEATHERY_RED = '#e2626e';
export const FEATHERY_RED_HOVER = '#dc3a4b';

// Breathing room at both toolbar edges so pinned buttons never sit flush
// against the border.
export const EDGE_PAD = 12;
// Gap between group spans in the tool row (and between controls in a group).
export const ROW_GAP = 2;
// Toolbar root height. Exported so the editor shell can reserve the same space
// before the toolbar mounts.
export const TOOLBAR_HEIGHT = 44;
export const groupSpan = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: ROW_GAP,
  flex: '0 0 auto'
};

export const iconBtn = (active = false, disabled = false) => ({
  display: 'flex',
  height: 32,
  width: 32,
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 6,
  border: 'none',
  background: active ? ZINC[200] : 'transparent',
  color: active ? ZINC[900] : ZINC[700],
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.4 : 1,
  transition: 'background 0.12s',
  '&:hover': disabled ? {} : { background: active ? ZINC[200] : ZINC[100] }
});

export const triggerBtn = {
  display: 'flex',
  height: 32,
  alignItems: 'center',
  gap: 4,
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  padding: '0 8px',
  fontSize: 14,
  color: ZINC[700],
  cursor: 'pointer',
  transition: 'background 0.12s',
  '&:hover': { background: ZINC[100] }
};

// Panels render in a portal on document.body with fixed positioning (anchored
// to the trigger). Absolute panels inside the toolbar get clipped by the tool
// row's overflow:hidden, and their autoFocus inputs then force-scroll that
// hidden container (breaking the whole row).
export const menuPanel = (align: 'start' | 'center' | 'end') => ({
  position: 'fixed' as const,
  transform:
    align === 'center'
      ? 'translateX(-50%)'
      : align === 'end'
      ? 'translateX(-100%)'
      : 'none',
  minWidth: 160,
  background: '#fff',
  border: `1px solid ${ZINC[200]}`,
  borderRadius: 8,
  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
  padding: 4,
  maxWidth: 'calc(100vw - 16px)',
  zIndex: 10000
});

export const menuItem = (active = false) => ({
  display: 'flex',
  width: '100%',
  alignItems: 'center',
  gap: 8,
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 14,
  textAlign: 'left' as const,
  border: 'none',
  background: active ? ZINC[200] : 'transparent',
  color: ZINC[700],
  cursor: 'pointer',
  '&:hover': { background: ZINC[100] }
});

export const textInput = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box' as const,
  borderRadius: 8,
  border: `1px solid ${ZINC[300]}`,
  background: '#fff',
  padding: '8px 12px',
  fontSize: 14,
  color: ZINC[900],
  outline: 'none',
  '&::placeholder': { color: ZINC[400] },
  '&:focus': {
    borderColor: FEATHERY_RED,
    boxShadow: `0 0 0 1px ${FEATHERY_RED}`
  }
};

// Secondary action button (Download) pinned in the toolbar's right region.
export const downloadBtn = {
  display: 'flex',
  height: 32,
  alignItems: 'center',
  gap: 6,
  borderRadius: 6,
  border: `1px solid ${ZINC[300]}`,
  background: '#fff',
  padding: '0 10px',
  fontSize: 14,
  fontWeight: 500,
  color: ZINC[700],
  cursor: 'pointer',
  '&:hover': { background: ZINC[50] }
};

// Primary (red) terminal-action button: Download / Sign.
export const terminalBtn = (disabled = false) => ({
  display: 'flex',
  height: 32,
  alignItems: 'center',
  gap: 6,
  borderRadius: 6,
  border: 'none',
  background: FEATHERY_RED,
  padding: '0 10px',
  fontSize: 14,
  fontWeight: 500,
  color: '#fff',
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.5 : 1,
  '&:hover': disabled ? {} : { background: FEATHERY_RED_HOVER }
});
