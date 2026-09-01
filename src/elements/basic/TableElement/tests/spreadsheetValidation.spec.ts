import {
  cellErrorKey,
  fieldCellRules,
  hubCellRules,
  validateCellValue,
  validateGrid
} from '../spreadsheet/validation';

describe('validateCellValue', () => {
  test('an empty cell only fails when the column is required', () => {
    expect(validateCellValue('', { label: 'Name', type: 'text' })).toBeNull();
    expect(
      validateCellValue('', { label: 'Name', type: 'text', required: true })
    ).toBe('Field `Name` is required');
    // A required column is satisfied by a value the hub would reject for other
    // reasons; that failure is reported separately.
    expect(
      validateCellValue(0, { label: 'Age', type: 'number', required: true })
    ).toBeNull();
  });

  test('numbers reject non-numeric text and honour their bounds', () => {
    const rule = {
      label: 'Age',
      type: 'number' as const,
      minValue: 1,
      maxValue: 120,
      decimalDigits: 1
    };
    expect(validateCellValue('42', rule)).toBeNull();
    expect(validateCellValue('abc', rule)).toContain('must be a number');
    expect(validateCellValue(0, rule)).toBe('Field `Age` must be at least 1');
    expect(validateCellValue(200, rule)).toBe('Field `Age` must be at most 120');
    expect(validateCellValue(1.25, rule)).toContain('at most 1 decimal digit');
  });

  test('text columns enforce their option list and lengths', () => {
    const rule = {
      label: 'Tier',
      type: 'text' as const,
      options: ['gold', 'silver']
    };
    expect(validateCellValue('gold', rule)).toBeNull();
    expect(validateCellValue('bronze', rule)).toBe(
      'Field `Tier` must be one of: gold, silver'
    );
    expect(
      validateCellValue('ab', { label: 'Code', type: 'text', minLength: 3 })
    ).toBe('Field `Code` must be at least 3 characters');
  });

  test('format columns check their own shapes', () => {
    expect(
      validateCellValue('nope', { label: 'Email', type: 'email' })
    ).toContain('invalid email address');
    expect(
      validateCellValue('a@b.com', { label: 'Email', type: 'email' })
    ).toBeNull();
    expect(
      validateCellValue('12345', { label: 'SSN', type: 'tax_id' })
    ).toContain('exactly 9 digits');
    expect(
      validateCellValue('123456789', { label: 'SSN', type: 'tax_id' })
    ).toBeNull();
    expect(
      validateCellValue('not-a-uuid', { label: 'Ref', type: 'uuid' })
    ).toContain('valid UUID');
  });

  test('phone numbers allow the punctuation people type', () => {
    const rule = { label: 'Phone', type: 'phone_number' as const };
    expect(validateCellValue('(415) 555-1234', rule)).toBeNull();
    expect(validateCellValue('12345', rule)).toContain('7–15 digits');
  });

  test('dates are parsed, then held to their range', () => {
    expect(
      validateCellValue('not a date', { label: 'DOB', type: 'date' })
    ).toContain('valid ISO datetime');
    expect(
      validateCellValue('2020-01-01', {
        label: 'DOB',
        type: 'date',
        dateRange: 'future_only'
      })
    ).toBe('Field `DOB` must be a future date');
    expect(
      validateCellValue('2020-01-01', {
        label: 'DOB',
        type: 'date',
        minDate: '2021-01-01'
      })
    ).toBe('Field `DOB` must be on or after 2021-01-01');
  });

  test('a column with no checkable rule accepts anything', () => {
    expect(validateCellValue('whatever', { label: 'Notes', type: 'any' })).toBeNull();
  });
});

describe('validateGrid', () => {
  const values: Record<string, any[]> = {
    email: ['a@b.com', 'nope', 'a@b.com'],
    name: ['Alice', 'Bob', '']
  };
  const getValue = (rowIndex: number, fieldKey: string) =>
    values[fieldKey][rowIndex] ?? null;

  test('reports every failing cell, keyed by row and column', () => {
    const errors = validateGrid({
      rowIndices: [0, 1, 2],
      fieldKeys: ['email', 'name'],
      getValue,
      rules: {
        email: { label: 'Email', type: 'email' },
        name: { label: 'Name', type: 'text', required: true }
      }
    });
    expect(Object.keys(errors).sort()).toEqual([
      cellErrorKey(1, 'email'),
      cellErrorKey(2, 'name')
    ]);
  });

  test('a duplicate flags the later row, leaving the original clean', () => {
    const errors = validateGrid({
      rowIndices: [0, 1, 2],
      fieldKeys: ['email'],
      getValue,
      rules: { email: { label: 'Email', type: 'email', unique: true } }
    });
    expect(errors[cellErrorKey(0, 'email')]).toBeUndefined();
    expect(errors[cellErrorKey(2, 'email')]).toContain('must be unique');
  });

  test('columns with no rule are skipped entirely', () => {
    expect(
      validateGrid({
        rowIndices: [0, 1, 2],
        fieldKeys: ['email', 'name'],
        getValue,
        rules: {}
      })
    ).toEqual({});
  });
});

describe('rule derivation', () => {
  test('hub rules follow the schema, not the element', () => {
    const rules = hubCellRules(
      [
        { field_key: '__hub_t_email', name: 'Email', hub_field_key: 'email' },
        { field_key: '__hub_t_notes', name: 'Notes', hub_field_key: 'notes' }
      ],
      [
        { key: 'email', type: 'email', required: true, unique: true },
        { key: 'notes', type: 'file' }
      ]
    );
    expect(rules.__hub_t_email).toMatchObject({
      label: 'Email',
      type: 'email',
      required: true,
      unique: true
    });
    // A file field keeps its own type so the grid can refuse to edit it; the
    // `[{url, path}]` shape is the hub's to judge, not this module's.
    expect(rules.__hub_t_notes.type).toBe('file');
    expect(
      validateCellValue('anything', { label: 'Notes', type: 'file' })
    ).toBeNull();
  });

  test('hub metadata becomes the numeric and text bounds', () => {
    const rules = hubCellRules(
      [{ field_key: 'k', name: 'Age', hub_field_key: 'age' }],
      [{ key: 'age', type: 'number', metadata: { min_value: 1, max_value: 9 } }]
    );
    expect(rules.k).toMatchObject({ minValue: 1, maxValue: 9 });
  });

  test('field-backed columns only get format rules', () => {
    const rules = fieldCellRules([
      { field_key: 'a', name: 'Email', field_type: 'email' },
      { field_key: 'b', name: 'Notes', field_type: 'text_field' }
    ]);
    expect(rules.a).toEqual({ label: 'Email', type: 'email' });
    expect(rules.b).toBeUndefined();
  });
});
