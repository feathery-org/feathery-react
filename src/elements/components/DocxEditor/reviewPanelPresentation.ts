import { useEffect, useRef } from 'react';
import { PanelTab } from './DocumentPanel';

export type ActivePanel = PanelTab | null;

/**
 * THE LAW: the review surface follows what the DOCUMENT holds.
 *
 * A pending tracked-change group is not a thing the user opted into looking at;
 * it is a decision the document is waiting on. So when the document goes from
 * holding no pending edits to holding some, the changes panel is what the
 * screen shows - the same reading the engine's settle logic takes, which asks
 * the document rather than any record of what the user last clicked.
 *
 * ONLY HALF OF THIS RULE EXISTED, and the missing half was captain-blocking.
 * The closing half - resolve them all and the panel closes - was an inline
 * effect in the editor host. The opening half was nowhere, so the panel stayed
 * wherever the user had left it. Measured in the captain's own browser on
 * 2026-09-09: a split landed with 41 pending edits in one group, the rail built
 * the card correctly with its Accept all / Accept 41 buttons, and every one of
 * them sat under an ancestor the panel wrapper had set to `display: none`
 * because the panel was showing Sections. The assistant said the split was
 * done, the document held the change, and the captain had no way to see or
 * resolve it.
 *
 * Both halves live here now, because they are one rule about one piece of
 * state, and a rule split across a present half and an absent half is how the
 * absent half stayed missing.
 *
 * RISING EDGE ONLY, so this never fights the user. It presents the panel on the
 * transition from zero, not while a count is merely non-zero: someone who
 * closes the panel, or switches to Sections, with edits still pending has said
 * where they want to be, and the next render must not drag them back. A new
 * change set arriving is a new transition, and that speaks again.
 */
export function nextActivePanel(input: {
  activePanel: ActivePanel;
  /** Pending count at the previous evaluation. */
  previousCount: number;
  /** Pending count now. */
  count: number;
  /** Whether reviewing is on at all; the panel is not offered when it is not. */
  reviewChanges: boolean;
}): ActivePanel | undefined {
  const { activePanel, previousCount, count, reviewChanges } = input;
  // Nothing pending and the changes panel is open: the empty slot would linger.
  if (activePanel === 'changes' && count === 0) return null;
  if (!reviewChanges) return undefined;
  // The rising edge from zero: a change set just arrived and owes a decision.
  if (previousCount === 0 && count > 0 && activePanel !== 'changes')
    return 'changes';
  return undefined;
}

/**
 * Applies `nextActivePanel` across renders, remembering the previous count.
 *
 * The ref is the "previous" half of the rising edge and is updated on every
 * evaluation, so a count that grows while the panel is already showing changes
 * (more edits in the same review) is not a fresh transition.
 */
export function useReviewPanelPresentation(input: {
  activePanel: ActivePanel;
  count: number;
  reviewChanges: boolean;
  setActivePanel: (panel: ActivePanel) => void;
}): void {
  const { activePanel, count, reviewChanges, setActivePanel } = input;
  const previousCount = useRef(0);
  useEffect(() => {
    const next = nextActivePanel({
      activePanel,
      previousCount: previousCount.current,
      count,
      reviewChanges
    });
    previousCount.current = count;
    if (next !== undefined && next !== activePanel) setActivePanel(next);
  }, [activePanel, count, reviewChanges, setActivePanel]);
}
