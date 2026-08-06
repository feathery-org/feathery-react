/**
 * How the dynamic-blocks feature is switched on.
 *
 * Two sources, window key winning over localStorage:
 *   window.featheryDocxBlocks = { enabled, panel, debug, data, onDataChange }
 *   localStorage.featheryDocxBlocks = '{"enabled":true,"panel":true,...}'
 *
 * The window key exists for hosts that wire the feature programmatically
 * (including callbacks, which localStorage cannot carry). localStorage exists
 * for humans: set it once in the console and it survives reloads.
 */
export type DocxBlocksConfig = {
  enabled?: boolean;
  panel?: boolean;
  debug?: boolean;
  data?: unknown;
  onDataChange?: (data: unknown) => void;
};

export const docxBlocksConfig = (windowLike: any): DocxBlocksConfig => {
  const fromWindow = windowLike?.featheryDocxBlocks;
  if (fromWindow) return fromWindow;
  try {
    const raw = windowLike?.localStorage?.getItem('featheryDocxBlocks');
    return raw ? JSON.parse(raw) : {};
  } catch {
    // Sandboxed iframes throw on localStorage access; malformed JSON is a
    // user typo. Either way the feature just stays off.
    return {};
  }
};
