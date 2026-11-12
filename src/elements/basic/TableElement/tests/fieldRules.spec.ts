import {
  fieldCellRules,
  hiddenFieldCellRule,
  servarCellRule
} from '../fieldRules';

describe('servarCellRule', () => {
  test('a date field is a date, or a datetime once it takes a time', () => {
    expect(servarCellRule('When', { type: 'date_selector' })).toEqual({
      label: 'When',
      type: 'date'
    });
    expect(
      servarCellRule('When', {
        type: 'date_selector',
        metadata: { choose_time: true }
      })
    ).toEqual({ label: 'When', type: 'datetime' });
  });

  test('a date field brings its day limits, not its time-of-day ones', () => {
    expect(
      servarCellRule('When', {
        type: 'date_selector',
        metadata: {
          min_date: '2024-01-01',
          max_date: '2024-12-31',
          min_time: '09:00',
          max_time: '17:00'
        }
      })
    ).toEqual({
      label: 'When',
      type: 'date',
      minDate: '2024-01-01',
      maxDate: '2024-12-31'
    });
  });

  test('a choice field fixes the cell to its options', () => {
    expect(
      servarCellRule('Status', {
        type: 'dropdown',
        metadata: { options: ['open', 'closed'] }
      })
    ).toEqual({ label: 'Status', type: 'text', options: ['open', 'closed'] });
  });

  test('option labels ride along only when they differ from the values', () => {
    expect(
      servarCellRule('Status', {
        type: 'select',
        metadata: {
          options: ['o', 'c', 'x'],
          // A blank label falls back to the value.
          option_labels: ['Open', 'Closed', '']
        }
      })
    ).toEqual({
      label: 'Status',
      type: 'text',
      options: ['o', 'c', 'x'],
      optionLabels: ['Open', 'Closed', 'x']
    });
    expect(
      servarCellRule('Status', {
        type: 'select',
        metadata: { options: ['a', 'b'], option_labels: ['a', 'b'] }
      })
    ).toEqual({ label: 'Status', type: 'text', options: ['a', 'b'] });
  });

  test('a choice field that also takes free text gets no option list', () => {
    expect(
      servarCellRule('Status', {
        type: 'select',
        metadata: { options: ['a'], other: true }
      })
    ).toBeUndefined();
    expect(
      servarCellRule('Status', {
        type: 'dropdown',
        metadata: { options: ['a'], creatable_options: true }
      })
    ).toBeUndefined();
    expect(
      servarCellRule('Status', { type: 'dropdown', metadata: { options: [] } })
    ).toBeUndefined();
  });

  test('multi-value choice fields get no list: a row holds a selection, not a pick', () => {
    ['dropdown_multi', 'multiselect', 'checkbox_group', 'button_group'].forEach(
      (type) => {
        expect(
          servarCellRule('Tags', { type, metadata: { options: ['x', 'y'] } })
        ).toBeUndefined();
      }
    );
  });

  test('options that differ per repeat row give no single list', () => {
    expect(
      servarCellRule('Status', {
        type: 'dropdown',
        metadata: { options: ['a', 'b'], repeat_options: [null, ['c']] }
      })
    ).toBeUndefined();
    // An empty per-row table is no per-row table.
    expect(
      servarCellRule('Status', {
        type: 'dropdown',
        metadata: { options: ['a', 'b'], repeat_options: [] }
      })
    ).toEqual({ label: 'Status', type: 'text', options: ['a', 'b'] });
  });

  test('storage types: numbers, booleans, files, formats', () => {
    ['integer_field', 'currency', 'rating', 'slider'].forEach((type) => {
      expect(servarCellRule('N', { type })).toEqual({
        label: 'N',
        type: 'number'
      });
    });
    expect(servarCellRule('On', { type: 'checkbox' })).toEqual({
      label: 'On',
      type: 'boolean'
    });
    ['file_upload', 'signature', 'audio_recording'].forEach((type) => {
      expect(servarCellRule('F', { type })).toEqual({
        label: 'F',
        type: 'file'
      });
    });
    expect(servarCellRule('E', { type: 'email' })).toEqual({
      label: 'E',
      type: 'email'
    });
    expect(servarCellRule('U', { type: 'url' })).toEqual({
      label: 'U',
      type: 'url'
    });
  });

  test('an SSN is a tax ID only when stored as bare digits', () => {
    expect(servarCellRule('SSN', { type: 'ssn' })).toEqual({
      label: 'SSN',
      type: 'tax_id'
    });
    expect(
      servarCellRule('SSN', { type: 'ssn', metadata: { save_mask: true } })
    ).toBeUndefined();
  });

  test('free-text fields get no rule at all', () => {
    ['text_field', 'text_area', 'phone_number', 'password', 'matrix'].forEach(
      (type) => expect(servarCellRule('T', { type })).toBeUndefined()
    );
  });
});

describe('hiddenFieldCellRule', () => {
  test('types the cell by the hidden field’s stored value', () => {
    expect(hiddenFieldCellRule('N', 'number_value')).toEqual({
      label: 'N',
      type: 'number'
    });
    expect(hiddenFieldCellRule('B', 'boolean_value')).toEqual({
      label: 'B',
      type: 'boolean'
    });
    expect(hiddenFieldCellRule('T', 'text_value')).toBeUndefined();
  });
});

describe('fieldCellRules', () => {
  const column = (field_key: string, name: string) => ({
    name,
    field_id: `${field_key}-id`,
    field_type: 'servar',
    field_key
  });

  test('keys rules by column and skips what does not resolve', () => {
    const rules = fieldCellRules(
      [column('dob', 'Birthday'), column('n', 'Count'), column('gone', 'Old')],
      (col) =>
        col.field_key === 'dob'
          ? { kind: 'servar', type: 'date_selector' }
          : col.field_key === 'n'
          ? { kind: 'hidden', type: 'number_value' }
          : undefined
    );
    expect(rules).toEqual({
      dob: { label: 'Birthday', type: 'date' },
      n: { label: 'Count', type: 'number' }
    });
  });
});
