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
import {
  DRAGGING_ATTR,
  GUTTER_WIDTH,
  LIFT_Z_INDEX,
  clusterInsideHorizontalStyles,
  clusterInsideStyles,
  clusterStyles,
  clusterStylesHorizontal,
  insertStyles,
  INSERT_CLASS,
  KEYBOARD_FOCUS_ATTR,
  REORDER_CLASS,
  TARGET_SIZE,
  rowRevealStyles
} from '../styles';

const selectorsFor = (className: string) =>
  Object.keys(rowRevealStyles).filter((selector) =>
    selector.includes(className)
  );

/** The rules that light the seam, as opposed to the one that withholds it. */
const seamRevealSelectors = () =>
  selectorsFor(INSERT_CLASS).filter(
    (selector) => !selector.includes(DRAGGING_ATTR)
  );

describe('rowRevealStyles', () => {
  it('gives every cluster the same surface, whichever way the track runs', () => {
    // A handle that looks like a different control depending on the track's
    // direction is two controls to learn instead of one.
    const surfaced = [
      clusterStyles,
      clusterStylesHorizontal,
      clusterInsideStyles,
      clusterInsideHorizontalStyles
    ];
    for (const variant of surfaced) {
      expect(variant.borderRadius).toBe(clusterStyles.borderRadius);
      expect(variant.background).toBe(clusterStyles.background);
      expect(variant.border).toBe('1px solid');
    }
  });

  it('keeps both hover bridges under the chrome they reveal', () => {
    // `::after` paints as the row's last child, so without a stacking order of
    // its own the cluster sits beneath it and every control is unclickable.
    // The seam already carried one; the cluster now does too.
    expect(clusterStyles.zIndex).toBeGreaterThan(0);
    expect(insertStyles.zIndex).toBeGreaterThan(clusterStyles.zIndex);
    expect(LIFT_Z_INDEX).toBeGreaterThan(insertStyles.zIndex as number);
  });

  it('extends the row hit area across the gutter, so the hover holds', () => {
    // The buttons stop a few pixels short of the row's edge. Without this the
    // pointer crossed ground that belonged to neither on its way to the `+`,
    // and the seam faded out and back in.
    const bridge = (rowRevealStyles as any)['&::before'];
    expect(bridge).toMatchObject({ position: 'absolute', content: '""' });
    // Covers the gutter with half a target of slack past the buttons, so a
    // pointer drifting outward along the column stays on the row.
    const reach = GUTTER_WIDTH + TARGET_SIZE / 2;
    expect(bridge.insetInlineStart).toBe(`-${reach}px`);
    expect(bridge.width).toBe(`${reach}px`);
    // Reaches down as far as the bottom seam does, and no further up: the row
    // above owns that gap.
    expect(bridge.insetBlockEnd).toBe(`-${TARGET_SIZE / 2}px`);
    expect(bridge.insetBlockStart).toBe(0);
  });

  it('reveals the seam on hover and nothing else', () => {
    const [selector, ...rest] = seamRevealSelectors();

    expect(rest).toHaveLength(0);
    expect(selector).toContain(':hover');
    // Only one row can be hovered, which is what keeps the seam unique.
    expect(selector).not.toContain(':focus-within');
  });

  it('withholds the seam while a drag is live, hover or not', () => {
    const dragRules = selectorsFor(INSERT_CLASS).filter((selector) =>
      selector.includes(DRAGGING_ATTR)
    );

    expect(dragRules).toHaveLength(1);
    // Both spelled out, so the rule wins on specificity rather than on order.
    expect(dragRules[0]).toContain(`[${DRAGGING_ATTR}] .${INSERT_CLASS}`);
    expect(dragRules[0]).toContain(`[${DRAGGING_ATTR}]:hover .${INSERT_CLASS}`);
    expect((rowRevealStyles as any)[dragRules[0]]).toMatchObject({
      opacity: 0,
      pointerEvents: 'none'
    });
  });

  it('reveals the grip for the hovered row and for keyboard focus only', () => {
    const [selector, ...rest] = selectorsFor(REORDER_CLASS);

    expect(rest).toHaveLength(0);
    expect(selector).toContain(':hover');
    expect(selector).toContain(`[${KEYBOARD_FOCUS_ATTR}]`);
    // A pointer click leaves focus on the grip too. Plain `:focus-within` kept
    // that row lit after the pointer had moved on, so hovering any other row
    // showed two toolbars.
    expect(selector).not.toContain(':focus-within');
  });
});
