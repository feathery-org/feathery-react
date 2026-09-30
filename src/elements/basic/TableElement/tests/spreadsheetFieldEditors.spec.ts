import {
  acceptsNumericInput,
  acceptsZipInput,
  choiceLabelsFor,
  choicesFor,
  editorKindFor,
  formatCellDisplay,
  fromEditorValue,
  matchChoice,
  normalizeZip,
  numberAdornments,
  parseCellInput,
  seedActionFor,
  toEditorValue
} from '../spreadsheet/fieldEditors';
import { CellRule } from '../spreadsheet/validation';

// What a `datetime-local` input shows for an instant: local wall-clock time.
// Derived from Date rather than written out so the test holds in any zone.
const localPicker = (instant: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-` +
    `${pad(instant.getDate())}T${pad(instant.getHours())}:` +
    `${pad(instant.getMinutes())}`
  );
};

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

  test('a datetime picker shows the stored UTC instant in local time', () => {
    // The hub stores instants in UTC; a datetime-local input is wall-clock
    // time in the viewer's zone, so the hour has to be converted or an
    // 18:00Z value reads as 18:00 for someone in New York.
    const stored = '2024-03-05T11:30:00.000Z';
    expect(toEditorValue(stored, 'datetime')).toBe(
      localPicker(new Date(stored))
    );
  });

  test('seconds and milliseconds survive the trip into the picker', () => {
    // The picker only offers a seconds field when its value carries one, so
    // handing it `12:00` would have a date change silently drop 12:00:30 to
    // 12:00:00. A whole minute keeps the short form.
    const withSeconds = '2024-03-05T11:30:45.000Z';
    expect(toEditorValue(withSeconds, 'datetime')).toBe(
      `${localPicker(new Date(withSeconds))}:45`
    );
    const withMillis = '2024-03-05T11:30:45.250Z';
    expect(toEditorValue(withMillis, 'datetime')).toBe(
      `${localPicker(new Date(withMillis))}:45.250`
    );
    expect(
      fromEditorValue(toEditorValue(withSeconds, 'datetime'), 'datetime')
    ).toBe(withSeconds);
  });

  test('a datetime with no zone is read as UTC, the way the hub reads it', () => {
    expect(toEditorValue('2024-03-05T11:30:00', 'datetime')).toBe(
      localPicker(new Date('2024-03-05T11:30:00Z'))
    );
    // A date-only value still opens the picker rather than wedging it.
    expect(toEditorValue('2024-03-05', 'datetime')).toBe(
      localPicker(new Date('2024-03-05T00:00:00Z'))
    );
  });

  test('an unparseable value opens an empty picker, not a broken one', () => {
    expect(toEditorValue('not a date', 'date')).toBe('');
  });

  test('everything else passes through untouched', () => {
    expect(toEditorValue('half-typed@', 'email')).toBe('half-typed@');
  });
});

describe('fromEditorValue', () => {
  test('a picked local datetime is stored as the UTC instant', () => {
    // Local 09:15 on the 5th, whatever zone the test runs in.
    const picked = new Date(2024, 2, 5, 9, 15);
    expect(fromEditorValue(localPicker(picked), 'datetime')).toBe(
      picked.toISOString()
    );
  });

  test('round-trips through the picker without drifting', () => {
    const stored = '2024-03-05T11:30:00.000Z';
    expect(
      fromEditorValue(toEditorValue(stored, 'datetime'), 'datetime')
    ).toBe(stored);
  });

  test('dates and text are left exactly as entered', () => {
    expect(fromEditorValue('2024-03-05', 'date')).toBe('2024-03-05');
    expect(fromEditorValue('hello', 'text')).toBe('hello');
    expect(fromEditorValue('', 'datetime')).toBe('');
  });
});

describe('parseCellInput', () => {
  const text = { label: 'Notes', type: 'text' as const };
  const taxId = { label: 'SSN', type: 'tax_id' as const };
  const number = { label: 'Age', type: 'number' as const };
  const bool = { label: 'Active', type: 'boolean' as const };

  test('a text column stores exactly what was typed', () => {
    // The leading zero is part of the identifier; guessing "number" from the
    // shape would turn 012345678 into 12345678.
    expect(parseCellInput('012345678', taxId)).toBe('012345678');
    expect(parseCellInput('02138', text)).toBe('02138');
    expect(parseCellInput('true', text)).toBe('true');
    expect(parseCellInput('1e5', text)).toBe('1e5');
  });

  test('a number column keeps numbers as numbers', () => {
    expect(parseCellInput('42', number)).toBe(42);
    expect(parseCellInput(' -3.5 ', number)).toBe(-3.5);
    // What is not a number stays text, for the rule to flag.
    expect(parseCellInput('12x', number)).toBe('12x');
  });

  test('a boolean column keeps booleans as booleans', () => {
    expect(parseCellInput('TRUE', bool)).toBe(true);
    expect(parseCellInput('false', bool)).toBe(false);
    expect(parseCellInput('maybe', bool)).toBe('maybe');
  });

  test('a blank entry clears the cell in every column', () => {
    expect(parseCellInput('', text)).toBeNull();
    expect(parseCellInput('   ', number)).toBeNull();
  });

  test('with no rule, the type follows what the cell already held', () => {
    expect(parseCellInput('43', undefined, 42)).toBe(43);
    expect(parseCellInput('false', undefined, true)).toBe(false);
    // A text cell (or an empty one) stays text: no guessing from shape.
    expect(parseCellInput('007', undefined, 'Bond')).toBe('007');
    expect(parseCellInput('007', undefined, null)).toBe('007');
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

  test('dates read as a calendar day, in UTC so the day never shifts', () => {
    const date = { label: 'Born', type: 'date' as const };
    expect(formatCellDisplay('1982-07-19', date)).toBe('Jul 19, 1982');
    // Older rows hold a midnight instant; it is the same day.
    expect(formatCellDisplay('1982-07-19T00:00:00Z', date)).toBe('Jul 19, 1982');
  });

  test('datetimes read in the viewer\'s zone, like the editor shows them', () => {
    const rule = { label: 'Sent', type: 'datetime' as const };
    const shown = formatCellDisplay('2026-09-02T14:05:00.000Z', rule);
    const expected = new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    }).format(new Date('2026-09-02T14:05:00.000Z'));
    expect(shown).toBe(expected);
    expect(shown).toMatch(/Sep \d+, 2026/);
  });

  test('an unparseable date shows as typed so it can be fixed', () => {
    expect(formatCellDisplay('soon', { label: 'Born', type: 'date' })).toBe('soon');
  });
});

describe('seedActionFor', () => {
  const number = { label: 'Age', type: 'number' as const };

  // The character is chosen before an editor exists, so the editor's own
  // filter never sees it — typing a letter used to open the editor already
  // holding that letter.
  test('a number column swallows anything that is not numeric', () => {
    expect(seedActionFor(number, 'a')).toBe('ignore');
    expect(seedActionFor(number, '$')).toBe('ignore');
    expect(seedActionFor(number, '5')).toBe('seed');
    expect(seedActionFor(number, '-')).toBe('seed');
  });

  // A picker takes a whole date; seeding a character into one crashed the grid
  // outright, because setSelectionRange throws on a date input.
  test('date pickers open on their stored value rather than the character', () => {
    expect(seedActionFor({ label: 'Born', type: 'date' }, '2')).toBe('open');
    expect(seedActionFor({ label: 'At', type: 'datetime' }, '2')).toBe('open');
  });

  test('a file column cannot be typed into at all', () => {
    expect(seedActionFor({ label: 'Docs', type: 'file' }, '5')).toBe('ignore');
  });

  test('everything else takes the character as the start of the edit', () => {
    expect(seedActionFor({ label: 'Name', type: 'text' }, 'A')).toBe('seed');
    expect(
      seedActionFor({ label: 'Tier', type: 'text', options: ['Gold'] }, 'G')
    ).toBe('seed');
    expect(seedActionFor(undefined, 'A')).toBe('seed');
  });
});

describe('hub field formats', () => {
  const currency = (extra: Partial<CellRule> = {}): CellRule => ({
    label: 'Price',
    type: 'number',
    format: 'currency',
    ...extra
  });
  const percentage = (extra: Partial<CellRule> = {}): CellRule => ({
    label: 'Rate',
    type: 'number',
    format: 'percentage',
    ...extra
  });
  const zip: CellRule = { label: 'ZIP', type: 'text', format: 'us_zip' };
  const state: CellRule = {
    label: 'State',
    type: 'text',
    format: 'us_state',
    options: ['CA', 'CO', 'NY'],
    optionLabels: ['California', 'Colorado', 'New York']
  };
  const country: CellRule = {
    label: 'Country',
    type: 'text',
    format: 'country',
    options: ['US', 'CA', 'GB'],
    optionLabels: ['United States', 'Canada', 'United Kingdom']
  };

  describe('formatCellDisplay', () => {
    test('currency pads to two decimals by default, with grouping', () => {
      expect(formatCellDisplay(1234.5, currency())).toBe('$1,234.50');
      expect(formatCellDisplay(-100, currency())).toBe('-$100.00');
      expect(formatCellDisplay('7', currency())).toBe('$7.00');
    });

    test('currency honours the field currency and decimal digits', () => {
      expect(formatCellDisplay(1234.5, currency({ currency: 'EUR' }))).toBe(
        '€1,234.50'
      );
      expect(formatCellDisplay(1234.5, currency({ decimalDigits: 0 }))).toBe(
        '$1,235'
      );
      // Wider than a form field goes, still exact.
      expect(formatCellDisplay(0.125, currency({ decimalDigits: 3 }))).toBe(
        '$0.125'
      );
    });

    test('percentage shows only the digits it has unless decimals are fixed', () => {
      expect(formatCellDisplay(12, percentage())).toBe('12%');
      expect(formatCellDisplay(12.5, percentage())).toBe('12.5%');
      expect(formatCellDisplay(1200, percentage())).toBe('1,200%');
      expect(formatCellDisplay(12.345, percentage())).toBe('12.345%');
      expect(formatCellDisplay(12, percentage({ decimalDigits: 1 }))).toBe(
        '12.0%'
      );
    });

    test('a non-numeric value in a formatted column shows as typed', () => {
      expect(formatCellDisplay('abc', currency())).toBe('abc');
    });

    test('state, country and ZIP cells show the stored value', () => {
      expect(formatCellDisplay('CA', state)).toBe('CA');
      expect(formatCellDisplay('US', country)).toBe('US');
      expect(formatCellDisplay('02134', zip)).toBe('02134');
    });
  });

  describe('parseCellInput', () => {
    test('a formatted number accepts its own symbols and grouping', () => {
      expect(parseCellInput('$1,234.50', currency())).toBe(1234.5);
      expect(parseCellInput('-$100', currency())).toBe(-100);
      expect(parseCellInput('12%', percentage())).toBe(12);
      expect(parseCellInput('1234', currency())).toBe(1234);
      expect(parseCellInput('abc', currency())).toBe('abc');
    });

    test('a ZIP is normalized the way the hub stores it', () => {
      expect(parseCellInput('2134', zip)).toBe('02134');
      expect(parseCellInput('501', zip)).toBe('00501');
      expect(parseCellInput(' 12345 ', zip)).toBe('12345');
      expect(parseCellInput('123456789', zip)).toBe('12345-6789');
      expect(parseCellInput('21346789', zip)).toBe('02134-6789');
      expect(parseCellInput('12345 6789', zip)).toBe('12345-6789');
      expect(parseCellInput('12345-6789', zip)).toBe('12345-6789');
      // Anything else passes through to fail validation.
      expect(parseCellInput('12', zip)).toBe('12');
      expect(normalizeZip('1234567')).toBe('1234567');
      expect(normalizeZip('1234 5678')).toBe('01234-5678');
      expect(normalizeZip('12345  6789')).toBe('12345-6789');
      expect(normalizeZip('12345 - 6789')).toBe('12345-6789');
      expect(normalizeZip('12 345')).toBe('12345');
    });

    test('a state or country is stored as its code', () => {
      expect(parseCellInput('ca', state)).toBe('CA');
      expect(parseCellInput(' california ', state)).toBe('CA');
      expect(parseCellInput('United States', country)).toBe('US');
      expect(parseCellInput('gb', country)).toBe('GB');
      expect(parseCellInput('Narnia', country)).toBe('Narnia');
    });
  });

  describe('editing', () => {
    test('a ZIP column gets its own editor that takes digits, dash and space', () => {
      expect(editorKindFor(zip)).toBe('zip');
      expect(acceptsZipInput('12345-67')).toBe(true);
      expect(acceptsZipInput('12345 6')).toBe(true);
      expect(acceptsZipInput('1234a')).toBe(false);
      expect(seedActionFor(zip, '1')).toBe('seed');
      expect(seedActionFor(zip, 'a')).toBe('ignore');
    });

    test('state and country columns are dropdowns with labels', () => {
      expect(editorKindFor(state)).toBe('select');
      expect(choicesFor(country)).toEqual(['US', 'CA', 'GB']);
      expect(choiceLabelsFor(country)).toEqual([
        'United States',
        'Canada',
        'United Kingdom'
      ]);
      expect(
        choiceLabelsFor({ label: 'x', type: 'text', options: ['a'] })
      ).toBeNull();
    });

    test('formatted numbers show their unit around the raw draft', () => {
      expect(numberAdornments(currency())).toEqual({ prefix: '$', suffix: '' });
      expect(numberAdornments(currency({ currency: 'EUR' }))).toEqual({
        prefix: '€',
        suffix: ''
      });
      expect(numberAdornments(percentage())).toEqual({
        prefix: '',
        suffix: '%'
      });
      expect(numberAdornments({ label: 'n', type: 'number' })).toEqual({
        prefix: '',
        suffix: ''
      });
    });
  });

  describe('matchChoice', () => {
    const codes = country.options as string[];
    const names = country.optionLabels as string[];

    test('a whole code wins, then a code prefix, then a name prefix', () => {
      expect(matchChoice(codes, names, 'ca')).toBe('CA');
      expect(matchChoice(codes, names, 'g')).toBe('GB');
      expect(matchChoice(codes, names, 'unit')).toBe('US');
      expect(matchChoice(codes, names, 'united k')).toBe('GB');
      expect(matchChoice(codes, names, 'can')).toBe('CA');
    });

    test('no match, and no labels, find nothing extra', () => {
      expect(matchChoice(codes, names, 'zz')).toBeUndefined();
      expect(matchChoice(codes, null, 'canada')).toBeUndefined();
      expect(matchChoice(codes, names, '  ')).toBeUndefined();
    });
  });
});
