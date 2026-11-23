import { placeCellTooltip } from '../spreadsheet/tooltipPlacement';

// A 32px row near the top of an 800px window, with a 44px bubble.
const base = { cellTop: 100, cellBottom: 132, tooltipHeight: 44, viewportHeight: 800 };

describe('placeCellTooltip', () => {
  test('sits below the cell when there is room, and moves nothing', () => {
    expect(placeCellTooltip(base)).toEqual({ above: false, scrollBy: 0 });
  });

  test('flips above when the bubble would fall off the bottom', () => {
    const placement = placeCellTooltip({
      ...base,
      cellTop: 740,
      cellBottom: 772
    });
    expect(placement.above).toBe(true);
    expect(placement.scrollBy).toBe(0);
  });

  // Stepping through issues can land on a cell at the very edge, where neither
  // side fits — then the page has to move rather than the bubble.
  test('scrolls the page down when neither side fits', () => {
    const placement = placeCellTooltip({
      cellTop: 20,
      cellBottom: 790,
      tooltipHeight: 44,
      viewportHeight: 800
    });
    expect(placement.above).toBe(false);
    expect(placement.scrollBy).toBeGreaterThan(0);
  });

  test('scrolls the page up when the cell is above the viewport', () => {
    const placement = placeCellTooltip({
      ...base,
      cellTop: -40,
      cellBottom: -8
    });
    expect(placement.scrollBy).toBeLessThan(0);
  });

  // The bubble must not swap sides on every step just because below is tight.
  test('stays below when below fits, even with room above', () => {
    expect(
      placeCellTooltip({ ...base, cellTop: 400, cellBottom: 432 }).above
    ).toBe(false);
  });
});
