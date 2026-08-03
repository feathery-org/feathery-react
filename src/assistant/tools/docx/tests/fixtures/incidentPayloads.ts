type RecordedOpOverrides = Record<string, unknown>;

// The service expands every operation to this shape before logging it. Keeping
// the shared defaults here makes the replay fixtures small while preserving the
// exact runtime payload values. `_failureGuard` is transport metadata, not part
// of applyDocumentEdits' change-set input, so it is intentionally excluded.
const recordedOp = (
  op: string,
  anchor: string,
  group: string,
  overrides: RecordedOpOverrides = {}
) => ({
  op,
  anchor,
  group,
  find: '',
  replace: '',
  text: '',
  startOffset: '',
  endOffset: '',
  expectLength: 0,
  above: false,
  count: 1,
  preserveBanding: true,
  rows: 1,
  columns: 1,
  shading: '',
  verticalAlignment: 'Top',
  borders: 'AllBorders',
  borderColor: '',
  borderWidth: 0,
  borderStyle: 'Single',
  isHeader: false,
  sourceTable: '',
  fromRow: 0,
  formula: `[${anchor}]`,
  label: '',
  round: 'half_up',
  decimals: 0,
  startRow: 0,
  endRow: 0,
  literal: false,
  force: false,
  alignment: 'Left',
  expect: '',
  start: 0,
  end: 0,
  ...overrides
});

// Source: ai-full.log:9878.
export const incidentAChangeSet = {
  changeSetId: 'insert-placeholder-table-after-premium-summary-20260803',
  plan: 'Insert a 3 by 4 table after the Premium Summary section using blank placeholders so it appears empty.',
  edits: [
    recordedOp('insert_table', '6;32', 'g01-insert-table', {
      rows: 3,
      columns: 4,
      expect: 'Billing Options'
    }),
    ...Array.from({ length: 3 }, (_, row) =>
      Array.from({ length: 4 }, (_, column) => {
        const anchor = `6;32;${row};${column};0`;
        return recordedOp('set_cell_text', anchor, 'g01-insert-table', {
          text: '\u00a0'
        });
      })
    ).flat()
  ]
};

// Source: ai-full.log:10609.
export const incidentCChangeSet = {
  changeSetId: 'premium-summary-add-cyber-row-20260803a',
  plan: 'The annual premium depends on the row values, so I’m filling the missing Professional Liability amounts and adding the Cyber Liability row before recomputing the total.',
  edits: [
    recordedOp('replace_text', '6;28;4;4;0', 'g01-fill-pl-row', {
      find: '$',
      replace: '$3,863.00',
      expect: '$',
      end: 1
    }),
    recordedOp('replace_text', '6;28;4;5;0', 'g01-fill-pl-row', {
      find: '$',
      replace: '$3,863.00',
      expect: '$',
      end: 1
    }),
    recordedOp('insert_row', '6;28;4;0;0', 'g02-add-cyber-row', {
      expect: 'Professional Liability',
      end: 22
    }),
    recordedOp('set_cell_text', '6;28;5;0;0', 'g02-add-cyber-row', {
      text: 'Cyber Liability'
    }),
    recordedOp('set_cell_text', '6;28;5;4;0', 'g02-add-cyber-row', {
      text: '80022',
      literal: true
    }),
    recordedOp('set_cell_text', '6;28;5;5;0', 'g02-add-cyber-row', {
      text: '80022',
      literal: true
    })
  ]
};

const duplicateTableCells = (tableAnchor: string) => {
  const values = [
    ['Coverage', 'Limit', 'Retention / Deductible'],
    ['Jobrish Blorfle', 'Snorple 88', 'Wizzlefrop 5'],
    ['Glibber Mashline', 'Plonkit 42', 'Zabblewink 12']
  ];
  return values.flatMap((row, rowIndex) =>
    row.map((text, columnIndex) => {
      const anchor = `${tableAnchor};${rowIndex};${columnIndex};0`;
      return recordedOp(
        'set_cell_text',
        anchor,
        'g01-add-duplicate-cyber-table',
        { text }
      );
    })
  );
};

// Sources: ai-full.log:10733, :10754, :10775, and :10796 respectively.
export const incidentDChangeSets = {
  a: {
    changeSetId: 'cyber-coverage-insert-duplicate-table-20260803a',
    plan: 'Add a new table below the Cyber Insurance coverages table with the same three-column layout and two data rows.',
    edits: [
      recordedOp('insert_table', '6;20', 'g01-insert-new-cyber-table', {
        rows: 3,
        columns: 3,
        expect: '  ',
        end: 2
      })
    ]
  },
  b: {
    changeSetId: 'cyber-coverage-insert-duplicate-table-20260803b',
    plan: 'Add a duplicate three-column table below the Cyber Insurance Coverages and Limits table, with the same headers and two gibberish data rows.',
    edits: [
      recordedOp('insert_table', '6;20', 'g01-add-duplicate-cyber-table', {
        rows: 3,
        columns: 3,
        expect: '  ',
        end: 2
      }),
      ...duplicateTableCells('6;20'),
      recordedOp('copy_table_format', '6;20', 'g01-add-duplicate-cyber-table', {
        sourceTable: '6;19'
      })
    ]
  },
  c: {
    changeSetId: 'cyber-coverage-insert-duplicate-table-20260803c',
    plan: 'Add a new three-column table directly below the Cyber Insurance Coverages and Limits table, with matching headers and two gibberish data rows.',
    edits: [
      recordedOp(
        'insert_table',
        '6;19;10;2;0',
        'g01-add-duplicate-cyber-table',
        { rows: 3, columns: 3, expect: '$5,000', end: 6 }
      ),
      ...duplicateTableCells('6;20')
    ]
  },
  d: {
    changeSetId: 'cyber-coverage-insert-duplicate-table-20260803d',
    plan: 'Add a new three-column table below the Cyber Insurance Coverages and Limits table, with the same headers and two gibberish data rows.',
    edits: [
      recordedOp('insert_table', '6;20', 'g01-add-duplicate-cyber-table', {
        rows: 3,
        columns: 3
      }),
      ...duplicateTableCells('6;21')
    ]
  }
};
