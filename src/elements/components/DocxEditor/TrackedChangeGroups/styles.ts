// Design tokens for the tracked-changes review rail (mockup light palette).
export const INK = '#171a1c';
export const INK_2 = '#464c50';
export const INK_3 = '#6b7276';
export const LINE = '#e0e4e6';
export const LINE_STRONG = '#c8cfd2';
export const PANEL = '#f8f9fa';
export const PANEL_2 = '#f1f3f4';
export const PANEL_3 = '#e6eaec';
export const PAPER = '#ffffff';
export const ADD = '#0e7a4d';
export const ADD_WASH = 'rgba(14, 122, 77, 0.11)';
export const DEL = '#b0302b';
export const DEL_WASH = 'rgba(176, 48, 43, 0.10)';
export const MOD = '#8a5a0e';
export const MOD_WASH = 'rgba(138, 90, 14, 0.13)';
export const ACCENT_LINE = 'rgba(43, 49, 52, 0.34)';
export const ACCENT_WASH = 'rgba(43, 49, 52, 0.07)';
export const MONO =
  '"SF Mono", ui-monospace, "JetBrains Mono", "Cascadia Mono", Menlo, Consolas, monospace';
export const CARD_SHADOW = '0 1px 2px rgba(23, 26, 28, 0.06)';

export const btn = {
  height: 27,
  flex: 1,
  border: `1px solid ${LINE_STRONG}`,
  borderRadius: 8,
  background: PAPER,
  color: INK_2,
  fontSize: 11.5,
  fontWeight: 550,
  cursor: 'pointer',
  padding: 0,
  whiteSpace: 'nowrap' as const,
  '&:hover': { background: PANEL_3, color: INK },
  '&:disabled': { opacity: 0.36, cursor: 'default' }
};

// Reject warms to red on hover; accept stays neutral (mockup behavior).
export const rejectBtn = {
  ...btn,
  '&:hover': { borderColor: '#d08984', color: DEL, background: DEL_WASH }
};
