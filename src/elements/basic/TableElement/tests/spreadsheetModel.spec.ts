import {
  buildFillPatches,
  cellValuesEqual,
  escapeTsvValue,
  formatCellValue,
  getFillPreview,
  parseInputValue,
  parseTsv,
  serializeTsv
} from '../spreadsheet/model';
import type { CellValue, GridBounds } from '../spreadsheet/model';
import {
  FIT_MAX_HEIGHT,
  HEADER_HEIGHT,
  ROW_HEIGHT,
  spreadsheetViewportHeight
} from '../spreadsheet/styles';
import { tableContainment } from '../styles';

describe('parseInputValue', () => {
  test('keeps numeric text as a number so it round-trips as one', () => {
    expect(parseInputValue('42')).toBe(42);
    expect(parseInputValue(' -3.5 ')).toBe(-3.5);
    expect(parseInputValue('1e3')).toBe(1000);
  });

  test('recognizes booleans case-insensitively', () => {
    expect(parseInputValue('TRUE')).toBe(true);
    expect(parseInputValue('false')).toBe(false);
  });

  test('treats a blank entry as an empty cell', () => {
    expect(parseInputValue('')).toBeNull();
    expect(parseInputValue('   ')).toBeNull();
  });

  test('leaves anything else as the original string, untrimmed', () => {
    expect(parseInputValue(' Acme Corp ')).toBe(' Acme Corp ');
    // A leading zero is part of an identifier, not a number to normalize.
    expect(parseInputValue('007-A')).toBe('007-A');
  });
});

describe('cellValuesEqual', () => {
  test('treats null and empty string as the same blank cell', () => {
    // Both render blank, so committing one over the other is not an edit
    // worth sending to the backend.
    expect(cellValuesEqual(null, '')).toBe(true);
    expect(cellValuesEqual('', null)).toBe(true);
  });

  test('distinguishes a value from a blank', () => {
    expect(cellValuesEqual(0, null)).toBe(false);
    expect(cellValuesEqual(false, '')).toBe(false);
  });

  test('compares by value', () => {
    expect(cellValuesEqual(5, 5)).toBe(true);
    expect(cellValuesEqual(5, '5')).toBe(false);
  });
});

describe('formatCellValue', () => {
  test('renders booleans and blanks the way a spreadsheet does', () => {
    expect(formatCellValue(true)).toBe('TRUE');
    expect(formatCellValue(false)).toBe('FALSE');
    expect(formatCellValue(null)).toBe('');
  });
});

describe('clipboard serialization', () => {
  test('neutralizes values that would become formulas in Excel', () => {
    expect(escapeTsvValue('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(escapeTsvValue('+1')).toBe("'+1");
    expect(escapeTsvValue('@import')).toBe("'@import");
    expect(escapeTsvValue('-5')).toBe("'-5");
  });

  test('does not quote a negative NUMBER, which cannot execute', () => {
    expect(escapeTsvValue(-5)).toBe('-5');
  });

  test('quotes values containing tabs, quotes or newlines', () => {
    expect(escapeTsvValue('a\tb')).toBe('"a\tb"');
    expect(escapeTsvValue('say "hi"')).toBe('"say ""hi"""');
  });

  test('round-trips a grid through TSV', () => {
    const grid: CellValue[][] = [
      ['Acme', 120, true],
      ['say "hi"', null, 'multi\nline']
    ];

    const parsed = parseTsv(serializeTsv([grid]));

    expect(parsed).toEqual([
      ['Acme', '120', 'TRUE'],
      ['say "hi"', '', 'multi\nline']
    ]);
  });

  test('a trailing newline does not produce a phantom row', () => {
    expect(parseTsv('a\tb\n')).toEqual([['a', 'b']]);
  });
});

describe('getFillPreview', () => {
  const source: GridBounds = {
    minRowIndex: 1,
    maxRowIndex: 2,
    minColumnIndex: 1,
    maxColumnIndex: 1
  };

  test('returns nothing while the pointer is still inside the source', () => {
    expect(getFillPreview(source, { rowIndex: 2, columnIndex: 1 })).toBeNull();
  });

  test('commits to the axis the pointer travelled furthest along', () => {
    const down = getFillPreview(source, { rowIndex: 6, columnIndex: 2 });
    expect(down?.direction).toBe('down');
    expect(down?.destination).toEqual({
      minRowIndex: 3,
      maxRowIndex: 6,
      minColumnIndex: 1,
      maxColumnIndex: 1
    });

    const right = getFillPreview(source, { rowIndex: 2, columnIndex: 5 });
    expect(right?.direction).toBe('right');
  });

  test('fills upward when dragged above the source', () => {
    const up = getFillPreview(source, { rowIndex: 0, columnIndex: 1 });
    expect(up?.direction).toBe('up');
    expect(up?.destination.maxRowIndex).toBe(0);
    expect(up?.expanded.minRowIndex).toBe(0);
  });
});

describe('buildFillPatches', () => {
  const fieldKeys = ['a', 'b'];
  const rowIndices = [0, 1, 2, 3, 4];

  const fill = (values: Record<string, CellValue[]>, source: GridBounds) => {
    const getValue = (rowIndex: number, fieldKey: string) =>
      values[fieldKey]?.[rowIndex] ?? null;
    const preview = getFillPreview(source, { rowIndex: 4, columnIndex: 0 })!;
    return buildFillPatches({
      source,
      preview,
      rowIndices,
      fieldKeys,
      getValue
    });
  };

  test('extends a numeric run by its detected step', () => {
    const patches = fill({ a: [10, 20, null, null, null] }, {
      minRowIndex: 0,
      maxRowIndex: 1,
      minColumnIndex: 0,
      maxColumnIndex: 0
    });

    expect(patches.map((patch) => patch.after)).toEqual([30, 40, 50]);
  });

  test('extends an ISO date run by whole days', () => {
    const patches = fill({ a: ['2026-01-01', '2026-01-03', null, null, null] }, {
      minRowIndex: 0,
      maxRowIndex: 1,
      minColumnIndex: 0,
      maxColumnIndex: 0
    });

    expect(patches.map((patch) => patch.after)).toEqual([
      '2026-01-05',
      '2026-01-07',
      '2026-01-09'
    ]);
  });

  test('repeats the source block when no series can be inferred', () => {
    const patches = fill({ a: ['red', 'blue', null, null, null] }, {
      minRowIndex: 0,
      maxRowIndex: 1,
      minColumnIndex: 0,
      maxColumnIndex: 0
    });

    expect(patches.map((patch) => patch.after)).toEqual(['red', 'blue', 'red']);
  });

  test('a single source cell repeats rather than counting up', () => {
    const patches = fill({ a: [7, null, null, null, null] }, {
      minRowIndex: 0,
      maxRowIndex: 0,
      minColumnIndex: 0,
      maxColumnIndex: 0
    });

    expect(patches.map((patch) => patch.after)).toEqual([7, 7, 7, 7]);
  });

  test('skips cells whose value would not change', () => {
    const patches = fill({ a: [5, 5, 5, null, 5] }, {
      minRowIndex: 0,
      maxRowIndex: 1,
      minColumnIndex: 0,
      maxColumnIndex: 0
    });

    // Rows 2 and 4 already hold 5; only the blank row 3 is patched.
    expect(patches).toEqual([
      { rowIndex: 3, fieldKey: 'a', before: null, after: 5 }
    ]);
  });

  test('carries the previous value so the fill can be undone', () => {
    const patches = fill({ a: [1, 2, 'keep', null, null] }, {
      minRowIndex: 0,
      maxRowIndex: 1,
      minColumnIndex: 0,
      maxColumnIndex: 0
    });

    expect(patches[0]).toEqual({
      rowIndex: 2,
      fieldKey: 'a',
      before: 'keep',
      after: 3
    });
  });
});

describe('spreadsheetViewportHeight', () => {
  test('leaves a px height alone — the element sizes that container itself', () => {
    expect(spreadsheetViewportHeight('px', 10)).toBeUndefined();
  });

  test('still sizes a percent height, which the wrapper only caps', () => {
    // Verified in Chrome: with no definite height the grid's natural height is
    // the whole virtual canvas, and the element wrapper's
    // `min-height: fit-content` locks that in — a 60-row table rendered 1483px
    // tall and did not scroll. The value acts as a flex-basis, so a percentage
    // resolving taller than it still grows past it.
    expect(spreadsheetViewportHeight('%', 3)).toBe(
      HEADER_HEIGHT + 3 * ROW_HEIGHT + 2
    );
  });

  test('sizes a fit-height grid to its rows, plus the trailing gutter', () => {
    // Header, three rows, the gutter that keeps room under a scrolled-to cell
    // for its message bubble, and the container border.
    expect(spreadsheetViewportHeight('fit', 3)).toBe(
      HEADER_HEIGHT + 3 * ROW_HEIGHT + 2
    );
  });

  test('bounds a grid whose height was never set, so it is not left empty', () => {
    // The virtualizer measures its scroll container: an unbounded grid renders
    // no rows at all, so an element with no height style still gets one.
    expect(spreadsheetViewportHeight(undefined, 3)).toBe(
      HEADER_HEIGHT + 3 * ROW_HEIGHT + 2
    );
  });

  test('caps a very tall table so it scrolls instead of growing the page', () => {
    expect(spreadsheetViewportHeight('fit', 10_000)).toBe(FIT_MAX_HEIGHT);
  });

  test('an empty grid still reserves room for its header', () => {
    expect(spreadsheetViewportHeight('fit', 0)).toBe(
      HEADER_HEIGHT + 2
    );
  });
});

describe('tableContainment', () => {
  test('contains the width for every unit but fit', () => {
    // A scroll container still reports its content width to its ancestors;
    // measured in the designer canvas, a 1646px grid widened the whole step.
    for (const unit of ['px', '%', 'fill', undefined]) {
      expect(tableContainment(unit)).toEqual({ contain: 'inline-size' });
    }
  });

  test('a fit-width table keeps reporting its natural width', () => {
    expect(tableContainment('fit')).toEqual({});
  });
});
