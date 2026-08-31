/**
 * Focus handoff between rows.
 *
 * A move re-renders the whole container, and the React key for a repeat row is
 * positional - the DOM node at a slot is reused for whatever index lands there.
 * So the handle that started the move is not the handle that should end up
 * focused, and reaching across to the destination node right after the move
 * races React's commit: the browser resets focus to the body when the menu
 * unmounts, and no amount of frame-waiting is reliably after that.
 *
 * Instead the mover leaves a claim, and the destination row takes focus itself
 * on the render that follows.
 */
let pendingIndex: number | null = null;

export function requestRowFocus(index: number) {
  pendingIndex = index;
}

/** True once, for the row the claim was left for. */
export function consumeRowFocus(index: number) {
  if (pendingIndex !== index) return false;
  pendingIndex = null;
  return true;
}
