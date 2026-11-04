export const DEFAULT_DOWNLOAD_NAME = 'document';

// Characters Windows/macOS reject in file names, plus control characters.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

// Download base name (no extension) from an envelope's file URL, whose last
// path segment is the backend's filled template name.
export function downloadBaseName(fileUrl?: string | null): string {
  if (!fileUrl) return DEFAULT_DOWNLOAD_NAME;
  const segment = fileUrl.split(/[?#]/)[0].split('/').pop() ?? '';
  let name: string;
  try {
    name = decodeURIComponent(segment);
  } catch {
    return DEFAULT_DOWNLOAD_NAME;
  }
  const base = name
    .replace(/\.[^.]+$/, '')
    .replace(UNSAFE_CHARS, '_')
    .trim();
  return base || DEFAULT_DOWNLOAD_NAME;
}
