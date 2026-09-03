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
    ).toBe('Required');
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
    expect(validateCellValue('abc', rule)).toBe('Must be a number');
    expect(validateCellValue(0, rule)).toBe('Must be at least 1');
    expect(validateCellValue(200, rule)).toBe('Must be at most 120');
    expect(validateCellValue(1.25, rule)).toBe('Up to 1 decimal place');
  });

  test('text columns enforce their option list and lengths', () => {
    const rule = {
      label: 'Tier',
      type: 'text' as const,
      options: ['gold', 'silver']
    };
    expect(validateCellValue('gold', rule)).toBeNull();
    expect(validateCellValue('bronze', rule)).toBe(
      'Must be gold or silver'
    );
    expect(
      validateCellValue('ab', { label: 'Code', type: 'text', minLength: 3 })
    ).toBe('At least 3 characters');
  });

  test('format columns check their own shapes', () => {
    expect(
      validateCellValue('nope', { label: 'Email', type: 'email' })
    ).toBe('Invalid email');
    expect(
      validateCellValue('a@b.com', { label: 'Email', type: 'email' })
    ).toBeNull();
    expect(
      validateCellValue('12345', { label: 'SSN', type: 'tax_id' })
    ).toBe('Must be 9 digits, no dashes');
    expect(
      validateCellValue('123456789', { label: 'SSN', type: 'tax_id' })
    ).toBeNull();
    expect(
      validateCellValue('not-a-uuid', { label: 'Ref', type: 'uuid' })
    ).toBe('Invalid UUID');
  });

  test('phone numbers are held to the hub rule: digits only', () => {
    // The hub matches the raw string against ^\d{7,15}$, so punctuation or a
    // leading + that passed here would be refused on save — after the cell
    // had shown as clean.
    const rule = { label: 'Phone', type: 'phone_number' as const };
    expect(validateCellValue('4155551234', rule)).toBeNull();
    expect(validateCellValue('(415) 555-1234', rule)).toContain('7–15 digits');
    expect(validateCellValue('+14155551234', rule)).toContain('7–15 digits');
    expect(validateCellValue('12345', rule)).toContain('7–15 digits');
  });

  test('an empty file cell is never required, matching the hub', () => {
    // Every server-side required check skips file fields; flagging one here
    // would disable Save for a row the hub accepts.
    expect(
      validateCellValue(null, { label: 'Docs', type: 'file', required: true })
    ).toBeNull();
  });

  test('dates are parsed, then held to their range', () => {
    expect(
      validateCellValue('not a date', { label: 'DOB', type: 'date' })
    ).toBe('Invalid date');
    expect(
      validateCellValue('2020-01-01', {
        label: 'DOB',
        type: 'date',
        dateRange: 'future_only'
      })
    ).toBe('Must be in the future');
    expect(
      validateCellValue('2020-01-01', {
        label: 'DOB',
        type: 'date',
        minDate: '2021-01-01'
      })
    ).toBe('Must be on or after 2021-01-01');
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
    expect(errors[cellErrorKey(2, 'email')]).toBe('Must be unique');
  });

  test('staged rows neither claim a unique value nor get flagged for one', () => {
    // The hub checks uniqueness against verified rows only, and not at all
    // for a staged write. Row 2 (verified) shares row 0's email: it would be
    // flagged if row 0 were verified, but row 0 is staged here, so it is not.
    const rules = { email: { label: 'Email', type: 'email' as const, unique: true } };
    const staged = validateGrid({
      rowIndices: [0, 1, 2],
      fieldKeys: ['email'],
      getValue,
      rules,
      isRowStaged: (rowIndex) => rowIndex === 0
    });
    expect(staged[cellErrorKey(2, 'email')]).toBeUndefined();

    // And a staged duplicate of a verified value is not flagged either.
    const stagedCopy = validateGrid({
      rowIndices: [0, 1, 2],
      fieldKeys: ['email'],
      getValue,
      rules,
      isRowStaged: (rowIndex) => rowIndex === 2
    });
    expect(stagedCopy[cellErrorKey(2, 'email')]).toBeUndefined();
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

  test('field-backed columns only get format and storage-type rules', () => {
    const rules = fieldCellRules([
      { field_key: 'a', name: 'Email', field_type: 'email' },
      { field_key: 'b', name: 'Notes', field_type: 'text_field' },
      { field_key: 'c', name: 'Active', field_type: 'checkbox' },
      { field_key: 'd', name: 'Stars', field_type: 'rating' },
      { field_key: 'e', name: 'Level', field_type: 'slider' },
      { field_key: 'f', name: 'Docs', field_type: 'file_upload' },
      { field_key: 'g', name: 'Signed', field_type: 'signature' }
    ]);
    expect(rules.a).toEqual({ label: 'Email', type: 'email' });
    expect(rules.b).toBeUndefined();
    // A checkbox stores a boolean, so its cells parse as one.
    expect(rules.c).toEqual({ label: 'Active', type: 'boolean' });
    // Rating and slider store numbers like an integer field does.
    expect(rules.d).toEqual({ label: 'Stars', type: 'number' });
    expect(rules.e).toEqual({ label: 'Level', type: 'number' });
    // Upload fields hold file references the grid must never write over.
    expect(rules.f).toEqual({ label: 'Docs', type: 'file' });
    expect(rules.g).toEqual({ label: 'Signed', type: 'file' });
  });
});

describe('listChoices via option rules', () => {
  test('reads as a sentence for one, two and many options', () => {
    const rule = (options: string[]) => ({ label: 'Status', type: 'text' as const, options });
    expect(validateCellValue('x', rule(['A']))).toBe('Must be A');
    expect(validateCellValue('x', rule(['A', 'B']))).toBe('Must be A or B');
    expect(validateCellValue('x', rule(['A', 'B', 'C']))).toBe('Must be A, B, or C');
  });
});
