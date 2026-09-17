/**
 * Whether the last thing the user did was press a key.
 *
 * The row chrome shows itself for the row under the pointer, and for the row
 * a keyboard user has reached - those are the two rows someone can be about to
 * act on. Focus alone cannot tell them apart: a pointer click on the grip
 * leaves focus on it too, and the chrome then stayed lit on a row the pointer
 * had long since left, so hovering any other row showed two toolbars.
 *
 * `:focus-visible` is the browser's own answer to this question, but the grip
 * takes focus from script after a prevented pointerdown, and browsers disagree
 * about whether that counts as keyboard. Tracking the modality directly makes
 * the answer the same everywhere.
 */
let keyboard = false;
let installed: Document | null = null;

const onKey = () => {
  keyboard = true;
};
const onPointer = () => {
  keyboard = false;
};

/** Idempotent per document: many handles, one pair of listeners. */
export function trackInputModality(doc: Document) {
  if (installed === doc) return;
  installed?.removeEventListener('keydown', onKey, true);
  installed?.removeEventListener('pointerdown', onPointer, true);
  installed = doc;
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('pointerdown', onPointer, true);
}

export const lastInputWasKeyboard = () => keyboard;

/** For tests, which share the module between cases. */
export function resetInputModality() {
  keyboard = false;
  installed?.removeEventListener('keydown', onKey, true);
  installed?.removeEventListener('pointerdown', onPointer, true);
  installed = null;
}
