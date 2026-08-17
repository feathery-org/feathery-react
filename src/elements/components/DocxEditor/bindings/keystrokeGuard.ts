// Make a typed character land in the right place, and stop it if the field
// cannot hold it.
//
// Three jobs, in this order, on the way to editorModule.handleTextInput:
//
//   1. ROUTE. A content control's boundary markers occupy caret offsets, and a
//      caret parked on one is OUTSIDE the control even though it looks like it is
//      in the cell. Typing there appends a sibling inline after the control:
//      visible to the reader, invisible to the engine, so the value never
//      changes and no total recalculates. Reachable by clicking past the text,
//      by arrowing one step too far, and - before the adapter's anchored restore
//      - by a normalization that shrank the control under a stationary caret.
//      The character is worth more than the caret position, so pull the caret
//      inside first. See controlGeometry for the offset model this relies on.
//   2. GUARD. Characters a value can never contain (a letter in a currency
//      field) are swallowed before they reach the document.
//   3. UNTRACK. User typing is never a tracked change. SyncFusion has one
//      global enableTrackChanges switch; Assist turns it on for a synchronous
//      batch and the host forces it off afterwards, but a leftover true still
//      authors content-control keystrokes as revisions. Disable it here, on
//      the only path printable characters take into a bound field.
//
// Routing before guarding is what makes the guard reach: on a boundary offset
// the editor reports the enclosing [[table=...]] marker rather than the field,
// so the old order let a letter into a number cell whenever the caret sat one
// step outside.
//
// Printable text does not travel through keyDown - that event's isHandled only
// covers shortcuts. It arrives from the hidden editable div's textInput event, so
// handleTextInput is what gets wrapped. Free-text fields and ordinary prose are
// never restricted.
//
// This is a convenience, not the enforcement mechanism: paste and every other
// input path this cannot see are still caught by the engine's invalid-input
// diagnostic on the next reconcile. Failing open is therefore always preferable
// to breaking typing, which is why every step is guarded and every failure
// simply passes the keystroke through.
//
// Correcting an earlier note in this file: selection.currentContentControl does
// report the inline field when the caret is genuinely inside it. It reports the
// enclosing wrapper only on the boundary offsets - which is precisely the case
// step 1 now removes.

import { disableUserTrackChanges } from '../../../../utils/documentEditorPrimitives';
import { parseTag } from './core/tagDsl';
import { snapOffsetForCaret } from './controlGeometry';
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

/**
 * Move a caret resting on a bound control's boundary to just inside it. Returns
 * whether it moved. Safe to call on every keystroke: it does nothing unless the
 * caret is collapsed and sitting exactly one offset outside a binding.
 */
export function snapCaretIntoControl(editor: SyncfusionEditorLike): boolean {
  try {
    const target = snapOffsetForCaret(editor);
    if (!target || !editor.selection?.select) return false;
    editor.selection.select(target, target);
    return true;
  } catch {
    return false;
  }
}

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
      if (typeof text === 'string' && text.length) {
        // Route first, so the guard below sees the field rather than whatever
        // encloses the boundary the caret was resting on.
        snapCaretIntoControl(editor);
        if (isBlockedInField(editor, text)) return undefined;
      }
    } catch {
      // Never let this break typing.
    }
    // Assist never types through handleTextInput; it uses insertText /
    // updateContentControl inside a batch that sets tracking itself. A leftover
    // true here is always a leak, so do not restore it.
    disableUserTrackChanges(editor as { enableTrackChanges: boolean });
    return bound(text);
  };

  return () => {
    editorModule.handleTextInput = original;
  };
}
