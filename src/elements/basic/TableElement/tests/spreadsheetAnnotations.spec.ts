import {
  annotationLayer,
  buildCellAnnotations,
  cellErrorLayer,
  countAnnotations,
  annotationRank,
  resolveTableAnnotations,
  TableAnnotation,
  TableRowRef
} from '../spreadsheet/annotations';

// Two hub columns stored under synthetic keys; a producer names them by their
// hub field keys.
const FIELD_KEYS = ['__hub_t_name', '__hub_t_email', '__hub_t_status_col'];
const HUB_KEYS: Record<string, string> = {
  name: '__hub_t_name',
  email: '__hub_t_email',
  status: '__hub_t_status_col'
};
const ENTRY_IDS = ['e0', 'e1', 'e2', 'e3'];
const ROW_KEYS = ['k0', 'k1', 'k2', 'k3'];

const context = (rowIndices = [0, 1, 2, 3]) => ({
  rowIndices,
  fieldKeys: FIELD_KEYS,
  resolveField: (name: string) => HUB_KEYS[name],
  resolveRow: (ref: TableRowRef) => {
    if ('rowIndex' in ref) return ref.rowIndex;
    const index =
      'entryId' in ref
        ? ENTRY_IDS.indexOf(ref.entryId)
        : ROW_KEYS.indexOf(ref.rowKey);
    return index === -1 ? undefined : index;
  }
});

describe('resolveTableAnnotations', () => {
  test('a cell annotation lands on exactly that cell, by index, entry id, or row key', () => {
    const annotations: TableAnnotation[] = [
      {
        target: { kind: 'cell', row: { rowIndex: 1 }, field: 'email' },
        message: 'Bounced last week'
      },
      {
        target: { kind: 'cell', row: { entryId: 'e3' }, field: 'name' },
        message: 'Does not match CRM'
      },
      {
        target: { kind: 'cell', row: { rowKey: 'k0' }, field: 'status' },
        message: 'Unknown status'
      }
    ];
    const { cells, unresolved } = resolveTableAnnotations(
      annotations,
      context(),
      'rule'
    );
    expect(Object.keys(cells).sort()).toEqual([
      '0:__hub_t_status_col',
      '1:__hub_t_email',
      '3:__hub_t_name'
    ]);
    expect(cells['1:__hub_t_email']).toEqual({
      message: 'Bounced last week',
      severity: 'error',
      source: 'rule'
    });
    expect(unresolved).toEqual([]);
  });

  test('a row key survives a row being inserted above it', () => {
    // The row that was at index 1 is now at index 2; its key is unchanged, so
    // the annotation follows the row rather than the position.
    const shifted = {
      ...context(),
      resolveRow: (ref: TableRowRef) =>
        'rowKey' in ref ? ['x', 'k0', 'k1'].indexOf(ref.rowKey) : undefined
    };
    const { cells } = resolveTableAnnotations(
      [
        {
          target: { kind: 'cell', row: { rowKey: 'k1' }, field: 'name' },
          message: 'Still wrong'
        }
      ],
      shifted,
      'rule'
    );
    expect(cells).toEqual({
      '2:__hub_t_name': {
        message: 'Still wrong',
        severity: 'error',
        source: 'rule'
      }
    });
  });

  test('a row annotation covers every rendered column of that row', () => {
    const { cells } = resolveTableAnnotations(
      [{ target: { kind: 'row', row: { entryId: 'e2' } }, message: 'Duplicate' }],
      context(),
      'rule'
    );
    expect(Object.keys(cells).sort()).toEqual(
      FIELD_KEYS.map((key) => `2:${key}`).sort()
    );
  });

  test('a range covers the block between its corners in display order', () => {
    const { cells } = resolveTableAnnotations(
      [
        {
          target: {
            kind: 'range',
            from: { row: { rowIndex: 2 }, field: 'name' },
            to: { row: { rowIndex: 1 }, field: 'email' }
          },
          message: 'Does not reconcile'
        }
      ],
      context([0, 1, 2, 3]),
      'rule'
    );
    expect(Object.keys(cells).sort()).toEqual([
      '1:__hub_t_email',
      '1:__hub_t_name',
      '2:__hub_t_email',
      '2:__hub_t_name'
    ]);
  });

  test('a severity given per annotation is carried onto every cell it covers', () => {
    const { cells } = resolveTableAnnotations(
      [
        {
          target: { kind: 'row', row: { rowIndex: 0 } },
          message: 'Looks unusual',
          severity: 'warning'
        }
      ],
      context(),
      'rule'
    );
    Object.values(cells).forEach((cell) =>
      expect(cell.severity).toBe('warning')
    );
  });

  test('an assistant annotation cannot raise itself to an error', () => {
    const { cells } = resolveTableAnnotations(
      [
        {
          target: { kind: 'cell', row: { rowIndex: 0 }, field: 'name' },
          message: 'I think this is wrong',
          severity: 'error'
        }
      ],
      context(),
      'assistant'
    );
    expect(cells['0:__hub_t_name'].severity).toBe('warning');
  });

  test('targets the table does not have are reported, not dropped silently', () => {
    const annotations: TableAnnotation[] = [
      {
        target: { kind: 'cell', row: { rowIndex: 9 }, field: 'name' },
        message: 'Off the end'
      },
      {
        target: { kind: 'cell', row: { rowIndex: 0 }, field: 'nope' },
        message: 'No such column'
      },
      {
        target: { kind: 'cell', row: { rowKey: 'gone' }, field: 'name' },
        message: 'Row was deleted'
      }
    ];
    const { cells, unresolved } = resolveTableAnnotations(
      annotations,
      context(),
      'rule'
    );
    expect(cells).toEqual({});
    expect(unresolved).toEqual(annotations);
  });

  test('the first annotation on a cell wins, so a producer controls its own order', () => {
    const { cells } = resolveTableAnnotations(
      [
        {
          target: { kind: 'cell', row: { rowIndex: 0 }, field: 'name' },
          message: 'First'
        },
        {
          target: { kind: 'row', row: { rowIndex: 0 } },
          message: 'Second'
        }
      ],
      context(),
      'rule'
    );
    expect(cells['0:__hub_t_name'].message).toBe('First');
  });
});

describe('buildCellAnnotations', () => {
  const verified = () => true;

  test('a rule error blocks; a rule warning does not', () => {
    const annotations = buildCellAnnotations({
      layers: [
        annotationLayer(
          [
            {
              target: { kind: 'cell', row: { rowIndex: 0 }, field: 'name' },
              message: 'Required'
            },
            {
              target: { kind: 'cell', row: { rowIndex: 1 }, field: 'name' },
              message: 'Unusual',
              severity: 'warning'
            }
          ],
          context(),
          'rule'
        )
      ],
      isRowVerified: verified
    });
    expect(annotations['0:__hub_t_name'].blocking).toBe(true);
    expect(annotations['1:__hub_t_name'].blocking).toBe(false);
  });

  test('an assistant finding never blocks', () => {
    const annotations = buildCellAnnotations({
      layers: [
        annotationLayer(
          [
            {
              target: { kind: 'cell', row: { rowIndex: 0 }, field: 'name' },
              message: 'Does not match the uploaded document'
            }
          ],
          context(),
          'assistant'
        )
      ],
      isRowVerified: verified
    });
    expect(annotations['0:__hub_t_name']).toMatchObject({
      severity: 'warning',
      blocking: false
    });
  });

  test('a hub rule error blocks on a verified row and only warns on a staged one', () => {
    const layers = [
      cellErrorLayer({ '0:__hub_t_name': 'Required', '1:__hub_t_name': 'Required' })
    ];
    const annotations = buildCellAnnotations({
      layers,
      isRowVerified: (rowIndex) => rowIndex === 0
    });
    expect(annotations['0:__hub_t_name'].blocking).toBe(true);
    expect(annotations['1:__hub_t_name'].blocking).toBe(false);
    expect(annotations['1:__hub_t_name'].severity).toBe('error');
  });

  test('the harder finding wins a cell two producers both named', () => {
    const annotations = buildCellAnnotations({
      layers: [
        annotationLayer(
          [
            {
              target: { kind: 'cell', row: { rowIndex: 0 }, field: 'name' },
              message: 'Assistant guess'
            }
          ],
          context(),
          'assistant'
        ),
        cellErrorLayer({ '0:__hub_t_name': 'Required' })
      ],
      isRowVerified: verified
    });
    expect(annotations['0:__hub_t_name']).toMatchObject({
      message: 'Required',
      source: 'hub_rule'
    });
  });

  test('a rule error outranks a hub warning on a staged row', () => {
    const annotations = buildCellAnnotations({
      layers: [
        cellErrorLayer({ '0:__hub_t_name': 'Required' }),
        annotationLayer(
          [
            {
              target: { kind: 'cell', row: { rowIndex: 0 }, field: 'name' },
              message: 'Must match the policy number'
            }
          ],
          context(),
          'rule'
        )
      ],
      isRowVerified: () => false
    });
    expect(annotations['0:__hub_t_name']).toMatchObject({
      message: 'Must match the policy number',
      source: 'rule',
      blocking: true
    });
  });
});

describe('countAnnotations', () => {
  test('counts each category separately', () => {
    const counts = countAnnotations({
      a: { message: 'x', source: 'rule', severity: 'error', blocking: true },
      b: { message: 'y', source: 'hub_rule', severity: 'error', blocking: false },
      c: { message: 'z', source: 'assistant', severity: 'warning', blocking: false }
    });
    expect(counts).toEqual({ blocking: 1, errors: 1, warnings: 1 });
  });
});

describe('annotationRank', () => {
  test('walks what blocks first, then errors, then warnings', () => {
    const ranks = [
      { message: '', source: 'assistant', severity: 'warning', blocking: false },
      { message: '', source: 'rule', severity: 'error', blocking: true },
      { message: '', source: 'hub_rule', severity: 'error', blocking: false }
    ] as const;
    expect(ranks.map(annotationRank)).toEqual([2, 0, 1]);
  });
});
