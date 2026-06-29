import {
  parseCSV,
  normalizeSpreadsheet,
  buildReversedFieldValues,
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

describe('buildReversedFieldValues', () => {
  const rows = [
    ['Henry', 'Osei', 'henry@test.com'],
    ['Jane', 'Doe', 'jane@test.com']
  ];

  it('collects each mapped field’s source column into an array', () => {
    const values = buildReversedFieldValues(rows, {
      first_name: 0,
      email_address: 2
    });
    expect(values).toEqual({
      first_name: ['Henry', 'Jane'],
      email_address: ['henry@test.com', 'jane@test.com']
    });
  });

  it('allows one column to feed multiple fields', () => {
    const values = buildReversedFieldValues(rows, {
      ssn_or_tax_id: 1,
      beneficiary_ssn: 1
    });
    expect(values).toEqual({
      ssn_or_tax_id: ['Osei', 'Doe'],
      beneficiary_ssn: ['Osei', 'Doe']
    });
  });

  it('skips unmapped fields and returns {} when there are no rows', () => {
    expect(buildReversedFieldValues([], { first_name: 0 })).toEqual({});
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
      { name: 'Sheet1', rows: [['a', 'b'], ['1', '2']] }
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
