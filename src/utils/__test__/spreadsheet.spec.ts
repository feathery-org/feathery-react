import {
  parseCSV,
  normalizeSpreadsheet,
  buildMappedRows,
  coerceToHubType,
  isSpreadsheetFile,
  collectVisibleSheets,
  parseWorkbook
} from '../spreadsheet';

describe('parseCSV', () => {
  it('parses rows and handles quoted values with commas', () => {
    const csv = 'First Name,Note\nHenry,"Hello, world"\nJane,plain';
    expect(parseCSV(csv)).toEqual([
      ['First Name', 'Note'],
      ['Henry', 'Hello, world'],
      ['Jane', 'plain']
    ]);
  });

  it('handles escaped quotes and CRLF line endings', () => {
    const csv = 'a,b\r\n"say ""hi""",2';
    expect(parseCSV(csv)).toEqual([
      ['a', 'b'],
      ['say "hi"', '2']
    ]);
  });
});

describe('normalizeSpreadsheet', () => {
  it('trims headers, fills blank headers, and drops empty rows', () => {
    const parsed = [
      [' First Name ', ''],
      ['Henry', 'x'],
      ['', ''], // empty row dropped
      ['Jane', 'y']
    ];
    expect(normalizeSpreadsheet(parsed)).toEqual({
      headers: ['First Name', 'Column 2'],
      rows: [
        ['Henry', 'x'],
        ['Jane', 'y']
      ]
    });
  });

  it('returns empty structure for empty input', () => {
    expect(normalizeSpreadsheet([])).toEqual({ headers: [], rows: [] });
  });

  it('drops columns that are blank in every data row', () => {
    const parsed = [
      ['First Name', 'Middle Name', 'Email'],
      ['Henry', '', 'henry@test.com'],
      ['Jane', '   ', 'jane@test.com']
    ];
    // "Middle Name" is blank in all rows -> dropped, indices realigned
    expect(normalizeSpreadsheet(parsed)).toEqual({
      headers: ['First Name', 'Email'],
      rows: [
        ['Henry', 'henry@test.com'],
        ['Jane', 'jane@test.com']
      ]
    });
  });

  it('keeps a column that is blank early but has a value in a later row', () => {
    const parsed = [
      ['A', 'Sparse'],
      ['1', ''],
      ['2', ''],
      ['3', 'finally']
    ];
    const result = normalizeSpreadsheet(parsed);
    expect(result.headers).toEqual(['A', 'Sparse']);
    expect(result.rows).toEqual([
      ['1', ''],
      ['2', ''],
      ['3', 'finally']
    ]);
  });
});

describe('parseCSV BOM handling', () => {
  it('strips a UTF-8 BOM so the first header matches exactly', () => {
    const csv = '﻿' + 'First Name,Email\nHenry,h@x.com';
    expect(parseCSV(csv)[0]).toEqual(['First Name', 'Email']);
  });
});

describe('coerceToHubType', () => {
  it('coerces numbers and booleans, passes through text', () => {
    expect(coerceToHubType('42.5', 'number')).toBe(42.5);
    expect(coerceToHubType('true', 'boolean')).toBe(true);
    expect(coerceToHubType('No', 'boolean')).toBe(false);
    expect(coerceToHubType('hello', 'text')).toBe('hello');
  });

  it('keeps uncoercible values as strings so the server flags them', () => {
    expect(coerceToHubType('abc', 'number')).toBe('abc');
    expect(coerceToHubType('maybe', 'boolean')).toBe('maybe');
  });

  it('maps empty strings to null', () => {
    expect(coerceToHubType('', 'number')).toBeNull();
    expect(coerceToHubType('  ', 'text')).toBeNull();
  });
});

describe('buildMappedRows', () => {
  const sheets = [
    {
      name: 'A',
      headers: ['Name', 'Email'],
      rows: [
        ['Henry', 'h@x.com'],
        ['Jane', 'j@x.com']
      ]
    },
    { name: 'B', headers: ['Age'], rows: [['30']] }
  ];
  const identity = (_k: string, raw: string) => raw;

  it('pulls each field from the sheet recorded in its mapping', () => {
    const rows = buildMappedRows(
      sheets,
      {
        name: { sheetIndex: 0, header: 'Name' },
        age: { sheetIndex: 1, header: 'Age' }
      },
      identity
    );
    expect(rows).toEqual([
      { name: 'Henry', age: '30' },
      { name: 'Jane' } // sheet B has fewer rows: field omitted, not blank
    ]);
  });

  it('skips mappings whose header no longer exists on their sheet', () => {
    const rows = buildMappedRows(
      sheets,
      { gone: { sheetIndex: 0, header: 'Missing' } },
      identity
    );
    expect(rows).toEqual([]);
  });

  it('applies the coercer per field', () => {
    const rows = buildMappedRows(
      sheets,
      { age: { sheetIndex: 1, header: 'Age' } },
      (_k, raw) => Number(raw)
    );
    expect(rows).toEqual([{ age: 30 }]);
  });
});

describe('collectVisibleSheets', () => {
  // Minimal fake xlsx workbook with one hidden sheet.
  const workbook = {
    SheetNames: ['People', 'Hidden', 'Notes'],
    Workbook: { Sheets: [{ Hidden: 0 }, { Hidden: 1 }, {}] },
    Sheets: { People: 'P', Hidden: 'H', Notes: 'N' }
  };
  const sheetToRows = (sheet: any): any[][] => {
    if (sheet === 'P') return [['Name'], ['Henry', 42]];
    if (sheet === 'N') return [['Note'], ['hi']];
    return [['secret']];
  };

  it('skips hidden sheets and stringifies all cells', () => {
    const sheets = collectVisibleSheets(workbook, sheetToRows);
    expect(sheets.map((s) => s.name)).toEqual(['People', 'Notes']);
    expect(sheets[0].rows).toEqual([['Name'], ['Henry', '42']]);
  });
});

describe('parseWorkbook (CSV)', () => {
  it('returns a single implicit sheet for CSV files', async () => {
    const file = new File(['a,b\n1,2'], 'data.csv', { type: 'text/csv' });
    const sheets = await parseWorkbook(file);
    expect(sheets).toEqual([
      {
        name: 'Sheet1',
        rows: [
          ['a', 'b'],
          ['1', '2']
        ]
      }
    ]);
  });
});

describe('isSpreadsheetFile', () => {
  it('recognizes csv and excel extensions, rejects others', () => {
    expect(isSpreadsheetFile(new File([''], 'a.csv'))).toBe(true);
    expect(isSpreadsheetFile(new File([''], 'a.xlsx'))).toBe(true);
    expect(isSpreadsheetFile(new File([''], 'a.XLS'))).toBe(true);
    expect(isSpreadsheetFile(new File([''], 'a.pdf'))).toBe(false);
    expect(isSpreadsheetFile(new File([''], 'noext'))).toBe(false);
  });
});
