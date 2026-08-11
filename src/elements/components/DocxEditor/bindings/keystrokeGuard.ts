// Stop characters a typed field can never hold from entering it at all, so a
// letter cannot land in a number cell and wait to be diagnosed.
//
// Printable text does not travel through keyDown - that event's isHandled only
// covers shortcuts. It arrives at editorModule.handleTextInput from the hidden
// editable div's textInput event, so that method is wrapped. Free-text fields and
// ordinary prose are never restricted.
//
// This is a convenience, not the enforcement mechanism: paste and every other
// input path the guard cannot see are still caught by the engine's invalid-input
// diagnostic on the next reconcile. The guard failing open is therefore always
// preferable to the guard breaking typing, which is why every step is guarded.
//
// KNOWN LIMIT on Syncfusion 34.1.31, measured rather than assumed:
// selection.currentContentControl reports the ENCLOSING content control, so a
// caret inside a table wrapped by a [[table=...]] marker reports that wrapper,
// and a caret in a prose field reports nothing at all. Where the engine does not
// name an inline field, the guard cannot identify a type and lets the keystroke
// through - so today it restricts typed fields in UNWRAPPED tables and is inert
// elsewhere. That is why the reconcile diagnostic, not this, is what actually
// keeps a letter out of a number. Narrowing it further needs a caret-to-binding
// lookup built from the document index; see the commit-trigger module, which
// solves the sibling problem with selection.startOffset instead.

import { parseTag } from './core/tagDsl';
import { SyncfusionEditorLike } from './editorAdapter';

/** Characters each typed kind can legitimately contain while being typed. */
const TYPE_KEY_GUARD: Record<string, RegExp> = {
  integer: /^[0-9,\- ]+$/,
  decimal: /^[0-9.,\- ]+$/,
  currency: /^[0-9.,\-$€£ ]+$/,
  percent: /^[0-9.,\-% ]+$/,
  // The dash sits last so it is a literal, not a range, and needs no escape.
  date: /^[0-9-]+$/
};

export function isBlockedInField(
  editor: SyncfusionEditorLike,
  text: string
): boolean {
  const control = editor.selection?.currentContentControl;
  const properties = control && control.contentControlProperties;
  if (!properties) return false; // Free text is unrestricted.
  let def = null;
  try {
    def = parseTag(String(properties.tag || ''));
  } catch {
    return false; // A malformed tag is the engine's problem, not the guard's.
  }
  if (!def || def.kind !== 'field') return false;
  const allowed = TYPE_KEY_GUARD[def.fieldType.kind];
  return !!allowed && !allowed.test(text);
}

/**
 * Wrap handleTextInput. Returns a function that puts the original back, so the
 * patch does not outlive the editor instance it was installed on.
 */
export function installKeystrokeGuard(
  editor: SyncfusionEditorLike
): () => void {
  const editorModule = editor.editorModule;
  const original = editorModule?.handleTextInput;
  if (!editorModule || typeof original !== 'function') return () => {};

  const bound = original.bind(editorModule);
  editorModule.handleTextInput = (text: string) => {
    try {
      if (
        typeof text === 'string' &&
        text.length &&
        isBlockedInField(editor, text)
      )
        return undefined;
    } catch {
      // Never let the guard break typing.
    }
    return bound(text);
  };

  return () => {
    editorModule.handleTextInput = original;
  };
}
