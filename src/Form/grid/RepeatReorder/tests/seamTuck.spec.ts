/**
 * How much room the leading seam has above it.
 *
 * The seam straddles the row's top edge, so it needs half a target of
 * scrollback to hang into. A container flush with the top of its scroller has
 * none, and that half of the button then sits above the scroll origin where no
 * amount of scrolling will bring it back - it is unclickable, not merely
 * clipped.
 *
 * The measurement has to be in the scroller's own coordinates rather than the
 * viewport's. Viewport distance changes as the page scrolls, so chrome keyed
 * to it would move under the pointer while the user scrolls; the two scrolled
 * cases below are what pin that down.
 */
import { spaceAboveRow } from '../index';
import { TARGET_SIZE } from '../styles';

const rect = (top: number) =>
  ({ top, bottom: top + 100, left: 0, right: 200, width: 200, height: 100 } as DOMRect);

const setScrollY = (value: number) =>
  Object.defineProperty(window, 'scrollY', { value, configurable: true });

/** A row under an ancestor that scrolls it, or under the document if omitted. */
const buildRow = (
  rowTop: number,
  scroller?: { top: number; scrollTop: number; overflowY: string }
) => {
  const row = document.createElement('div');
  row.getBoundingClientRect = () => rect(rowTop);

  if (!scroller) {
    document.body.appendChild(row);
    return row;
  }

  const parent = document.createElement('div');
  parent.getBoundingClientRect = () => rect(scroller.top);
  parent.style.overflowY = scroller.overflowY;
  Object.defineProperty(parent, 'scrollTop', { value: scroller.scrollTop });
  parent.appendChild(row);
  document.body.appendChild(parent);
  return row;
};

describe('spaceAboveRow', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    setScrollY(0);
  });

  describe('scrolled by the document', () => {
    it('reports nothing above a row flush with the top of the page', () => {
      expect(spaceAboveRow(buildRow(0))).toBe(0);
    });

    it('is below the half target that the seam needs to hang into', () => {
      expect(spaceAboveRow(buildRow(0))).toBeLessThan(TARGET_SIZE / 2);
    });

    it('reports the full offset for a row further down the page', () => {
      expect(spaceAboveRow(buildRow(200))).toBe(200);
    });

    it('is unchanged by scrolling, so the seam does not move under the pointer', () => {
      setScrollY(300);
      // Same row as the case above, now scrolled past: the viewport distance is
      // -100 but the distance within the document is still 200.
      expect(spaceAboveRow(buildRow(-100))).toBe(200);
    });
  });

  describe('scrolled by an ancestor', () => {
    const scroller = (scrollTop: number) => ({
      top: 50,
      scrollTop,
      overflowY: 'auto'
    });

    it('measures from the scroller, not the page', () => {
      // The row sits 50px down the viewport only because the scroller does.
      // Within the scroller it is at the very top.
      expect(spaceAboveRow(buildRow(50, scroller(0)))).toBe(0);
    });

    it('counts what has already been scrolled past', () => {
      expect(spaceAboveRow(buildRow(50, scroller(400)))).toBe(400);
    });

    it('ignores an ancestor that does not scroll', () => {
      setScrollY(0);
      const row = buildRow(
        120,
        { top: 50, scrollTop: 400, overflowY: 'visible' }
      );
      // overflowY is visible, so the scrollTop above is not a scroll position
      // this row sits inside - the document is what moves it.
      expect(spaceAboveRow(row)).toBe(120);
    });
  });
});
