// Paste into a bound field as plain text, as Word does for a plain-text content control

import { parseTag } from './core/tagDsl';
import { SyncfusionEditorLike } from './editorAdapter';

// Optimized SFDT shortens keys, so each property is read under both names
const TEXT_KEYS = ['text', 'tlp'];
const CONTROL_KEYS = ['contentControlProperties', 'ccp'];

function isInBoundControl(editor: SyncfusionEditorLike): boolean {
  const properties =
    editor.selection?.currentContentControl?.contentControlProperties;
  if (!properties) return false;
  const def = parseTag(String(properties.tag || ''));
  return !!def && (def.kind === 'field' || def.kind === 'formula');
}

/** The text a pasted SFDT document carries, in document order */
export function pastedText(content: unknown): string {
  if (Array.isArray(content)) return content.map(pastedText).join('');
  if (!content || typeof content !== 'object') return '';
  let out = '';
  for (const [key, value] of Object.entries(content)) {
    if (TEXT_KEYS.includes(key) && typeof value === 'string') out += value;
    else if (value && typeof value === 'object') out += pastedText(value);
  }
  return out;
}

function holdsControl(content: unknown): boolean {
  if (!content || typeof content !== 'object') return false;
  return Object.entries(content).some(
    ([key, value]) => CONTROL_KEYS.includes(key) || holdsControl(value)
  );
}

/** Wrap pasteContents, where every paste and drop ends, failing open; returns the undo */
export function installPasteGuard(editor: SyncfusionEditorLike): () => void {
  const editorModule = editor.editorModule;
  const original = editorModule?.pasteContents;
  if (!editorModule || typeof original !== 'function') return () => {};

  editorModule.pasteContents = (content: unknown, ...rest: unknown[]) => {
    let pasted = content;
    try {
      if (holdsControl(content) && isInBoundControl(editor))
        pasted = pastedText(content);
    } catch {
      pasted = content;
    }
    return original.call(editorModule, pasted, ...rest);
  };

  return () => {
    editorModule.pasteContents = original;
  };
}
