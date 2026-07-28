// Column-wise recompute, the no-op write rule in the live write path, and the
// announced dependency chain - all over the REAL route: a real DocumentEditor,
// through applyDocumentEdits, under the engine's forced track-changes.
//
// The three live findings this file pins, in the captain's words:
//
//   1. "I watched 0.00 be rewritten as 0.00 and appear as a tracked change."
//      A write identical to what is there must produce NO revision at all.
//      Identical means value AND rendered format: $0.00 -> $0.00 is a skip,
//      $0.00 -> 0.00 is a genuine change.
//   2. Robin picked row ranges and got them wrong - sum(rows 1..3) for one
//      column and sum(rows 1..4) for the column beside it, same table, same
//      turn. A whole-column recompute removes the guess; the no-op rule is what
//      makes running it over every row safe.
//   3. Following a dependency chain is right; following it SILENTLY is worse
//      than not following it. A batch that moves more than one column of one
//      table cannot land without an announcement.
import 'jest-canvas-mock';
import {
  DocumentEditor,
  Editor,
  EditorHistory,
  ImageResizer,
  Search,
  Selection,
  SfdtExport
} from '@syncfusion/ej2-documenteditor';
import {
  applyDocumentEdits,
  ApplyEditsResult,
  EditOp,
  flattenSfdt,
  LiveEditor
} from '../syncfusionDocumentOps';

DocumentEditor.Inject(
  Editor,
  Selection,
  SfdtExport,
  EditorHistory,
  ImageResizer,
  Search
);

if (!window.crypto?.getRandomValues) {
  Object.defineProperty(window, 'crypto', {
    value: {
      getRandomValues: (array: Uint8Array) =>
        require('crypto').randomFillSync(array)
    }
  });
}

const jsdomGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = ((elt: Element) =>
  jsdomGetComputedStyle(elt)) as typeof window.getComputedStyle;

if (!(window.SVGElement.prototype as any).getBBox) {
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);
}

function makeRealDocumentEditor(sfdt: any): DocumentEditor {
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '700px';
  document.body.appendChild(host);
  const editor = new DocumentEditor({
    isReadOnly: false,
    enableEditor: true,
    enableSelection: true,
    enableImageResizer: true,
    enableSearch: true,
    enableSfdtExport: true,
    enableEditorHistory: true
  });
  editor.appendTo(host);
  editor.open(JSON.stringify(sfdt));
  editor.enableTrackChanges = true;
  return editor;
}

function destroyRealDocumentEditor(editor: DocumentEditor): void {
  const element = editor.element;
  editor.destroy();
  element?.remove();
}

function rejectEveryRealRevision(editor: DocumentEditor): void {
  const revisions = Array.from({ length: editor.revisions.length }, (_, i) =>
    editor.revisions.get(i)
  );
  for (const revision of revisions) revision.reject();
}

const cellOf = (
  text: string,
  options: { bold?: boolean; columnSpan?: number } = {}
) => ({
  cellFormat: {
    ...(options.columnSpan ? { columnSpan: options.columnSpan } : {})
  },
  blocks: [
    {
      inlines: [
        { text, ...(options.bold ? { characterFormat: { bold: true } } : {}) }
      ]
    }
  ]
});
const para = (text: string) => ({ inlines: [{ text }] });
const rowOf = (cells: any[]) => ({ rowFormat: {}, cells });
const textRow = (...texts: string[]) => rowOf(texts.map((t) => cellOf(t)));
const boldRow = (...texts: string[]) =>
  rowOf(texts.map((t) => cellOf(t, { bold: true })));

const cellTextAt = (editor: DocumentEditor, anchor: string) =>
  flattenSfdt(JSON.parse(editor.serialize())).find(
    (block) => block.anchor === anchor
  )?.text;

/** Every table-cell anchor whose text differs between two serializations. */
function changedCells(before: string, after: string): string[] {
  const byAnchor = (sfdt: string) =>
    new Map(
      flattenSfdt(JSON.parse(sfdt)).map((block) => [block.anchor, block.text])
    );
  const first = byAnchor(before);
  const second = byAnchor(after);
  const moved: string[] = [];
  for (const [anchor, text] of Array.from(second.entries()))
    if (first.get(anchor) !== text) moved.push(anchor);
  return moved.sort();
}

const run = (editor: DocumentEditor, input: Parameters<typeof applyDocumentEdits>[1]) =>
  applyDocumentEdits(editor as unknown as LiveEditor, input);

jest.setTimeout(240000);

// Coverage | Premium | Tax. Row 3's tax is already right; rows 1 and 2 are
// stale. Row 0 is a header, so its "premium" is the word Premium.
const scheduleSfdt = (overrides: Record<string, string> = {}) => ({
  sections: [
    {
      blocks: [
        para('Schedule'),
        {
          tableFormat: {},
          rows: [
            textRow('Coverage', 'Premium', 'Tax'),
            textRow(
              'General Liability',
              '$1,000.00',
              overrides.tax1 ?? '$0.00'
            ),
            textRow('Property', '$2,000.00', overrides.tax2 ?? '$99.00'),
            textRow('Auto', '$3,000.00', overrides.tax3 ?? '$390.00'),
            textRow('Total', '$6,000.00', overrides.taxTotal ?? '$780.00')
          ]
        },
        para('End')
      ]
    }
  ]
});

// The irregular schedule from table_facts, verbatim in shape: a merged title
// banner, two stacked header rows, blank separators, mid-table section labels,
// a bold regional subtotal, a grand total and a short row. Every tax cell is
// exactly 13% of its premium, so a recompute over the WHOLE table is - and must
// be - a complete no-op.
const irregularSfdt = (overrides: Record<number, string> = {}) => ({
  sections: [
    {
      blocks: [
        para('Property Schedule'),
        {
          tableFormat: {},
          rows: [
            rowOf([
              cellOf('2026 Property Schedule', { bold: true, columnSpan: 4 }),
              cellOf(''),
              cellOf(''),
              cellOf('')
            ]),
            boldRow('Location', 'Address', 'Premium', 'Tax'),
            boldRow('', '', '(USD)', '(USD)'),
            textRow('', '', '', ''),
            textRow('Region A', '', '', ''),
            textRow(
              '0093',
              '1 King St W',
              '$36,803.00',
              overrides[5] ?? '$4,784.39'
            ),
            textRow(
              '0094',
              '94 Main St',
              '$12,450.00',
              overrides[6] ?? '$1,618.50'
            ),
            boldRow(
              'Region A subtotal',
              '',
              '$49,253.00',
              overrides[7] ?? '$6,402.89'
            ),
            textRow('', '', '', ''),
            textRow('Region B', '', '', ''),
            textRow('0101', '7 Bay St', '$4,000.00', overrides[10] ?? '$520.00'),
            boldRow('Total', '', '$53,253.00', overrides[11] ?? '$6,922.89'),
            rowOf([cellOf('Premiums exclude surplus lines tax.'), cellOf('')])
          ]
        },
        para('End')
      ]
    }
  ]
});

// ---------------------------------------------------------------------------
// 1. A no-op write must not produce a tracked change - universally.
// ---------------------------------------------------------------------------

describe('the no-op rule in the write path', () => {
  const noOpCase = (
    what: string,
    fixture: () => any,
    edit: EditOp,
    expected: { anchor: string; text: string }
  ) =>
    it(`real SDK: ${what} writes nothing, creates no revision, and leaves the document byte-identical`, () => {
      const ed = makeRealDocumentEditor(fixture());
      try {
        const before = ed.serialize();
        const result = run(ed, { edits: [edit] });
        expect(result.results[0]).toMatchObject({ ok: true });
        expect(result.results[0].noOp).toMatchObject({
          anchor: expected.anchor,
          op: edit.op,
          text: expected.text,
          skipped: true
        });
        expect(result.changeSet).toMatchObject({
          status: 'applied',
          // No revision was created, so there is no card to group.
          revisionGrouping: 'no_revisions'
        });
        // The three things the captain actually cares about.
        expect(ed.revisions.length).toBe(0);
        expect(ed.serialize()).toBe(before);
      } finally {
        destroyRealDocumentEditor(ed);
      }
    });

  noOpCase(
    'set_cell_text with the text already there',
    () => scheduleSfdt(),
    { op: 'set_cell_text', anchor: '0;1;1;2;0', text: '$0.00' },
    { anchor: '0;1;1;2;0', text: '$0.00' }
  );

  noOpCase(
    'set_cell_text writing a label a cell already holds',
    () => scheduleSfdt(),
    { op: 'set_cell_text', anchor: '0;1;1;0;0', text: 'General Liability' },
    { anchor: '0;1;1;0;0', text: 'General Liability' }
  );

  noOpCase(
    'set_cell_formula recomputing a cell that is already correct',
    () => scheduleSfdt(),
    {
      op: 'set_cell_formula',
      anchor: '0;1;3;2;0',
      formula: '[0;1;3;1;0] * 13%',
      label: 'the Auto tax'
    },
    { anchor: '0;1;3;2;0', text: '$390.00' }
  );

  noOpCase(
    'replace_text replacing a string with itself',
    () => scheduleSfdt(),
    { op: 'replace_text', anchor: '0;0', find: 'Schedule', replace: 'Schedule' },
    { anchor: '0;0', text: 'Schedule' }
  );

  noOpCase(
    'replace_text overwriting a block with its own text',
    () => scheduleSfdt(),
    { op: 'replace_text', anchor: '0;0', replace: 'Schedule' },
    { anchor: '0;0', text: 'Schedule' }
  );

  noOpCase(
    'change_case on text that is already in that case',
    () => scheduleSfdt(),
    { op: 'change_case', anchor: '0;0', caseType: 'capitalize' },
    { anchor: '0;0', text: 'Schedule' }
  );

  noOpCase(
    'insert_text with nothing to insert',
    () => scheduleSfdt(),
    { op: 'insert_text', anchor: '0;0', text: '' },
    { anchor: '0;0', text: 'Schedule' }
  );

  it('real SDK: the skipped formula still reports what it resolved and read', () => {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      const result = run(ed, {
        edits: [
          {
            op: 'set_cell_formula',
            anchor: '0;1;3;2;0',
            formula: '[0;1;3;1;0] * 13%'
          }
        ]
      });
      expect(result.results[0].noOp?.receipt).toBe(
        'Nothing written at 0;1;3;2;0: the result of [0;1;3;1;0] * 13% ' +
          'already reads "$390.00", identical in value and format to what ' +
          'this op would have written. No revision and no change card were ' +
          'created.'
      );
      // Coverage is still stated: which cell was read, and what it held.
      expect(result.results[0].details).toEqual([
        'cell 0;1;3;1;0 (row 3, column 1) read "$3,000.00"'
      ]);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  // --- the other half of the rule: a FORMAT change is a real change ---------

  it.each([
    ['$0.00 -> 0.00 (currency symbol dropped)', '$0.00', '0.00'],
    ['$0.00 -> $0 (decimals dropped)', '$0.00', '$0'],
    ['$0.00 -> $0.000 (a decimal added)', '$0.00', '$0.000'],
    ['$0.00 -> ($0.00) (negative notation)', '$0.00', '($0.00)']
  ])(
    'real SDK: %s is written, not skipped - same number, different document',
    (_case, current, next) => {
      const ed = makeRealDocumentEditor(scheduleSfdt({ tax1: current }));
      try {
        const before = ed.serialize();
        const result = run(ed, {
          edits: [
            // `literal` is the user-dictated route; the point here is the
            // comparison, not the model-authored-number gate.
            {
              op: 'set_cell_text',
              anchor: '0;1;1;2;0',
              text: next,
              literal: true
            }
          ]
        });
        expect(result.results[0]).toMatchObject({ ok: true });
        expect(result.results[0].noOp).toBeUndefined();
        expect(cellTextAt(ed, '0;1;1;2;0')).toBe(next);
        expect(ed.revisions.length).toBeGreaterThan(0);
        // ...and it is still one rejectable change that restores every byte.
        rejectEveryRealRevision(ed);
        expect(ed.serialize()).toBe(before);
      } finally {
        destroyRealDocumentEditor(ed);
      }
    }
  );

  it('real SDK: a batch of one no-op and one real change produces exactly one change', () => {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      const before = ed.serialize();
      const result = run(ed, {
        edits: [
          // Already "General Liability": nothing happens.
          { op: 'set_cell_text', anchor: '0;1;1;0;0', text: 'General Liability' },
          // Genuinely different: one change.
          { op: 'set_cell_text', anchor: '0;1;2;0;0', text: 'Property (all risk)' }
        ]
      });
      expect(result.results.map((entry) => entry.ok)).toEqual([true, true]);
      expect(result.results[0].noOp).toBeDefined();
      expect(result.results[1].noOp).toBeUndefined();
      expect(changedCells(before, ed.serialize())).toEqual(['0;1;2;0;0']);
      rejectEveryRealRevision(ed);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Column-wise recompute.
// ---------------------------------------------------------------------------

describe('set_column_formula: recompute the column, write only what moved', () => {
  /**
   * How many SyncFusion revisions ONE tracked cell overwrite costs on this
   * fixture, measured rather than assumed, so the change-card arithmetic below
   * does not depend on the editor version.
   */
  function revisionsPerWrittenCell(): number {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      run(ed, {
        edits: [
          {
            op: 'set_column_formula',
            anchor: '0;1;1;2;0',
            formula: '[0;1;{row};1;0] * 13%',
            startRow: 1,
            endRow: 1
          }
        ]
      });
      return ed.revisions.length;
    } finally {
      destroyRealDocumentEditor(ed);
    }
  }

  it('real SDK: some rows change - the change cards are exactly the cells that moved', () => {
    const perCell = revisionsPerWrittenCell();
    expect(perCell).toBeGreaterThan(0);
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      const before = ed.serialize();
      const result = run(ed, {
        edits: [
          {
            op: 'set_column_formula',
            anchor: '0;1;1;2;0',
            formula: '[0;1;{row};1;0] * 13%',
            label: 'the Tax column at 13%'
          }
        ]
      });
      expect(result.results[0]).toMatchObject({ ok: true });
      const report = result.results[0].column!;
      expect(report).toMatchObject({
        formula: '[0;1;{row};1;0] * 13%',
        label: 'the Tax column at 13%',
        tableAnchor: '0;1',
        column: 2,
        startRow: 0,
        endRow: 4,
        wholeTable: true,
        rowsEvaluated: 5,
        rowsChanged: 2,
        rowsUnchanged: 2,
        rowsSkipped: 1,
        verifiedByReRead: true
      });
      // Every row is accounted for, by name.
      expect(report.rows.map((entry) => entry.outcome)).toEqual([
        'skipped', // row 0: the header cell says "Premium", not a number
        'written', // $0.00 -> $130.00
        'written', // $99.00 -> $260.00
        'unchanged', // $390.00 was already right
        'unchanged' // the total row: $6,000.00 x 13% is already $780.00
      ]);
      expect(cellTextAt(ed, '0;1;1;2;0')).toBe('$130.00');
      expect(cellTextAt(ed, '0;1;2;2;0')).toBe('$260.00');
      expect(cellTextAt(ed, '0;1;3;2;0')).toBe('$390.00');

      // THE ASSERTION THIS FEATURE EXISTS FOR: only the cells that actually
      // moved produced a change, and the count matches exactly.
      const moved = changedCells(before, ed.serialize());
      expect(moved).toEqual(['0;1;1;2;0', '0;1;2;2;0']);
      expect(moved.length).toBe(report.rowsChanged);
      expect(ed.revisions.length).toBe(report.rowsChanged * perCell);

      // One rejectable change set that restores every byte.
      rejectEveryRealRevision(ed);
      expect(ed.revisions.length).toBe(0);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: every row changes - all four data rows, no others', () => {
    const ed = makeRealDocumentEditor(
      scheduleSfdt({
        tax1: '$1.00',
        tax2: '$2.00',
        tax3: '$3.00',
        taxTotal: '$4.00'
      })
    );
    try {
      const before = ed.serialize();
      const result = run(ed, {
        edits: [
          {
            op: 'set_column_formula',
            anchor: '0;1;1;2;0',
            formula: '[0;1;{row};1;0] * 13%'
          }
        ]
      });
      const report = result.results[0].column!;
      expect(report).toMatchObject({
        rowsEvaluated: 5,
        rowsChanged: 4,
        rowsUnchanged: 0,
        rowsSkipped: 1
      });
      expect(changedCells(before, ed.serialize())).toEqual([
        '0;1;1;2;0',
        '0;1;2;2;0',
        '0;1;3;2;0',
        '0;1;4;2;0'
      ]);
      rejectEveryRealRevision(ed);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: nothing changes - no revision, no change card, byte-identical', () => {
    const ed = makeRealDocumentEditor(
      scheduleSfdt({ tax1: '$130.00', tax2: '$260.00' })
    );
    try {
      const before = ed.serialize();
      const result = run(ed, {
        edits: [
          {
            op: 'set_column_formula',
            anchor: '0;1;1;2;0',
            formula: '[0;1;{row};1;0] * 13%',
            label: 'the Tax column at 13%'
          }
        ]
      });
      const report = result.results[0].column!;
      expect(report).toMatchObject({
        rowsEvaluated: 5,
        rowsChanged: 0,
        rowsUnchanged: 4,
        rowsSkipped: 1
      });
      // A whole-column recompute over a correct column is reported as the
      // no-op it is, so the model says "already correct" not "recomputed".
      expect(result.results[0].noOp?.skipped).toBe(true);
      expect(result.changeSet).toMatchObject({
        status: 'applied',
        revisionGrouping: 'no_revisions'
      });
      expect(ed.revisions.length).toBe(0);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it("real SDK: the receipt states coverage first, then what moved - the captain's wording", () => {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      const result = run(ed, {
        edits: [
          {
            op: 'set_column_formula',
            anchor: '0;1;1;2;0',
            formula: '[0;1;{row};1;0] * 13%',
            label: 'the Tax column at 13%'
          }
        ]
      });
      const receipt = result.results[0].column!.receipt;
      expect(receipt).toContain(
        'Recomputed 5 rows of the Tax column at 13% ' +
          '(column 2 of the table at 0;1), 2 changed.'
      );
      expect(receipt).toContain(
        'evaluated over rows 0-4 (every row of the table): 2 written, ' +
          '2 already correct and left untouched, 1 skipped.'
      );
      // What moved, named cell by cell.
      expect(receipt).toContain('Changed: row 1 ("$0.00" -> "$130.00")');
      expect(receipt).toContain('row 2 ("$99.00" -> "$260.00")');
      // What could not be computed, named too - never silently zeroed.
      expect(receipt).toContain(
        'Skipped (no value could be computed): row 0 (cell_not_numeric)'
      );
      expect(receipt).toContain('the unchanged cells produced no revision');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: an explicit row span is honoured and reported as not-whole-table', () => {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      const before = ed.serialize();
      const result = run(ed, {
        edits: [
          {
            op: 'set_column_formula',
            anchor: '0;1;1;2;0',
            formula: '[0;1;{row};1;0] * 13%',
            startRow: 1,
            endRow: 3
          }
        ]
      });
      expect(result.results[0].column).toMatchObject({
        startRow: 1,
        endRow: 3,
        wholeTable: false,
        rowsEvaluated: 3,
        rowsChanged: 2,
        rowsSkipped: 0
      });
      // Row 4 (the total row) was outside the span, so it did not move.
      expect(changedCells(before, ed.serialize())).toEqual([
        '0;1;1;2;0',
        '0;1;2;2;0'
      ]);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  const refusalCase = (
    what: string,
    edit: EditOp,
    code: string,
    messageContains: string
  ) =>
    it(`real SDK: ${what} is refused and the document stays byte-identical`, () => {
      const ed = makeRealDocumentEditor(scheduleSfdt());
      try {
        const before = ed.serialize();
        const result = run(ed, { edits: [edit] });
        expect(result.results[0]).toMatchObject({ ok: false, error: code });
        expect(result.results[0].message).toContain(messageContains);
        expect(ed.revisions.length).toBe(0);
        expect(ed.serialize()).toBe(before);
      } finally {
        destroyRealDocumentEditor(ed);
      }
    });

  refusalCase(
    'a formula that does not mention {row}',
    {
      op: 'set_column_formula',
      anchor: '0;1;1;2;0',
      formula: '[0;1;1;1;0] * 13%'
    },
    'row_invariant_column_formula',
    'would write the same value into every row'
  );

  refusalCase(
    'a row span that runs past the last row',
    {
      op: 'set_column_formula',
      anchor: '0;1;1;2;0',
      formula: '[0;1;{row};1;0] * 13%',
      startRow: 1,
      endRow: 40
    },
    'reference_not_found',
    'has 5 rows (0-4); the requested span ends at row 40'
  );

  refusalCase(
    'a reversed row span',
    {
      op: 'set_column_formula',
      anchor: '0;1;1;2;0',
      formula: '[0;1;{row};1;0] * 13%',
      startRow: 3,
      endRow: 1
    },
    'bad_row_bound',
    '`endRow` (1) is before `startRow` (3)'
  );

  refusalCase(
    'a rounding decision the model did not make',
    {
      op: 'set_column_formula',
      anchor: '0;1;1;2;0',
      // A third of the tax: 1,000 x 13% / 3 = 43.3333..., which does not fit
      // the cell's two decimals, so the engine refuses rather than trimming.
      formula: '[0;1;{row};1;0] * 13% / 3'
    },
    'rounding_required',
    'Row 1 of the column recompute'
  );

  refusalCase(
    'a body paragraph instead of a table cell',
    {
      op: 'set_column_formula',
      anchor: '0;0',
      formula: '[0;1;{row};1;0] * 13%'
    },
    'not_a_table_cell',
    'must anchor ANY cell of the column to recompute'
  );

  it('real SDK: a column recompute whose formula aggregates its own column is refused as circular', () => {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      const before = ed.serialize();
      const result = run(ed, {
        edits: [
          {
            op: 'set_column_formula',
            anchor: '0;1;1;2;0',
            formula: 'sum([0;1;{row}..4;2])'
          }
        ]
      });
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'circular_reference'
      });
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The irregular table: the bounds really do stop mattering.
// ---------------------------------------------------------------------------

describe('an irregular schedule (merged banner, stacked headers, separators, section labels, subtotals, a short row)', () => {
  it('real SDK: recomputing the WHOLE table writes nothing when every tax is already right', () => {
    const ed = makeRealDocumentEditor(irregularSfdt());
    try {
      const before = ed.serialize();
      const result = run(ed, {
        edits: [
          {
            op: 'set_column_formula',
            anchor: '0;1;5;3;0',
            formula: '[0;1;{row};2;0] * 13%',
            label: 'the Tax column at 13%'
          }
        ]
      });
      const report = result.results[0].column!;
      expect(report).toMatchObject({
        startRow: 0,
        endRow: 12,
        wholeTable: true,
        rowsEvaluated: 13,
        rowsChanged: 0,
        rowsUnchanged: 5,
        rowsSkipped: 8
      });
      // The rows that CANNOT produce a value, and why - every one of them a
      // layout feature the engine deliberately does not try to recognise.
      expect(
        report.rows
          .filter((entry) => entry.outcome === 'skipped')
          .map((entry) => [entry.row, entry.reason])
      ).toEqual([
        [0, 'cell_not_numeric'], // merged title banner
        [1, 'cell_not_numeric'], // header row A ("Premium")
        [2, 'cell_not_numeric'], // header row B ("(USD)")
        [3, 'cell_not_numeric'], // blank separator
        [4, 'cell_not_numeric'], // section label "Region A"
        [8, 'cell_not_numeric'], // blank separator
        [9, 'cell_not_numeric'], // section label "Region B"
        [12, 'missing_cell'] // short row: no cell at column 3
      ]);
      // The rows that could: two data rows, a regional subtotal, one more data
      // row and the grand total - all already correct.
      expect(
        report.rows
          .filter((entry) => entry.outcome === 'unchanged')
          .map((entry) => entry.row)
      ).toEqual([5, 6, 7, 10, 11]);
      expect(ed.revisions.length).toBe(0);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: one stale row in the middle of all that produces exactly one change', () => {
    const ed = makeRealDocumentEditor(irregularSfdt({ 6: '$1,600.00' }));
    try {
      const before = ed.serialize();
      const result = run(ed, {
        edits: [
          {
            op: 'set_column_formula',
            anchor: '0;1;5;3;0',
            formula: '[0;1;{row};2;0] * 13%',
            label: 'the Tax column at 13%'
          }
        ]
      });
      const report = result.results[0].column!;
      expect(report).toMatchObject({
        rowsEvaluated: 13,
        rowsChanged: 1,
        rowsUnchanged: 4,
        rowsSkipped: 8
      });
      expect(changedCells(before, ed.serialize())).toEqual(['0;1;6;3;0']);
      expect(cellTextAt(ed, '0;1;6;3;0')).toBe('$1,618.50');
      expect(report.receipt).toContain(
        'Changed: row 6 ("$1,600.00" -> "$1,618.50")'
      );
      rejectEveryRealRevision(ed);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Chaining: a column recompute, then a total over the column it rewrote.
// ---------------------------------------------------------------------------

describe('chaining a column recompute into a total', () => {
  it('real SDK: the total sums the values the column recompute just wrote', () => {
    const ed = makeRealDocumentEditor(scheduleSfdt({ taxTotal: '$1.00' }));
    try {
      const before = ed.serialize();
      const result = run(ed, {
        changeSetId: 'tax-column-then-total',
        plan: 'Recomputing the tax column at 13% and then the tax total that depends on it.',
        edits: [
          {
            op: 'set_column_formula',
            anchor: '0;1;1;2;0',
            formula: '[0;1;{row};1;0] * 13%',
            label: 'the Tax column at 13%',
            // Rows 1-3 only: the total row must not be recomputed per-row and
            // then summed over itself.
            startRow: 1,
            endRow: 3
          },
          {
            op: 'set_cell_formula',
            anchor: '0;1;4;2;0',
            formula: 'sum([0;1;1..3;2])',
            label: 'the tax total'
          }
        ]
      });
      expect(result.results.map((entry) => entry.error)).toEqual([
        undefined,
        undefined
      ]);
      expect(result.changeSet).toMatchObject({ status: 'applied' });
      // 130 + 260 + 390 = 780.
      expect(cellTextAt(ed, '0;1;4;2;0')).toBe('$780.00');
      // The total read the POST-recompute column. Had it read the pre-edit
      // column it would have summed 0 + 99 + 390 = $489.00.
      expect(cellTextAt(ed, '0;1;4;2;0')).not.toBe('$489.00');
      expect(result.results[1].formula?.receipt).toContain(
        'sum over rows 1-3 of column 2 of the table at 0;1 - 3 cells read, 3 numeric'
      );
      // One change set: reject it and every byte comes back.
      rejectEveryRealRevision(ed);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: the total is itself a no-op when the recompute did not move it', () => {
    // Tax rows already correct; only the total is stale.
    const ed = makeRealDocumentEditor(
      scheduleSfdt({ tax1: '$130.00', tax2: '$260.00', taxTotal: '$1.00' })
    );
    try {
      const before = ed.serialize();
      const result = run(ed, {
        plan: 'Recomputing the tax column and its total.',
        edits: [
          {
            op: 'set_column_formula',
            anchor: '0;1;1;2;0',
            formula: '[0;1;{row};1;0] * 13%',
            label: 'the Tax column at 13%',
            startRow: 1,
            endRow: 3
          },
          {
            op: 'set_cell_formula',
            anchor: '0;1;4;2;0',
            formula: 'sum([0;1;1..3;2])',
            label: 'the tax total'
          }
        ]
      });
      expect(result.results[0].column).toMatchObject({ rowsChanged: 0 });
      expect(result.results[0].noOp).toBeDefined();
      expect(result.results[1].noOp).toBeUndefined();
      // Exactly one cell moved: the total.
      expect(changedCells(before, ed.serialize())).toEqual(['0;1;4;2;0']);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Two aggregates over one table that disagree about the rows.
// ---------------------------------------------------------------------------

describe('inconsistent aggregate ranges over one table', () => {
  it('real SDK: sum(rows 1..3) of one column and sum(rows 1..4) of the next is refused, and nothing is written', () => {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      const before = ed.serialize();
      const result = run(ed, {
        plan: 'Totalling the premium and tax columns.',
        edits: [
          {
            op: 'set_cell_formula',
            anchor: '0;1;4;1;0',
            formula: 'sum([0;1;1..3;1])',
            label: 'the premium total'
          },
          {
            // The live defect, verbatim: one row further down the same table.
            op: 'set_cell_formula',
            anchor: '0;1;4;2;0',
            formula: 'sum([0;1;1..4;2])',
            label: 'the tax total'
          }
        ]
      });
      expect(result.results.map((entry) => entry.error)).toEqual([
        'inconsistent_aggregate_ranges',
        'inconsistent_aggregate_ranges'
      ]);
      expect(result.results[0].message).toContain(
        'column 1 over rows 1..3 and column 2 over rows 1..4'
      );
      expect(result.results[0].details).toEqual([
        'column 1: sum([0;1;1..3;1])',
        'column 2: sum([0;1;1..4;2])'
      ]);
      expect(result.changeSet?.status).toBe('failed');
      expect(ed.revisions.length).toBe(0);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: the same two totals over CONSISTENT rows apply', () => {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      const result = run(ed, {
        plan: 'Totalling the premium and tax columns over the same rows.',
        edits: [
          {
            op: 'set_cell_formula',
            anchor: '0;1;4;1;0',
            formula: 'sum([0;1;1..3;1])',
            label: 'the premium total'
          },
          {
            op: 'set_cell_formula',
            anchor: '0;1;4;2;0',
            formula: 'sum([0;1;1..3;2])',
            label: 'the tax total'
          }
        ]
      });
      expect(result.results.map((entry) => entry.error)).toEqual([
        undefined,
        undefined
      ]);
      expect(cellTextAt(ed, '0;1;4;1;0')).toBe('$6,000.00');
      // 0 + 99 + 390 - the tax column has not been recomputed here.
      expect(cellTextAt(ed, '0;1;4;2;0')).toBe('$489.00');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a subtotal and a grand total over the SAME column may legitimately differ', () => {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      const result = run(ed, {
        edits: [
          {
            op: 'set_cell_formula',
            anchor: '0;1;3;2;0',
            formula: 'sum([0;1;1..2;2])',
            label: 'a partial subtotal'
          },
          {
            op: 'set_cell_formula',
            anchor: '0;1;4;2;0',
            formula: 'sum([0;1;1..3;2])',
            label: 'the grand total'
          }
        ]
      });
      // Same column, different spans: a subtotal plus a grand total. Allowed.
      expect(result.results.map((entry) => entry.error)).toEqual([
        undefined,
        undefined
      ]);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. The dependency chain, announced.
// ---------------------------------------------------------------------------

describe('the dependency chain must be announced before it is followed', () => {
  const chainEdits = (extra: Partial<EditOp> = {}): EditOp[] => [
    {
      op: 'set_cell_text',
      anchor: '0;1;1;1;0',
      text: '$1,500.00',
      literal: true
    },
    {
      op: 'set_column_formula',
      anchor: '0;1;1;2;0',
      formula: '[0;1;{row};1;0] * 13%',
      startRow: 1,
      endRow: 3,
      ...extra
    }
  ];

  it('real SDK: touching two columns of one table without a `plan` is refused, and nothing is written', () => {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      const before = ed.serialize();
      const result = run(ed, {
        edits: chainEdits({ label: 'the Tax column at 13%' })
      });
      expect(result.results.map((entry) => entry.error)).toEqual([
        'unannounced_dependency_chain',
        'unannounced_dependency_chain'
      ]);
      const message = result.results[0].message!;
      expect(message).toContain(
        'writes into 2 columns of the table at 0;1 (column 1, column 2)'
      );
      // The refusal hands back the engine's own account, so the model can just
      // say it rather than invent one.
      expect(message).toContain(
        'the table at 0;1: column 1: 1 cell (0;1;1;1;0); ' +
          'column 2 - the Tax column at 13%: the whole column recomputed'
      );
      expect(message).toContain(
        '"The tax column and both totals depend on this premium change - recomputing all three."'
      );
      expect(ed.revisions.length).toBe(0);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: with a `plan` the same batch applies, and both statements ride on the change set', () => {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      const result = run(ed, {
        changeSetId: 'premium-then-tax',
        plan: 'The tax column depends on this premium change - recomputing it too.',
        edits: chainEdits({ label: 'the Tax column at 13%' })
      });
      expect(result.results.map((entry) => entry.error)).toEqual([
        undefined,
        undefined
      ]);
      expect(result.changeSet).toMatchObject({
        id: 'premium-then-tax',
        status: 'applied',
        // The model's announcement...
        plan: 'The tax column depends on this premium change - recomputing it too.',
        // ...beside the engine's own account of what it actually touched.
        announcement:
          'the table at 0;1: column 1: 1 cell (0;1;1;1;0); ' +
          'column 2 - the Tax column at 13%: the whole column recomputed'
      });
      expect(cellTextAt(ed, '0;1;1;2;0')).toBe('$195.00');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a computed write in a chained batch must carry its label', () => {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      const before = ed.serialize();
      const result = run(ed, {
        plan: 'Recomputing the tax column after the premium change.',
        edits: chainEdits()
      });
      expect(result.results[1]).toMatchObject({
        ok: false,
        error: 'unlabelled_chained_write'
      });
      expect(result.results[1].details).toEqual([
        'edit 1 (set_column_formula) has no label'
      ]);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a single-column change needs no announcement - no friction where there is no chain', () => {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      const result = run(ed, {
        edits: [
          {
            op: 'set_column_formula',
            anchor: '0;1;1;2;0',
            formula: '[0;1;{row};1;0] * 13%'
          }
        ]
      });
      expect(result.results[0].error).toBeUndefined();
      expect(result.changeSet?.plan).toBeUndefined();
      expect(result.changeSet?.announcement).toBe(
        'the table at 0;1: column 2: the whole column recomputed'
      );
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: filling a new row across every column is not a dependency chain', () => {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      const result = run(ed, {
        edits: [
          { op: 'insert_row', anchor: '0;1;3;0;0' },
          { op: 'set_cell_text', anchor: '0;1;4;0;0', text: 'Umbrella' },
          {
            op: 'set_cell_text',
            anchor: '0;1;4;1;0',
            text: '$500.00',
            literal: true
          }
        ]
      });
      // No computed write, so no chain: the batch applies with no `plan`.
      expect(result.results.map((entry) => entry.error)).toEqual([
        undefined,
        undefined,
        undefined
      ]);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. The captain's live case, end to end.
// ---------------------------------------------------------------------------

describe("the captain's live case: the tax column at 13%, then BOTH totals", () => {
  it('real SDK: one announced change set recomputes the tax column and both totals over consistent rows', () => {
    const ed = makeRealDocumentEditor(
      scheduleSfdt({ taxTotal: '$0.00' })
    );
    try {
      const before = ed.serialize();
      const result: ApplyEditsResult = run(ed, {
        changeSetId: 'tax-column-and-both-totals',
        plan: 'The tax column and both totals depend on this - recomputing all three.',
        edits: [
          {
            op: 'set_column_formula',
            anchor: '0;1;1;2;0',
            formula: '[0;1;{row};1;0] * 13%',
            label: 'the Tax column at 13%',
            startRow: 1,
            endRow: 3
          },
          {
            op: 'set_cell_formula',
            anchor: '0;1;4;1;0',
            formula: 'sum([0;1;1..3;1])',
            label: 'the premium total'
          },
          {
            // THE SAME rows as the premium total. The live failure was 1..4
            // here against 1..3 there; that batch is now refused outright.
            op: 'set_cell_formula',
            anchor: '0;1;4;2;0',
            formula: 'sum([0;1;1..3;2])',
            label: 'the tax total'
          }
        ]
      });

      expect(result.results.map((entry) => entry.error)).toEqual([
        undefined,
        undefined,
        undefined
      ]);
      expect(result.changeSet).toMatchObject({
        status: 'applied',
        plan: 'The tax column and both totals depend on this - recomputing all three.'
      });

      // The column: rows 1-3 recomputed, row 3 already correct.
      expect(result.results[0].column).toMatchObject({
        rowsEvaluated: 3,
        rowsChanged: 2,
        rowsUnchanged: 1,
        rowsSkipped: 0
      });
      expect(cellTextAt(ed, '0;1;1;2;0')).toBe('$130.00');
      expect(cellTextAt(ed, '0;1;2;2;0')).toBe('$260.00');
      expect(cellTextAt(ed, '0;1;3;2;0')).toBe('$390.00');

      // The premium total was already right, so it is a no-op: no card.
      expect(result.results[1].noOp).toBeDefined();
      expect(cellTextAt(ed, '0;1;4;1;0')).toBe('$6,000.00');

      // The tax total sums the column the first op just rewrote.
      expect(cellTextAt(ed, '0;1;4;2;0')).toBe('$780.00');
      expect(result.results[2].formula?.receipt).toContain(
        'sum over rows 1-3 of column 2 of the table at 0;1 - 3 cells read, 3 numeric'
      );

      // Exactly three cells moved: two tax rows and the tax total. The
      // already-correct tax row and the already-correct premium total left no
      // trace at all.
      expect(changedCells(before, ed.serialize())).toEqual([
        '0;1;1;2;0',
        '0;1;2;2;0',
        '0;1;4;2;0'
      ]);

      // Every money cell kept its own format, byte for byte.
      for (const anchor of ['0;1;1;2;0', '0;1;2;2;0', '0;1;4;2;0'])
        expect(cellTextAt(ed, anchor)).toMatch(/^\$\d{1,3}(,\d{3})*\.\d{2}$/);

      // One rejectable change set that restores the document byte-for-byte.
      expect(ed.revisions.length).toBeGreaterThan(0);
      rejectEveryRealRevision(ed);
      expect(ed.revisions.length).toBe(0);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});
