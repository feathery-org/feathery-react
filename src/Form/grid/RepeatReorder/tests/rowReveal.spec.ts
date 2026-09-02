/**
 * Which pseudo-classes reveal the row chrome.
 *
 * These are CSS rules, so jsdom cannot exercise them - `:hover` never resolves
 * from a synthetic pointer event. What is worth locking is the choice itself,
 * because reintroducing `:focus-within` on the seam is a one-word edit with a
 * visible consequence: the row being typed in and the row under the pointer
 * both light up, so two `+` appear at once. A row's "above" seam is the same
 * boundary as its predecessor's "below" seam, so the pair lands a few pixels
 * apart, each claiming to insert at the same place.
 */
import { INSERT_CLASS, REORDER_CLASS, rowRevealStyles } from '../styles';

const selectorsFor = (className: string) =>
  Object.keys(rowRevealStyles).filter((selector) =>
    selector.includes(className)
  );

describe('rowRevealStyles', () => {
  it('reveals the seam on hover and nothing else', () => {
    const [selector, ...rest] = selectorsFor(INSERT_CLASS);

    expect(rest).toHaveLength(0);
    expect(selector).toContain(':hover');
    // Only one row can be hovered, which is what keeps the seam unique.
    expect(selector).not.toContain(':focus-within');
  });

  it('still reveals the grip for the row being typed in', () => {
    const [selector] = selectorsFor(REORDER_CLASS);

    expect(selector).toContain(':hover');
    expect(selector).toContain(':focus-within');
  });
});
