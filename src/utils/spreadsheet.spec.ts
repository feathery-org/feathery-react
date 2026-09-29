import {
  autoMapColumns,
  buildUnverifiedRows,
  columnLabel,
  columnRefAt,
  normalizeSpreadsheet,
  NormalizedSheet,
  resolveColumnIndex
} from './spreadsheet';

const sheet = (rows: string[][], name = 'Clients'): NormalizedSheet => ({
  name,
  ...normalizeSpreadsheet(rows)
});

describe('spreadsheet column identity', () => {
  test('imports each duplicate header from its selected original column', () => {
    const source = sheet([
      ['First Name', 'Unused', 'First Name'],
      ['John', '', 'Jane']
    ]);
    expect(source.columnIndexes).toEqual([0, 2]);
    const mapping = {
      primary: columnRefAt(source, 0),
      secondary: columnRefAt(source, 1)
    };
    expect(
      buildUnverifiedRows([source], JSON.parse(JSON.stringify(mapping)))
    ).toEqual([{ primary: 'John', secondary: 'Jane' }]);
    expect(columnLabel(mapping.primary)).toBe('First Name — A');
    expect(columnLabel(mapping.secondary)).toBe('First Name — C');
  });

  test('preserves AX and CF labels despite empty intervening columns', () => {
    const headers = Array(84).fill('');
    const values = Array(84).fill('');
    headers[49] = headers[83] = 'First Name';
    values[49] = 'John';
    values[83] = 'Jane';
    const source = sheet([headers, values]);
    expect(columnLabel(columnRefAt(source, 0))).toBe('First Name — AX');
    expect(columnLabel(columnRefAt(source, 1))).toBe('First Name — CF');
  });

  test('retains populated columns with missing, trailing or sparse headers', () => {
    const headers = Array(3);
    headers[0] = 'Name';
    const source = sheet([headers, ['Ada', '', 'middle', 'last']]);
    expect(source.headers).toEqual(['Name', 'Column 3', 'Column 4']);
    expect(source.columnIndexes).toEqual([0, 2, 3]);
    expect(
      buildUnverifiedRows([source], { last: columnRefAt(source, 2) })
    ).toEqual([{ last: 'last' }]);
  });

  test('resolves legacy unique mappings but rejects ambiguous legacy names', () => {
    const source = sheet([
      ['Name', 'Name', 'Email'],
      ['A', 'B', 'a@example.invalid']
    ]);
    expect(
      resolveColumnIndex(source, { sheet: 'Clients', header: 'Name' })
    ).toBe(-1);
    expect(
      resolveColumnIndex(source, { sheet: 'Clients', header: 'Email' })
    ).toBe(2);
    expect(
      buildUnverifiedRows([source], {
        name: { sheet: 'Clients', header: 'Name' },
        email: { sheet: 'Clients', header: 'Email' }
      })
    ).toEqual([{ email: 'a@example.invalid' }]);
  });

  test('does not fall back by name when a positioned mapping becomes stale', () => {
    const source = sheet([
      ['Name', 'Other'],
      ['A', 'B']
    ]);
    for (const columnIndex of [-1, 0.5, 1, 2, NaN]) {
      expect(
        resolveColumnIndex(source, {
          sheet: 'Clients',
          header: 'Name',
          columnIndex
        })
      ).toBe(-1);
    }
    expect(
      resolveColumnIndex(source, {
        sheet: 'Other',
        header: 'Name',
        columnIndex: 0
      })
    ).toBe(-1);
  });

  test('keeps the same source column when changing the header row filters columns', () => {
    const before = sheet([
      ['Name', 'Unused', 'Name'],
      ['John', 'note', 'Jane'],
      ['John', '', 'Jane']
    ]);
    const ref = columnRefAt(before, 2);
    const after = sheet([
      ['Name', '', 'Name'],
      ['John', '', 'Jane']
    ]);
    expect(resolveColumnIndex(after, ref)).toBe(1);
    expect(buildUnverifiedRows([after], { secondary: ref })).toEqual([
      { secondary: 'Jane' }
    ]);
    const changed = sheet([
      ['Name', '', 'Age'],
      ['John', '', '35']
    ]);
    expect(resolveColumnIndex(changed, ref)).toBe(-1);
  });

  test('auto-maps unique headers case-insensitively and leaves duplicates unselected', () => {
    const source = sheet([
      ['Name', 'name', 'EMAIL'],
      ['A', 'B', 'a@example.invalid']
    ]);
    const other = sheet([['Name'], ['C']], 'Other');
    expect(
      autoMapColumns(
        [{ key: 'Name' }, { key: 'Email' }],
        [other, source],
        'Clients'
      )
    ).toEqual({ Email: { sheet: 'Clients', header: 'EMAIL', columnIndex: 2 } });
  });

  test('keeps sheets distinct and retains row-zip behavior', () => {
    const a = sheet([
      ['Name', 'Name'],
      ['A', 'B'],
      ['C', 'D']
    ]);
    const b = sheet([['Name'], ['E']], 'Other');
    expect(
      buildUnverifiedRows([a, b], {
        first: columnRefAt(a, 1),
        second: columnRefAt(b, 0)
      })
    ).toEqual([
      { first: 'B', second: 'E' },
      { first: 'D', second: '' }
    ]);
  });

  test('supports pre-position normalized sheet callers with unique headers', () => {
    const source = { name: 'Old', headers: ['Name'], rows: [['Ada']] };
    expect(
      buildUnverifiedRows([source], { name: { sheet: 'Old', header: 'Name' } })
    ).toEqual([{ name: 'Ada' }]);
  });
});
