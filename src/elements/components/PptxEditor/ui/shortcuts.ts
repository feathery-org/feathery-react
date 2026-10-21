import { featheryWindow } from '../../../../utils/browser';

const isMac = (): boolean =>
  /Mac|iPhone|iPad/.test(featheryWindow().navigator?.platform ?? '');

/** Platform-aware shortcut label for tooltips, e.g. "⌘B" / "Ctrl+B". */
export function shortcutHint(key: string, shift = false): string {
  return isMac()
    ? `${shift ? '⇧' : ''}⌘${key}`
    : `Ctrl+${shift ? 'Shift+' : ''}${key}`;
}

/** "<label> (<hint>)" - the tooltip convention for shortcut-bearing controls. */
export function withShortcut(
  label: string,
  key: string,
  shift = false
): string {
  return `${label} (${shortcutHint(key, shift)})`;
}
