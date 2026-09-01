import {
  acceptsNumericInput,
  choicesFor,
  editorKindFor,
  formatCellDisplay,
  toEditorValue
} from '../spreadsheet/fieldEditors';

describe('editorKindFor', () => {
  test('an option list wins over the underlying type', () => {
    expect(
      editorKindFor({ label: 'Tier', type: 'text', options: ['a', 'b'] })
    ).toBe('select');
  });

  test('each field type gets its own control', () => {
    const kind = (type: any) => editorKindFor({ label: 'x', type });
    expect(kind('boolean')).toBe('select');
    expect(kind('number')).toBe('number');
    expect(kind('date')).toBe('date');
    expect(kind('datetime')).toBe('datetime');
    expect(kind('email')).toBe('email');
    expect(kind('url')).toBe('url');
    expect(kind('text')).toBe('text');
    // Upload references cannot be typed, so the cell refuses the edit.
    expect(kind('file')).toBe('readonly');
  });

  test('a column with no rule is a plain text box', () => {
    expect(editorKindFor(undefined)).toBe('text');
  });

  test('booleans offer true and false as choices', () => {
    expect(choicesFor({ label: 'x', type: 'boolean' })).toEqual([
      'true',
      'false'
    ]);
    expect(choicesFor({ label: 'x', type: 'text' })).toBeNull();
  });
});

describe('acceptsNumericInput', () => {
  test('lets a number be typed, including part-way there', () => {
    ['', '-', '1', '1.', '1.5', '-0.25'].forEach((draft) =>
      expect(acceptsNumericInput(draft)).toBe(true)
    );
  });

  test('refuses anything that is not on its way to a number', () => {
    ['a', '1a', '1.2.3', '1e5', '--1', '$5'].forEach((draft) =>
      expect(acceptsNumericInput(draft)).toBe(false)
    );
  });
});

describe('toEditorValue', () => {
  test('a date picker gets just the date part', () => {
    expect(toEditorValue('2024-03-05T11:30:00Z', 'date')).toBe('2024-03-05');
    expect(toEditorValue('2024-03-05', 'date')).toBe('2024-03-05');
  });

  test('a datetime picker gets minutes precision', () => {
    expect(toEditorValue('2024-03-05T11:30:45Z', 'datetime')).toBe(
      '2024-03-05T11:30'
    );
    // A date-only value still opens the picker rather than wedging it.
    expect(toEditorValue('2024-03-05', 'datetime')).toBe('2024-03-05T00:00');
  });

  test('an unparseable value opens an empty picker, not a broken one', () => {
    expect(toEditorValue('not a date', 'date')).toBe('');
  });

  test('everything else passes through untouched', () => {
    expect(toEditorValue('half-typed@', 'email')).toBe('half-typed@');
  });
});

describe('formatCellDisplay', () => {
  test('a tax ID shows only its last four digits', () => {
    expect(formatCellDisplay('123456789', { label: 'SSN', type: 'tax_id' })).toBe(
      '•••••6789'
    );
  });

  test('a short tax ID is not padded into looking longer', () => {
    expect(formatCellDisplay('789', { label: 'SSN', type: 'tax_id' })).toBe('789');
  });

  test('file references show their names', () => {
    expect(
      formatCellDisplay(
        JSON.stringify([{ url: 'https://x/y', path: 'uploads/deed.pdf' }]),
        { label: 'Docs', type: 'file' }
      )
    ).toBe('deed.pdf');
  });

  test('an empty cell shows nothing at all', () => {
    expect(formatCellDisplay(null, { label: 'SSN', type: 'tax_id' })).toBe('');
  });

  test('an ordinary column is shown as-is', () => {
    expect(formatCellDisplay('Alice', { label: 'Name', type: 'text' })).toBe(
      'Alice'
    );
    expect(formatCellDisplay(true, undefined)).toBe('TRUE');
  });
});
