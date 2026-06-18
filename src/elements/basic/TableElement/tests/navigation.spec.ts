import { getNextEditableCell } from '../utils';

// Three visible rows (data indices not necessarily contiguous), 2 columns.
const ROWS = [0, 1, 2];
const COLS = 2;

describe('getNextEditableCell - forward (Tab)', () => {
  it('moves to the next column in the same row', () => {
    expect(
      getNextEditableCell(ROWS, COLS, { rowIndex: 0, colIndex: 0 }, false)
    ).toEqual({ rowIndex: 0, colIndex: 1 });
  });

  it('wraps to the first column of the next row at the row end', () => {
    expect(
      getNextEditableCell(ROWS, COLS, { rowIndex: 0, colIndex: 1 }, false)
    ).toEqual({ rowIndex: 1, colIndex: 0 });
  });

  it('returns null past the last editable cell', () => {
    expect(
      getNextEditableCell(ROWS, COLS, { rowIndex: 2, colIndex: 1 }, false)
    ).toBeNull();
  });
});

describe('getNextEditableCell - backward (Shift+Tab)', () => {
  it('moves to the previous column in the same row', () => {
    expect(
      getNextEditableCell(ROWS, COLS, { rowIndex: 1, colIndex: 1 }, true)
    ).toEqual({ rowIndex: 1, colIndex: 0 });
  });

  it('wraps to the last column of the previous row at the row start', () => {
    expect(
      getNextEditableCell(ROWS, COLS, { rowIndex: 1, colIndex: 0 }, true)
    ).toEqual({ rowIndex: 0, colIndex: 1 });
  });

  it('returns null before the first editable cell', () => {
    expect(
      getNextEditableCell(ROWS, COLS, { rowIndex: 0, colIndex: 0 }, true)
    ).toBeNull();
  });
});

describe('getNextEditableCell - edge cases', () => {
  it('navigates by visible-row order, not raw row index', () => {
    const rows = [5, 2, 8];
    expect(
      getNextEditableCell(rows, 1, { rowIndex: 5, colIndex: 0 }, false)
    ).toEqual({ rowIndex: 2, colIndex: 0 });
  });

  it('returns null for an unknown current row', () => {
    expect(
      getNextEditableCell(ROWS, COLS, { rowIndex: 99, colIndex: 0 }, false)
    ).toBeNull();
  });

  it('returns null when there are no columns', () => {
    expect(
      getNextEditableCell(ROWS, 0, { rowIndex: 0, colIndex: 0 }, false)
    ).toBeNull();
  });
});
