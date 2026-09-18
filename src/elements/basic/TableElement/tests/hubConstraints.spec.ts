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
    ['file', 'is_empty', [], ''],
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
    [`0:${key('status')}`]: 'Server wording differs from the live rule',
    [`1:${key('status')}`]: 'Server wording differs from the live rule',
    [`0:${key('other')}`]: 'Must be unique'
  };
  const constraintErrors = {
    [`0:${key('status')}`]: { field_key: 'completed', rule_index: 0 },
    [`1:${key('status')}`]: { field_key: 'completed', rule_index: 0 }
  };
  expect(
    mergeCellErrors(
      serverErrors,
      {},
      rules,
      (index, fieldKey) => index === 0 && fieldKey === key('completed'),
      constraintErrors
    )
  ).toEqual({
    [`1:${key('status')}`]: 'Server wording differs from the live rule',
    [`0:${key('other')}`]: 'Must be unique'
  });
  expect(
    mergeCellErrors(serverErrors, {}, rules, () => false, constraintErrors)
  ).toEqual(serverErrors);
});

test('does not clear another rule or an unclassified error with identical text', () => {
  const otherRule = {
    ...rule,
    when: [condition('other', 'equal', 'Complete')]
  };
  const rules = hubCellRules(
    ['completed', 'other_owner'].map((name) => ({
      name,
      hub_field_key: name,
      field_key: key(name)
    })),
    [
      { key: 'completed', type: 'text', constraint_rules: [rule] },
      { key: 'other_owner', type: 'text', constraint_rules: [otherRule] },
      { key: 'status', type: 'text' },
      { key: 'other', type: 'text' }
    ],
    key
  );
  const serverErrors = {
    [`0:${key('status')}`]: rule.error_message,
    [`0:${key('other')}`]: rule.error_message,
    [`0:${key('unclassified')}`]: rule.error_message
  };
  expect(
    mergeCellErrors(
      serverErrors,
      {},
      rules,
      (_, fieldKey) => fieldKey === key('status'),
      {
        [`0:${key('status')}`]: { field_key: 'completed', rule_index: 0 },
        [`0:${key('other')}`]: { field_key: 'other_owner', rule_index: 0 }
      }
    )
  ).toEqual({
    [`0:${key('other')}`]: rule.error_message,
    [`0:${key('unclassified')}`]: rule.error_message
  });
});

describe('Hub condition literal semantics', () => {
  test.each([
    [true, 'true', true],
    [false, 'false', true],
    [true, 'TRUE', true],
    [false, 'FALSE', true],
    [true, '1', true],
    [false, '0', true],
    [true, 'yes', false],
    [false, 'yes', true],
    [true, 'y', false],
    [false, 'Y', true],
    [true, ' true ', false],
    [false, ' TRUE ', true],
    [' YES ', 'true', true],
    [' Y ', 'TRUE', true],
    [' NO ', 'false', true],
    [' N ', 'FALSE', true],
    [' T ', 'true', true],
    [' F ', 'false', true]
  ])('boolean %p equals literal %p: %p', (actual, literal, matches) => {
    const constraint = condition('status', 'equal', literal as string);
    expect(
      validate([row(actual)], [{ ...rule, when: [], constraint }], 'boolean')
    ).toEqual(matches ? {} : { [errorKey]: rule.error_message });
  });

  test.each([
    ['2026-09-17', true],
    ['2026-09-17T00:00:00Z', true],
    ['2026-09-17T10:00:00Z', false],
    ['2026-09-17T02:00:00+02:00', true],
    ['2026-09-16T20:00:00-04:00', true],
    ['2026-09-17T00:00:00+02:00', false]
  ])('date compares the full literal timestamp %s: %p', (literal, matches) => {
    const constraint = condition('status', 'equal', literal as string);
    expect(
      validate(
        [row('2026-09-17T10:00:00-04:00')],
        [{ ...rule, when: [], constraint }],
        'date'
      )
    ).toEqual(matches ? {} : { [errorKey]: rule.error_message });
  });
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

describe('Hub string comparisons for structured values', () => {
  const files = [
    { url: 'https://example.com/invoice.pdf', path: 'invoice.pdf' }
  ];

  test.each([
    ['any', true, 'equal', 'True'],
    ['any', false, 'equal', 'False'],
    [
      'any',
      { enabled: true, items: [false, null, 2] },
      'equal',
      '{"enabled": true, "items": [false, null, 2]}'
    ],
    ['any', [true, { enabled: false }], 'equal', '[true, {"enabled": false}]'],
    ['any', { text: 'a,b:c' }, 'equal', '{"text": "a,b:c"}'],
    ['any', { text: 'a"b\\c\nd' }, 'equal', '{"text": "a\\"b\\\\c\\nd"}'],
    [
      'any',
      { text: 'café 🧾' },
      'equal',
      '{"text": "caf\\u00e9 \\ud83e\\uddfe"}'
    ],
    ['any', [], 'equal', '[]'],
    ['any', {}, 'equal', '{}'],
    ['any', [], 'is_filled', ''],
    ['file', files, 'contains', 'invoice.pdf'],
    ['file', files, 'not_contains', 'missing.pdf'],
    ['file', files, 'starts_with', "[{'url': 'https://example.com/"],
    ['file', files, 'ends_with', "'path': 'invoice.pdf'}]"],
    [
      'file',
      files,
      'equal',
      "[{'url': 'https://example.com/invoice.pdf', 'path': 'invoice.pdf'}]"
    ],
    [
      'file',
      [{ path: "customer's invoice.pdf" }],
      'equal',
      `[{\u0027path\u0027: "customer's invoice.pdf"}]`
    ],
    ['file', [{ path: 'a\\b\nc.pdf' }], 'contains', 'a\\\\b\\nc.pdf'],
    [
      'file',
      [{ path: 'invoice\u00a0final.pdf' }],
      'contains',
      'invoice\\xa0final.pdf'
    ],
    [
      'file',
      [{ path: 'invoice\u200bfinal.pdf' }],
      'contains',
      'invoice\\u200bfinal.pdf'
    ],
    [
      'file',
      [{ path: 'invoice\u{e0001}.pdf' }],
      'contains',
      'invoice\\U000e0001.pdf'
    ],
    ['file', [{ path: 'café 🧾.pdf' }], 'equal', "[{'path': 'café 🧾.pdf'}]"]
  ])('matches the server for %s %p %s', (type, actual, comparator, value) => {
    const constraint = condition(
      'status',
      comparator as string,
      value as string
    );
    expect(
      validate(
        [row(actual)],
        [{ ...rule, when: [], constraint }],
        type as string
      )
    ).toEqual({});
    expect(
      validate([row(actual)], [{ ...rule, when: [constraint] }], type as string)
    ).toEqual({ [errorKey]: rule.error_message });
  });

  test('a filename mismatch still fails the constraint', () => {
    expect(
      validate(
        [row(files)],
        [
          {
            ...rule,
            when: [],
            constraint: condition('status', 'contains', 'missing.pdf')
          }
        ],
        'file'
      )
    ).toEqual({ [errorKey]: rule.error_message });
  });
});
