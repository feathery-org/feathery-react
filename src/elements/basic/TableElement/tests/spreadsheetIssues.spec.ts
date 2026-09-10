import {
  buildCellIssues,
  countIssues,
  issueRank,
  resolveTableIssues,
  TableIssue,
  TableRowRef
} from '../spreadsheet/issues';

// Two hub columns stored under synthetic keys; the assistant names them by
// their hub field keys.
const FIELD_KEYS = ['__hub_t_name', '__hub_t_email', '__hub_t_status_col'];
const HUB_KEYS: Record<string, string> = {
  name: '__hub_t_name',
  email: '__hub_t_email',
  status: '__hub_t_status_col'
};
const ENTRY_IDS = ['e0', 'e1', 'e2', 'e3'];

const context = (rowIndices = [0, 1, 2, 3]) => ({
  rowIndices,
  fieldKeys: FIELD_KEYS,
  resolveField: (name: string) => HUB_KEYS[name],
  resolveRow: (ref: TableRowRef) =>
    'rowIndex' in ref
      ? ref.rowIndex
      : ENTRY_IDS.indexOf(ref.entryId) === -1
      ? undefined
      : ENTRY_IDS.indexOf(ref.entryId)
});

describe('resolveTableIssues', () => {
  test('a cell issue lands on exactly that cell, by row index or entry id', () => {
    const issues: TableIssue[] = [
      {
        target: { kind: 'cell', row: { rowIndex: 1 }, field: 'email' },
        message: 'Bounced last week'
      },
      {
        target: { kind: 'cell', row: { entryId: 'e3' }, field: 'name' },
        message: 'Does not match CRM'
      }
    ];
    const { cells, unresolved } = resolveTableIssues(issues, context());
    expect(cells).toEqual({
      '1:__hub_t_email': 'Bounced last week',
      '3:__hub_t_name': 'Does not match CRM'
    });
    expect(unresolved).toEqual([]);
  });

  test('a row issue covers every rendered column of that row', () => {
    const { cells } = resolveTableIssues(
      [{ target: { kind: 'row', row: { entryId: 'e2' } }, message: 'Duplicate' }],
      context()
    );
    expect(Object.keys(cells).sort()).toEqual(
      FIELD_KEYS.map((key) => `2:${key}`).sort()
    );
    expect(Object.values(cells)).toEqual(['Duplicate', 'Duplicate', 'Duplicate']);
  });

  test('a range covers the block between its corners in display order', () => {
    // Rows are displayed 3,2,1,0 (sorted descending); the range from source row
    // 2 to source row 0 covers display positions 1..3 = source rows 2,1,0.
    const { cells } = resolveTableIssues(
      [
        {
          target: {
            kind: 'range',
            from: { row: { rowIndex: 0 }, field: 'email' },
            to: { row: { rowIndex: 2 }, field: 'name' }
          },
          message: 'Imported from the wrong sheet'
        }
      ],
      context([3, 2, 1, 0])
    );
    expect(Object.keys(cells).sort()).toEqual(
      [
        '0:__hub_t_name',
        '0:__hub_t_email',
        '1:__hub_t_name',
        '1:__hub_t_email',
        '2:__hub_t_name',
        '2:__hub_t_email'
      ].sort()
    );
  });

  test('issues naming unknown rows or fields are reported, not dropped silently', () => {
    const issues: TableIssue[] = [
      {
        target: { kind: 'cell', row: { entryId: 'nope' }, field: 'email' },
        message: 'x'
      },
      {
        target: { kind: 'cell', row: { rowIndex: 0 }, field: 'phone' },
        message: 'y'
      },
      // A row that is not rendered (deleted, filtered) is unresolved too.
      { target: { kind: 'row', row: { rowIndex: 3 } }, message: 'z' }
    ];
    const { cells, unresolved } = resolveTableIssues(issues, context([0, 1, 2]));
    expect(cells).toEqual({});
    expect(unresolved).toEqual(issues);
  });

  test('the first issue to name a cell keeps it', () => {
    const { cells } = resolveTableIssues(
      [
        { target: { kind: 'row', row: { rowIndex: 0 } }, message: 'first' },
        {
          target: { kind: 'cell', row: { rowIndex: 0 }, field: 'name' },
          message: 'second'
        }
      ],
      context()
    );
    expect(cells['0:__hub_t_name']).toBe('first');
  });
});

describe('buildCellIssues', () => {
  const verifiedRows = new Set([0]);
  const build = (ruleErrors = {}, assistantMessages = {}) =>
    buildCellIssues({
      ruleErrors,
      assistantMessages,
      isRowVerified: (rowIndex) => verifiedRows.has(rowIndex)
    });

  test('a hub rule error is always an error; it blocks only on a verified row', () => {
    const issues = build({ '0:a': 'Required', '1:a': 'Required' });
    expect(issues['0:a']).toEqual({
      message: 'Required',
      source: 'hub_rule',
      severity: 'error',
      blocking: true
    });
    expect(issues['1:a']).toEqual({
      message: 'Required',
      source: 'hub_rule',
      severity: 'error',
      blocking: false
    });
  });

  test('an assistant finding is always a non-blocking warning, even on a verified row', () => {
    const issues = build({}, { '0:a': 'Looks off' });
    expect(issues['0:a']).toEqual({
      message: 'Looks off',
      source: 'assistant',
      severity: 'warning',
      blocking: false
    });
  });

  test('a hub rule error wins over an assistant finding on the same cell', () => {
    const issues = build({ '1:a': 'Invalid email' }, { '1:a': 'Bounced' });
    expect(issues['1:a'].message).toBe('Invalid email');
    expect(issues['1:a'].source).toBe('hub_rule');
  });

  test('counts and stepper rank split the three categories', () => {
    const issues = build(
      { '0:a': 'Required', '1:a': 'Required', '1:b': 'Required' },
      { '0:b': 'Hm', '1:a': 'ignored: rule wins', '2:a': 'Hm' }
    );
    expect(countIssues(issues)).toEqual({
      blocking: 1,
      errors: 2,
      warnings: 2
    });
    expect(issueRank(issues['0:a'])).toBe(0);
    expect(issueRank(issues['1:a'])).toBe(1);
    expect(issueRank(issues['0:b'])).toBe(2);
  });
});
