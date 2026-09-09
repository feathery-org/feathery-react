import {
  castArrayCell,
  deriveArrayColumns,
  deriveArrayFieldValues,
  isRaggedRows,
  normalizeRows,
  parseArrayTableValue
} from '../arrayTableSource';

describe('parseArrayTableValue', () => {
  it('treats an unset field as an empty table, not an error', () => {
    for (const raw of [null, undefined, '']) {
      const parsed = parseArrayTableValue(raw);
      expect(parsed.rows).toEqual([]);
      expect(parsed.error).toBeUndefined();
    }
  });

  it('accepts an array of arrays', () => {
    const parsed = parseArrayTableValue([
      ['Name', 'Age'],
      ['Alice', 30]
    ]);
    expect(parsed.rows).toEqual([
      ['Name', 'Age'],
      ['Alice', 30]
    ]);
    expect(parsed.wasString).toBe(false);
  });

  it('parses a JSON string and remembers it was one', () => {
    const parsed = parseArrayTableValue('[["A"],[1]]');
    expect(parsed.rows).toEqual([['A'], [1]]);
    expect(parsed.wasString).toBe(true);
    expect(parsed.error).toBeUndefined();
  });

  it('errors on anything that is not an array of arrays', () => {
    for (const raw of [
      'hello',
      '{"a":1}',
      { a: 1 },
      [['A'], 'notarow'],
      [1, 2],
      42
    ]) {
      expect(parseArrayTableValue(raw, 'table_data').error).toBe(
        'table_data must be an array of arrays'
      );
    }
  });

  it('names the field in the error so the builder knows which to fix', () => {
    expect(parseArrayTableValue('hello', 'my_rows').error).toBe(
      'my_rows must be an array of arrays'
    );
    // Falls back to a generic label rather than a message starting with a space.
    expect(parseArrayTableValue('hello').error).toBe(
      'Table data must be an array of arrays'
    );
  });
});

describe('castArrayCell', () => {
  it('casts every cell type to a string', () => {
    expect(castArrayCell(42)).toBe('42');
    expect(castArrayCell(true)).toBe('true');
    expect(castArrayCell(null)).toBe('');
    expect(castArrayCell(undefined)).toBe('');
    expect(castArrayCell({ a: 1 })).toBe('{"a":1}');
    expect(castArrayCell([1, 2])).toBe('[1,2]');
  });
});

describe('deriveArrayColumns / deriveArrayFieldValues', () => {
  it('uses the first row as headers and the rest as data', () => {
    const rows = [
      ['Name', 'Age'],
      ['Alice', 30],
      ['Bob', 40]
    ];
    const columns = deriveArrayColumns('t1', rows);
    expect(columns.map((col) => col.name)).toEqual(['Name', 'Age']);
    expect(columns.map((col) => col.field_key)).toEqual([
      '__array_t1_0',
      '__array_t1_1'
    ]);
    expect(deriveArrayFieldValues(columns, rows)).toEqual({
      __array_t1_0: ['Alice', 'Bob'],
      __array_t1_1: ['30', '40']
    });
  });

  it('widens to the longest row, blanking missing headers and cells', () => {
    const rows = [['A', 'B'], ['1', '2', '3'], ['4']];
    const columns = deriveArrayColumns('t1', rows);
    expect(columns.map((col) => col.name)).toEqual(['A', 'B', '']);
    expect(deriveArrayFieldValues(columns, rows)).toEqual({
      __array_t1_0: ['1', '4'],
      __array_t1_1: ['2', ''],
      __array_t1_2: ['3', '']
    });
  });

  it('yields a header-only table with no rows', () => {
    const rows = [['A', 'B']];
    const columns = deriveArrayColumns('t1', rows);
    expect(columns).toHaveLength(2);
    expect(deriveArrayFieldValues(columns, rows)).toEqual({
      __array_t1_0: [],
      __array_t1_1: []
    });
  });
});

describe('isRaggedRows', () => {
  it('is true only when a row differs from the widest row', () => {
    expect(isRaggedRows([['A', 'B'], ['1', '2', '3']])).toBe(true);
    expect(isRaggedRows([['A', 'B'], ['1']])).toBe(true);

    expect(isRaggedRows([['A', 'B'], ['1', '2']])).toBe(false);
    expect(isRaggedRows([['A']])).toBe(false);
    expect(isRaggedRows([])).toBe(false);
  });
});

describe('normalizeRows', () => {
  it('pads every row out to the widest row, headers included', () => {
    expect(normalizeRows([['A', 'B'], ['1', '2', '3'], ['4']])).toEqual([
      ['A', 'B', ''],
      ['1', '2', '3'],
      ['4', '', '']
    ]);
  });

  it('pads without casting, so cells keep their original types', () => {
    expect(normalizeRows([['Name', 'Age'], ['Alice', 30, true]])).toEqual([
      ['Name', 'Age', ''],
      ['Alice', 30, true]
    ]);
  });

  it('leaves an already-rectangular array untouched', () => {
    const rows = [['A', 'B'], ['1', '2']];
    expect(normalizeRows(rows)).toEqual(rows);
  });
});
