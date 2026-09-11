import {
  DEFAULT_SPREADSHEET_GEOMETRY,
  readSpreadsheetGeometry
} from '../spreadsheet/geometry';
import { spreadsheetViewportHeight } from '../spreadsheet/styles';

const styles = (values: Record<string, string>) => ({
  getPropertyValue: (name: string) => values[name] ?? ''
});

describe('spreadsheet style geometry', () => {
  test('preserves the existing geometry when style properties are unset', () => {
    expect(readSpreadsheetGeometry(styles({}))).toEqual(
      DEFAULT_SPREADSHEET_GEOMETRY
    );
    expect(
      spreadsheetViewportHeight('fit', 2, DEFAULT_SPREADSHEET_GEOMETRY)
    ).toBe(100);
    expect(
      spreadsheetViewportHeight('px', 2, DEFAULT_SPREADSHEET_GEOMETRY)
    ).toBeUndefined();
  });

  test('expands rows and headers to fit their typography and vertical padding', () => {
    const geometry = readSpreadsheetGeometry(
      styles({
        '--feathery-table-font-size': '40px',
        '--feathery-table-header-font-size': '30px',
        '--feathery-table-row-height': '10px',
        '--feathery-table-header-height': '10px',
        '--feathery-table-cell-padding-vertical': '8px',
        '--feathery-table-cell-padding-horizontal': '12px',
        '--feathery-table-font-family': 'Georgia, serif',
        '--feathery-table-font-weight': '700'
      })
    );
    expect(geometry).toMatchObject({
      rowHeight: 66,
      headerHeight: 54,
      horizontalPadding: 12
    });
    expect(geometry.cellFont).toEqual({
      size: 40,
      weight: '700',
      family: 'Georgia, serif'
    });
    expect(spreadsheetViewportHeight('fit', 2, geometry)).toBe(188);
    expect(spreadsheetViewportHeight('fit', 1000, geometry)).toBe(400);
  });

  test('falls back for invalid lengths and keeps zero padding valid', () => {
    const geometry = readSpreadsheetGeometry(
      styles({
        '--feathery-table-row-height': '-3px',
        '--feathery-table-header-height': 'NaNpx',
        '--feathery-table-font-size': '0px',
        '--feathery-table-cell-padding-horizontal': '0px'
      })
    );
    expect(geometry.rowHeight).toBe(32);
    expect(geometry.headerHeight).toBe(34);
    expect(geometry.cellFont.size).toBe(16);
    expect(geometry.horizontalPadding).toBe(0);
  });
});
