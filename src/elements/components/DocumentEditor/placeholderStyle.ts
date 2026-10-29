// One placeholder box shared by the document-editor host and the editors it
// mounts, so loading-state handoffs are pixel-identical (no visible swap).
export const EDITOR_PLACEHOLDER_STYLE = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
  padding: 16,
  textAlign: 'center' as const,
  border: '1px dashed #d4d4d8',
  borderRadius: 8,
  color: '#71717a',
  fontSize: 14
};

export const EDITOR_PLACEHOLDER_ERROR_COLOR = '#dc2626';
