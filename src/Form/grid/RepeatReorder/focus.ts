/**
 * Focus handoff between rows.
 *
 * A repeat row's React key is positional, so the handle that started a move is
 * not the one that should end up focused. Reaching across to the destination
 * node races React's commit, so the mover leaves a claim instead and the
 * destination row takes focus itself on the render that follows.
 *
 * The claim is scoped to one track, not to a bare index. A move rerenders the
 * whole form, so every mounted handle re-checks the claim on that render: with
 * two reorderable containers on a step, an index-only claim was consumed by
 * whichever container rendered first, and focus landed in the container that
 * had not moved.
 */
let pending: { trackId: string; index: number } | null = null;

export function requestRowFocus(trackId: string, index: number) {
  pending = { trackId, index };
}

/** True once, for the row in the track the claim was left for. */
export function consumeRowFocus(trackId: string, index: number) {
  if (!pending) return false;
  if (pending.trackId !== trackId || pending.index !== index) return false;
  pending = null;
  return true;
}

/**
 * Puts focus on a handle without letting the browser scroll to it.
 *
 * The handle lives in a gutter OUTSIDE the row's box, so bringing it into view
 * moves the page - on a long form that reads as the page jumping away from
 * what you were doing. Scrolling is done afterwards, and only by the minimum
 * needed, so a row stepped off the edge of the screen still comes back into
 * view without the page lurching.
 */
export function focusHandle(handle: HTMLElement | null) {
  if (!handle) return;
  handle.focus({ preventScroll: true });

  const rect = handle.getBoundingClientRect();
  const win = handle.ownerDocument.defaultView;
  if (!win) return;

  const offScreen =
    rect.bottom < 0 ||
    rect.right < 0 ||
    rect.top > win.innerHeight ||
    rect.left > win.innerWidth;
  if (offScreen) handle.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
