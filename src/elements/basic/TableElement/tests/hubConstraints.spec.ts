import {
  hubCellRules,
  mergeCellErrors,
  validateGrid
} from '../spreadsheet/validation';

const key = (name: string) => `__hub_table_${name}`;
const condition = (field_key: string, comparator: string, value = '') => ({
  field_key,
  comparator,
  value
});
const rule = {
  when: [condition('status', 'equal', 'Complete')],
  constraint: condition('value', 'is_filled'),
  error_message: 'Completion date is required'
};

function validate(
  rows: Record<string, any>[],
  rules = [rule],
  dependencyType = 'text',
  staged = false
) {
  const fields = [
    { key: 'completed', type: 'text', constraint_rules: rules },
    { key: 'status', type: dependencyType }
  ];
  const columns = [
    {
      name: 'Completed',
      hub_field_key: 'completed',
      field_key: key('completed')
    }
  ];
  return validateGrid({
    rowIndices: rows.map((_, index) => index),
    fieldKeys: [key('completed')],
    getValue: (rowIndex, fieldKey) => rows[rowIndex][fieldKey],
    rules: hubCellRules(columns, fields, key),
    isRowStaged: () => staged
  });
}

const row = (status: any, completed: any = '') => ({
  [key('status')]: status,
  [key('completed')]: completed
});
const errorKey = `0:${key('completed')}`;

describe('Hub conditional cell constraints', () => {
  test('a hidden field can activate a visible owner constraint', () => {
    expect(validate([row('Complete')])).toEqual({
      [errorKey]: rule.error_message
    });
    expect(validate([row('Pending')])).toEqual({});
  });

  test('revalidates the complete buffered row when dependencies or owner change', () => {
    expect(validate([row('Complete')])).toHaveProperty(errorKey);
    expect(validate([row('Complete', '2026-09-17')])).toEqual({});
    expect(validate([row('Pending')])).toEqual({});
  });

  test('ANDs when conditions and attributes errors to the rule owner', () => {
    const crossField = {
      ...rule,
      when: [
        condition('status', 'is_filled'),
        condition('value', 'equal', 'yes')
      ],
      constraint: condition('status', 'equal', 'Complete')
    };
    expect(validate([row('Pending', 'no')], [crossField])).toEqual({});
    expect(validate([row('Pending', 'yes')], [crossField])).toEqual({
      [errorKey]: rule.error_message
    });
  });

  test('empty when applies unconditionally and uses the backend fallback message', () => {
    expect(
      validate([row('Pending')], [{ ...rule, when: [], error_message: '' }])
    ).toEqual({
      [errorKey]: 'Field `completed` failed a constraint rule'
    });
  });

  test('reports the first failing rule and keeps row errors independent', () => {
    expect(
      validate(
        [row('Complete'), row('Pending'), row('Complete')],
        [rule, { ...rule, error_message: 'Second' }]
      )
    ).toEqual({
      [errorKey]: rule.error_message,
      [`2:${key('completed')}`]: rule.error_message
    });
  });

  test('staged rows still show their constraint errors', () => {
    expect(validate([row('Complete')], [rule], 'text', true)).toEqual({
      [errorKey]: rule.error_message
    });
  });

  test.each([
    ['text', 'equal', 'Ready', 'Ready'],
    ['text', 'not_equal', 'Ready', 'Pending'],
    ['text', 'contains', 'Ready now', 'READY'],
    ['text', 'not_contains', 'Ready now', 'later'],
    ['text', 'starts_with', 'Ready now', 'READY'],
    ['text', 'ends_with', 'Ready now', 'NOW'],
    ['number', 'greater_than', '12', '2'],
    ['number', 'greater_than_or_equal', 12, '12'],
    ['number', 'less_than', 2, '12'],
    ['number', 'less_than_or_equal', 2, '2'],
    ['boolean', 'equal', false, 'false'],
    ['boolean', 'equal', 'true', 'true'],
    ['date', 'equal', '2026-09-17', '2026-09-17'],
    ['datetime', 'equal', '2026-09-17T10:00:00', '2026-09-17T10:00:00Z'],
    ['any', 'is_empty', [], ''],
    ['number', 'is_filled', 0, ''],
    ['boolean', 'is_filled', false, '']
  ])('matches %s %s conditions', (type, comparator, actual, expected) => {
    const typedRule = {
      ...rule,
      when: [condition('status', comparator as string, expected as string)]
    };
    expect(validate([row(actual)], [typedRule], type as string)).toEqual({
      [errorKey]: rule.error_message
    });
  });

  test('empty values do not satisfy a not_equal comparison', () => {
    const when = [condition('status', 'not_equal', 'Complete')];
    expect(validate([row(null)], [{ ...rule, when }])).toEqual({});
  });

  test('the right hand side remains a literal even if it names another column', () => {
    const constraint = condition('value', 'equal', 'status');
    expect(
      validate([row('Complete', 'Complete')], [{ ...rule, constraint }])
    ).toEqual({ [errorKey]: rule.error_message });
    expect(
      validate([row('Complete', 'status')], [{ ...rule, constraint }])
    ).toEqual({});
  });
});

test('accepts numeric literal values returned by the Hub schema', () => {
  const numericRule = {
    ...rule,
    when: [{ field_key: 'status', comparator: 'greater_than', value: 18 }]
  };
  expect(validate([row(20)], [numericRule] as any, 'number')).toEqual({
    [errorKey]: rule.error_message
  });
});

test('preserves unrelated server errors while a conditional error is corrected', () => {
  const rules = hubCellRules(
    [
      {
        name: 'Completed',
        hub_field_key: 'completed',
        field_key: key('completed')
      }
    ],
    [
      { key: 'completed', type: 'text', constraint_rules: [rule] },
      { key: 'status', type: 'text' }
    ],
    key
  );
  const serverErrors = {
    [`0:${key('status')}`]: rule.error_message,
    [`1:${key('status')}`]: rule.error_message,
    [`0:${key('other')}`]: 'Must be unique'
  };
  expect(
    mergeCellErrors(
      serverErrors,
      {},
      rules,
      (index, fieldKey) => index === 0 && fieldKey === key('completed')
    )
  ).toEqual({
    [`1:${key('status')}`]: rule.error_message,
    [`0:${key('other')}`]: 'Must be unique'
  });
  expect(mergeCellErrors(serverErrors, {}, rules, () => false)).toEqual(
    serverErrors
  );
});

test.each([
  ['number', 'not a number', '2'],
  ['number', '12', ''],
  ['date', 'not a date', '2026-09-17'],
  ['boolean', 'maybe', 'true']
])('invalid %s comparisons do not activate a rule', (type, actual, value) => {
  expect(
    validate(
      [row(actual)],
      [{ ...rule, when: [condition('status', 'equal', value)] }],
      type
    )
  ).toEqual({});
});

test('an unknown comparator does not satisfy a when condition', () => {
  expect(
    validate(
      [row('Complete')],
      [{ ...rule, when: [condition('status', 'unknown')] }]
    )
  ).toEqual({});
});
