export const color = {
  canvas: '#f4f5f8',
  surface: '#ffffff',
  surfaceHover: '#f3f4f6',
  border: '#e2e4eb',
  text: '#111827',
  textMuted: '#6b7280',
  accent: '#3b82f6',
  accentSoft: '#eff6ff',
  primary: '#0ac769',
  primaryHover: '#09b25e',
  errorText: '#b3261e',
  errorBg: '#fdecea',
  successText: '#067647',
  successBg: '#ecfdf3'
} as const;

export const radius = { sm: 6, md: 8, pill: 999 } as const;

export const shadow = {
  page: '0 1px 3px rgba(16, 24, 40, 0.1), 0 1px 2px rgba(16, 24, 40, 0.06)',
  drawer: '4px 0 12px rgba(0, 0, 0, 0.12)',
  menu: '0 4px 12px rgba(16, 24, 40, 0.14)'
} as const;

export const fontSize = { xs: 11, sm: 12, md: 13, base: 14, lg: 16 } as const;
