/**
 * Focus handoff between rows.
 *
 * A repeat row's React key is positional, so the handle that started a move is
 * not the one that should end up focused. Reaching across to the destination
 * node races React's commit, so the mover leaves a claim instead and the
 * destination row takes focus itself on the render that follows.
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
