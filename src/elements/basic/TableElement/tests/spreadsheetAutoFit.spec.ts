import { measureTextWidth } from '../spreadsheet/SpreadsheetGrid';
import {
  FONT_SIZE,
  GRID_FONT_FAMILY,
  HEADER_FONT_SIZE,
  HEADER_FONT_WEIGHT
} from '../spreadsheet/styles';

describe('auto-fit text measurement', () => {
  test('measures in the font the grid actually draws', () => {
    // Measuring at some other size fits the column to text it does not hold:
    // 11px Arial came out ~30% narrower than the 16px cells and truncated
    // the very content it was fitted to.
    const fonts: string[] = [];
    const context = {
      set font(value: string) {
        fonts.push(value);
      },
      measureText: (text: string) => ({ width: text.length * 8 })
    };
    const spy = jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context as any);

    const cellWidth = measureTextWidth('Alice', {
      size: FONT_SIZE,
      weight: 400
    });
    measureTextWidth('Name', {
      size: HEADER_FONT_SIZE,
      weight: HEADER_FONT_WEIGHT
    });
    measureTextWidth('Styled', {
      size: 24,
      weight: 700,
      family: 'Georgia, serif'
    });
    spy.mockRestore();

    expect(cellWidth).toBe(40);
    expect(fonts).toEqual([
      `400 ${FONT_SIZE}px ${GRID_FONT_FAMILY}`,
      `${HEADER_FONT_WEIGHT} ${HEADER_FONT_SIZE}px ${GRID_FONT_FAMILY}`,
      '700 24px Georgia, serif'
    ]);
  });
});
