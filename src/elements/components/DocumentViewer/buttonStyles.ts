import { color, radius, fontSize } from './tokens';

const baseButtonCss = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  border: '1px solid transparent',
  borderRadius: radius.md,
  fontSize: fontSize.base,
  fontWeight: 500,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  transition:
    'background-color 150ms ease, border-color 150ms ease, color 150ms ease',
  '&:focus-visible': {
    outline: `2px solid ${color.accent}`,
    outlineOffset: 2
  },
  '&:disabled': { opacity: 0.5, cursor: 'default' }
} as const;

export const primaryButtonCss = {
  ...baseButtonCss,
  padding: '8px 20px',
  minWidth: 120,
  backgroundColor: color.primary,
  color: 'white',
  '&:hover:not(:disabled)': { backgroundColor: color.primaryHover }
} as const;

export const secondaryButtonCss = {
  ...baseButtonCss,
  padding: '8px 14px',
  backgroundColor: color.surface,
  border: `1px solid ${color.border}`,
  color: color.text,
  '&:hover:not(:disabled)': { backgroundColor: color.surfaceHover }
} as const;

export const quietButtonCss = {
  ...baseButtonCss,
  padding: '8px 10px',
  backgroundColor: 'transparent',
  color: color.textMuted,
  '&:hover:not(:disabled)': {
    backgroundColor: color.surfaceHover,
    color: color.text
  }
} as const;

export const iconButtonCss = {
  ...quietButtonCss,
  padding: 6,
  borderRadius: radius.sm
} as const;
