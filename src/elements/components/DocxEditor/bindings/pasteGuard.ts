// Paste into a bound field as plain text, as Word does for a plain-text content control

import { parseTag } from './core/tagDsl';
import { SyncfusionEditorLike } from './editorAdapter';

// Optimized SFDT shortens keys, so the document is recognised under both names
const SECTION_KEYS = ['sections', 'sec'];

function isInBoundControl(editor: SyncfusionEditorLike): boolean {
  const properties =
    editor.selection?.currentContentControl?.contentControlProperties;
  if (!properties) return false;
  const def = parseTag(String(properties.tag || ''));
  return !!def && (def.kind === 'field' || def.kind === 'formula');
}

const isDocument = (content: unknown): boolean =>
  !!content &&
  typeof content === 'object' &&
  SECTION_KEYS.some((key) => key in content);

// Vendored override, 34.1.31: pasteContents, where every paste ends, keeps rich
// content inside a plain-text content control, so paste the clipboard's plain text
export function installPasteGuard(editor: SyncfusionEditorLike): () => void {
  const editorModule = editor.editorModule;
  const original = editorModule?.pasteContents;
  const paste = editorModule?.paste;
  if (
    !editorModule ||
    typeof original !== 'function' ||
    typeof paste !== 'function'
  )
    return () => {};

  // A document handed to paste directly carries none of the clipboard's text
  let isHandedDocument = false;
  editorModule.paste = (sfdt: unknown, ...rest: unknown[]) => {
    isHandedDocument = sfdt != null;
    try {
      return paste.call(editorModule, sfdt, ...rest);
    } finally {
      isHandedDocument = false;
    }
  };
  editorModule.pasteContents = (content: unknown, ...rest: unknown[]) => {
    let pasted = content;
    try {
      if (!isHandedDocument && isDocument(content) && isInBoundControl(editor))
        pasted = String(editorModule.copiedTextContent ?? '').replace(
          /[\r\n]+/g,
          ''
        );
    } catch {
      pasted = content;
    }
    return original.call(editorModule, pasted, ...rest);
  };

  return () => {
    Object.assign(editorModule, { pasteContents: original, paste });
  };
}
