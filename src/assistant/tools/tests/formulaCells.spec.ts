// `set_cell_formula` over its REAL route: a real DocumentEditor, through
// applyDocumentEdits, under the engine's forced track-changes invariant.
//
// The headline case is the captain's own, verbatim: "I just updated the proposed
// premium. I want you to update proposed premium with tax with 13% increment.
// Then update the annual premium." Two chained operations - multiply a single
// value by 1.13, then sum a column that now includes the result - which is
// exactly what the five named column operations could not express, and exactly
// where the model previously wrote "$95,139.18" into a cell as a string.
//
// Everything here asserts the same three things: the number came from the
// ENGINE, the cell kept its own format byte-for-byte, and the whole change set
// stays one rejectable unit that restores the document byte-for-byte.
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
  flattenSfdt,
  getDocumentInventory,
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

const cell = (text: string) => ({
  cellFormat: {},
  blocks: [{ inlines: [{ text }] }]
});
const para = (text: string) => ({ inlines: [{ text }] });
const tableRow = (...texts: string[]) => ({
  rowFormat: {},
  cells: texts.map(cell)
});

const cellTextAt = (editor: DocumentEditor, anchor: string) =>
  flattenSfdt(JSON.parse(editor.serialize())).find(
    (block) => block.anchor === anchor
  )?.text;

// The captain's proposal shape. Table at 0;1, columns: Coverage | Proposed
// Premium | Proposed Premium with Tax. Rows:
//   0 header
//   1 General Liability
//   2 Property           <- the premium the user "just updated"
//   3 Umbrella
//   4 Annual Premium     <- the total row
// Every money cell is $x,xxx.xx, so the 13% tax needs a rounding decision.
//
// `propertyWithTax` is a parameter because the default document is internally
// CONSISTENT: $84,193.99 x 1.13 is exactly $95,139.21, so recomputing that cell
// writes the value already there and is - correctly - a no-op with no change
// card (see writeNoOp.ts). A test that wants to observe the write itself passes
// a stale figure, which is also the real-world shape: nobody asks to recompute
// a column that is already right.
const proposalSfdt = (propertyWithTax = '$95,139.21') => ({
  sections: [
    {
      blocks: [
        para('Proposed Program'),
        {
          tableFormat: {},
          rows: [
            tableRow(
              'Coverage',
              'Proposed Premium',
              'Proposed Premium with Tax'
            ),
            tableRow('General Liability', '$36,803.00', '$41,587.39'),
            tableRow('Property', '$84,193.99', propertyWithTax),
            tableRow('Umbrella', '$4,000.00', '$4,520.00'),
            tableRow('Annual Premium', '$125,000.00', '$141,250.00')
          ]
        },
        para('End')
      ]
    }
  ]
});

jest.setTimeout(120000);

// ---------------------------------------------------------------------------
// The captain's exact case, end to end.
// ---------------------------------------------------------------------------

describe("the captain's case: 13% tax, then re-total", () => {
  it('real SDK: one change set multiplies a premium by 1.13 and re-totals the column that now contains it; both values engine-computed, both cells keep $x,xxx.xx, and the whole set rejects byte-for-byte', () => {
    const ed = makeRealDocumentEditor(proposalSfdt());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();

      // The user's premium edit landed first (dictated verbatim, so it takes
      // the literal exception); the two DERIVED values follow as formulas.
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'premium-tax-and-annual',
        // Two columns of one table move, so the engine requires the chain to
        // be announced before it will write anything (see
        // detectUnannouncedChain). The announcement rides on the change set.
        plan: 'The with-tax figure and the annual total depend on this premium change - recomputing both.',
        edits: [
          {
            op: 'set_cell_text',
            anchor: '0;1;2;1;0',
            text: '$90,000.00',
            literal: true
          },
          {
            // "update proposed premium with tax with 13% increment"
            op: 'set_cell_formula',
            anchor: '0;1;2;2;0',
            formula: '[0;1;2;1;0] * 1.13',
            label: 'the Property premium plus 13% tax',
            round: 'half_up'
          },
          {
            // "Then update the annual premium" - over the WITH-TAX column,
            // whose row 2 the previous op just rewrote.
            op: 'set_cell_formula',
            anchor: '0;1;4;2;0',
            formula: 'sum([0;1;1..3;2])',
            label: 'the annual premium with tax'
          }
        ]
      });

      expect(result.results.map((entry) => entry.error)).toEqual([
        undefined,
        undefined,
        undefined
      ]);
      expect(result.changeSet).toMatchObject({ status: 'applied' });

      // 90,000.00 x 1.13 = 101,700.00 exactly - and the format is preserved
      // byte-for-byte, dollar sign, grouping comma and two decimals.
      expect(cellTextAt(ed, '0;1;2;2;0')).toBe('$101,700.00');
      // 41,587.39 + 101,700.00 + 4,520.00 = 147,807.39, i.e. the sum INCLUDES
      // the value the previous op wrote (the pre-edit column would have summed
      // to 141,246.60).
      expect(cellTextAt(ed, '0;1;4;2;0')).toBe('$147,807.39');

      const tax = result.results[1].formula!;
      expect(tax).toMatchObject({
        formula: '[0;1;2;1;0] * 1.13',
        label: 'the Property premium plus 13% tax',
        references: ['[0;1;2;1;0]'],
        targetAnchor: '0;1;2;2;0',
        renderedValue: '$101,700.00',
        counted: 1,
        skipped: [],
        formatSource: 'target_cell',
        decimals: 2,
        // 90,000 x 1.13 is exact to the cent, so nothing was rounded even
        // though a mode was supplied.
        rounded: false,
        roundingMode: null,
        selfReferencing: false,
        verifiedByReRead: true
      });
      // The receipt states the RESOLVED read, quoting the cell it multiplied -
      // the only way a wrong-cell reference is visible.
      expect(tax.resolved).toEqual([
        {
          kind: 'cell',
          reference: '[0;1;2;1;0]',
          tableAnchor: '0;1',
          row: 2,
          column: 1,
          text: '$90,000.00',
          description: 'cell 0;1;2;1;0 (row 2, column 1) read "$90,000.00"'
        }
      ]);
      expect(tax.receipt).toBe(
        'Computed the Property premium plus 13% tax ([0;1;2;1;0] * 1.13) = ' +
          '$101,700.00 into cell 0;1;2;2;0. Resolved: cell 0;1;2;1;0 (row 2, ' +
          'column 1) read "$90,000.00". Post-write re-read reproduced this exact value.'
      );

      const annual = result.results[2].formula!;
      expect(annual).toMatchObject({
        renderedValue: '$147,807.39',
        counted: 3,
        targetAnchor: '0;1;4;2;0'
      });
      // The resolved range is stated in full: which aggregate, which rows,
      // which column, which table, and the coverage.
      expect(annual.resolved).toEqual([
        {
          kind: 'range',
          reference: 'sum([0;1;1..3;2])',
          operation: 'sum',
          tableAnchor: '0;1',
          column: 2,
          startRow: 1,
          endRow: 3,
          cellsRead: 3,
          counted: 3,
          description:
            'sum over rows 1-3 of column 2 of the table at 0;1 - 3 cells read, 3 numeric'
        }
      ]);
      expect(annual.receipt).toContain('sum over rows 1-3 of column 2');
      expect(annual.receipt).toContain('3 cells read, 3 numeric');

      // One rejectable change set: rejecting it restores every byte, including
      // the stale total and the stale with-tax figure.
      expect(ed.revisions.length).toBeGreaterThan(0);
      rejectEveryRealRevision(ed);
      expect(ed.revisions.length).toBe(0);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: the 13% tax rounds only when it has to, and says so', () => {
    // $84,193.99 x 1.13 = $95,139.2087 - the shape the model previously wrote
    // as "$95,139.18" out of its head. The engine gets it right to the cent and
    // states where it rounded. The with-tax cell starts STALE, so this is a
    // real change rather than a no-op.
    const ed = makeRealDocumentEditor(proposalSfdt('$95,000.00'));
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          {
            op: 'set_cell_formula',
            anchor: '0;1;2;2;0',
            formula: '[0;1;2;1;0] * (1 + 13%)',
            round: 'half_up'
          }
        ]
      });
      expect(result.results[0].error).toBeUndefined();
      expect(cellTextAt(ed, '0;1;2;2;0')).toBe('$95,139.21');
      expect(result.results[0].formula).toMatchObject({
        renderedValue: '$95,139.21',
        rounded: true,
        roundingMode: 'half_up',
        decimals: 2
      });
      expect(result.results[0].formula?.receipt).toContain(
        'rounded half-up to 2 decimal places'
      );
      // The number the model invented is nowhere in the document.
      expect(JSON.parse(ed.serialize())).not.toContain('$95,139.18');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: without a rounding decision the tax write is REFUSED, not silently trimmed', () => {
    const ed = makeRealDocumentEditor(proposalSfdt());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          {
            op: 'set_cell_formula',
            anchor: '0;1;2;2;0',
            formula: '[0;1;2;1;0] * 1.13'
          }
        ]
      });
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'rounding_required'
      });
      expect(result.results[0].details?.join(' ')).toContain(
        'target decimals: 2'
      );
      expect(ed.revisions.length).toBe(0);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

// ---------------------------------------------------------------------------
// Chaining: a later op reads what an earlier op wrote.
// ---------------------------------------------------------------------------

describe('chaining inside one change set', () => {
  it("real SDK: the second formula sees the first formula's written value, not the pre-edit value", () => {
    const ed = makeRealDocumentEditor(proposalSfdt());
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'chain',
        edits: [
          {
            op: 'set_cell_formula',
            anchor: '0;1;2;2;0',
            formula: '[0;1;2;1;0] * 2'
          },
          {
            op: 'set_cell_formula',
            anchor: '0;1;4;2;0',
            formula: 'sum([0;1;1..3;2])'
          }
        ]
      });
      expect(result.results.map((entry) => entry.error)).toEqual([
        undefined,
        undefined
      ]);
      // Row 2 with-tax becomes 84,193.99 x 2 = 168,387.98.
      expect(cellTextAt(ed, '0;1;2;2;0')).toBe('$168,387.98');
      // The total therefore sums 41,587.39 + 168,387.98 + 4,520.00.
      expect(cellTextAt(ed, '0;1;4;2;0')).toBe('$214,495.37');
      // Had it read the PRE-EDIT column it would have produced $141,246.60 -
      // this is the assertion that proves the re-read actually happens.
      expect(cellTextAt(ed, '0;1;4;2;0')).not.toBe('$141,246.60');
      expect(result.results[1].formula?.resolved[0]).toMatchObject({
        cellsRead: 3,
        counted: 3
      });
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a chained set that fails at the second op leaves the document byte-identical', () => {
    const ed = makeRealDocumentEditor(proposalSfdt());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          {
            op: 'set_cell_formula',
            anchor: '0;1;2;2;0',
            formula: '[0;1;2;1;0] * 2'
          },
          {
            op: 'set_cell_formula',
            anchor: '0;1;4;2;0',
            formula: 'sum([0;1;1..99;2])' // off the end of the table
          }
        ]
      });
      expect(result.results[1]).toMatchObject({
        ok: false,
        error: 'reference_not_found'
      });
      // The first op is rolled back into the same failed change set.
      expect(result.results[0]).toMatchObject({ error: 'change_set_failed' });
      expect(result.changeSet).toMatchObject({ status: 'failed' });
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: add a total row and compute it in one atomic change set (deferred new cell)', () => {
    const sfdt = proposalSfdt();
    sfdt.sections[0].blocks[1].rows.pop(); // drop the Annual Premium row
    const ed = makeRealDocumentEditor(sfdt);
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'add-total-row',
        edits: [
          { op: 'insert_row', anchor: '0;1;3;0;0' },
          { op: 'set_cell_text', anchor: '0;1;4;0;0', text: 'Annual Premium' },
          {
            op: 'set_cell_formula',
            anchor: '0;1;4;2;0',
            formula: 'sum([0;1;1..3;2])'
          }
        ]
      });
      expect(result.results.map((entry) => entry.error)).toEqual([
        undefined,
        undefined,
        undefined
      ]);
      expect(cellTextAt(ed, '0;1;4;0;0')).toBe('Annual Premium');
      // The new cell was blank, so the format came from the column itself.
      expect(cellTextAt(ed, '0;1;4;2;0')).toBe('$141,246.60');
      expect(result.results[2].formula).toMatchObject({
        renderedValue: '$141,246.60',
        formatSource: 'column_majority'
      });
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

// ---------------------------------------------------------------------------
// Self-reference and circularity.
// ---------------------------------------------------------------------------

describe('self-reference and circularity', () => {
  it('real SDK: an in-place increase reads the cell, writes it back, and says it did', () => {
    const ed = makeRealDocumentEditor(proposalSfdt());
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          {
            op: 'set_cell_formula',
            anchor: '0;1;3;1;0',
            formula: '[0;1;3;1;0] * (1 + 13%)',
            round: 'half_up'
          }
        ]
      });
      expect(result.results[0].error).toBeUndefined();
      // 4,000.00 x 1.13 = 4,520.00 exactly.
      expect(cellTextAt(ed, '0;1;3;1;0')).toBe('$4,520.00');
      expect(result.results[0].formula).toMatchObject({
        selfReferencing: true,
        verifiedByReRead: true
      });
      expect(result.results[0].formula?.receipt).toContain(
        "read this cell's own previous value before overwriting it"
      );
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a range that covers its own target is refused as circular, with the fix named', () => {
    const ed = makeRealDocumentEditor(proposalSfdt());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          {
            op: 'set_cell_formula',
            anchor: '0;1;4;1;0',
            // Rows 1..4 of column 1 includes row 4, the target.
            formula: 'sum([0;1;1..4;1])'
          }
        ]
      });
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'circular_reference'
      });
      expect(result.results[0].details?.join(' ') ?? '').not.toContain('NaN');
      expect(ed.revisions.length).toBe(0);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

// ---------------------------------------------------------------------------
// Self-verification after the write.
// ---------------------------------------------------------------------------

describe('post-write self-verification', () => {
  it('real SDK: an input cell that changes under the write fails the change set instead of reporting success', () => {
    const ed = makeRealDocumentEditor(proposalSfdt());
    try {
      ed.enableTrackChanges = true;
      // After the write lands, every serialize shows one INPUT cell altered, so
      // the referenced cell no longer reads what it read. The target cell itself
      // is untouched, so plain write verification passes and only the reference
      // re-read can catch it.
      let wrote = false;
      const sabotaged = new Proxy(ed as any, {
        get(target, property, receiver) {
          if (property === 'editor') {
            const realEditor: any = Reflect.get(target, property, receiver);
            return new Proxy(realEditor, {
              get(inner, method, innerReceiver) {
                const value = Reflect.get(inner, method, innerReceiver);
                if (method === 'insertText') {
                  return (text: string) => {
                    wrote = true;
                    return value.call(inner, text);
                  };
                }
                return typeof value === 'function' ? value.bind(inner) : value;
              }
            });
          }
          if (property === 'serialize') {
            return () => {
              const raw = (target as DocumentEditor).serialize();
              if (!wrote) return raw;
              const doc = JSON.parse(raw);
              const sections = doc.sections ?? doc.sec;
              const blocks = sections?.[0]?.blocks ?? sections?.[0]?.b;
              for (const block of blocks ?? []) {
                const rows = block?.rows ?? block?.r;
                if (!Array.isArray(rows)) continue;
                // Row 2, column 1 is the cell the formula references.
                const cells = rows[2]?.cells ?? rows[2]?.c;
                const cellBlocks = cells?.[1]?.blocks ?? cells?.[1]?.b;
                const inlines = cellBlocks?.[0]?.inlines ?? cellBlocks?.[0]?.i;
                const inline = inlines?.find(
                  (entry: any) =>
                    typeof (entry?.text ?? entry?.tlp) === 'string'
                );
                if (!inline) continue;
                if (typeof inline.text === 'string') inline.text = '$1.00';
                else inline.tlp = '$1.00';
                break;
              }
              return JSON.stringify(doc);
            };
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });

      const result = applyDocumentEdits(sabotaged as LiveEditor, {
        edits: [
          {
            op: 'set_cell_formula',
            anchor: '0;1;2;2;0',
            formula: '[0;1;2;1;0] * 2'
          }
        ]
      });
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'post_write_verification_failed'
      });
      expect(result.changeSet).toMatchObject({ status: 'failed' });
      expect(result.results[0].formula).toBeUndefined();
      expect(result.results[0].details?.join(' ')).toContain('0;1;2;1;0');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

// ---------------------------------------------------------------------------
// Refusals through the real route leave the document untouched.
// ---------------------------------------------------------------------------

describe('refusals through the real route write nothing', () => {
  const refusals: Array<[string, Record<string, unknown>, string]> = [
    ['a formula with no reference', { formula: '95139.18' }, 'no_reference'],
    ['an empty formula', { formula: '   ' }, 'missing_formula'],
    ['a syntax error', { formula: '[0;1;1;1;0] ** 2' }, 'formula_syntax'],
    ['a malformed reference', { formula: '[0;1;1;1] * 2' }, 'bad_reference'],
    [
      'an unknown function',
      { formula: 'median([0;1;1..3;1])' },
      'unknown_function'
    ],
    [
      'a reference to a cell that does not exist',
      { formula: '[0;1;77;1;0] * 2' },
      'reference_not_found'
    ],
    [
      'a reference to a non-numeric cell',
      { formula: '[0;1;0;0;0] * 2' },
      'cell_not_numeric'
    ],
    ['division by zero', { formula: '[0;1;1;1;0] / 0' }, 'division_by_zero'],
    [
      'two united values multiplied',
      { formula: '[0;1;1;1;0] * [0;1;2;1;0]' },
      'unit_product_undefined'
    ],
    [
      'an unsupported rounding mode',
      { formula: '[0;1;1;1;0] * 1.13', round: 'bankers' },
      'unsupported_rounding_mode'
    ]
  ];

  it.each(refusals)(
    'real SDK: %s is refused (%#) and the document stays byte-identical',
    (_name, extra, expectedError) => {
      const ed = makeRealDocumentEditor(proposalSfdt());
      try {
        ed.enableTrackChanges = true;
        const before = ed.serialize();
        const result = applyDocumentEdits(ed as unknown as LiveEditor, {
          edits: [
            { op: 'set_cell_formula', anchor: '0;1;4;2;0', ...(extra as any) }
          ]
        });
        expect(result.results[0]).toMatchObject({
          ok: false,
          error: expectedError
        });
        expect(result.results[0].formula).toBeUndefined();
        expect(ed.revisions.length).toBe(0);
        expect(ed.serialize()).toBe(before);
      } finally {
        destroyRealDocumentEditor(ed);
      }
    }
  );

  it('real SDK: anchoring a body paragraph instead of a table cell is refused', () => {
    const ed = makeRealDocumentEditor(proposalSfdt());
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          { op: 'set_cell_formula', anchor: '0;0', formula: '[0;1;1;1;0] * 2' }
        ]
      });
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'not_a_table_cell'
      });
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

// ---------------------------------------------------------------------------
// The enforcement half: the engine refuses a model-authored number.
// ---------------------------------------------------------------------------

describe('the engine refuses a model-authored number', () => {
  it('real SDK: a numeric set_cell_text at a money cell is refused and names set_cell_formula', () => {
    const ed = makeRealDocumentEditor(proposalSfdt());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          // Exactly the write that shipped the unverifiable number.
          { op: 'set_cell_text', anchor: '0;1;4;2;0', text: '$99,117.00' }
        ]
      });
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'model_authored_number'
      });
      expect(result.results[0].details?.join(' ')).toContain('0;1;4;2;0');
      const message = JSON.stringify(result.results[0]);
      expect(ed.revisions.length).toBe(0);
      expect(ed.serialize()).toBe(before);
      expect(message).toContain('0;1;4;2;0');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: the refusal text names the formula op and the literal escape hatch', () => {
    const ed = makeRealDocumentEditor(proposalSfdt());
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          { op: 'set_cell_text', anchor: '0;1;4;1;0', text: '$150,000.00' }
        ]
      });
      // The remedy has to be actionable: both routes are named by name.
      const rendered = JSON.stringify(result.results[0]);
      expect(rendered).toContain('set_cell_formula');
      expect(rendered).toContain('literal');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: replace_text cannot bypass the number-provenance gate', () => {
    const ed = makeRealDocumentEditor(proposalSfdt());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          {
            op: 'replace_text',
            anchor: '0;1;2;2;0',
            find: '$95,139.21',
            replace: '$99,117.00',
            expect: '$95,139.21'
          }
        ]
      });

      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'model_authored_number'
      });
      expect(ed.revisions.length).toBe(0);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a fabricated total cannot hide in a freshly inserted total row either', () => {
    const sfdt = proposalSfdt();
    sfdt.sections[0].blocks[1].rows.pop();
    const ed = makeRealDocumentEditor(sfdt);
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          { op: 'insert_row', anchor: '0;1;3;0;0' },
          { op: 'set_cell_text', anchor: '0;1;4;0;0', text: 'Annual Premium' },
          // A blank cell, but it sits in a column of formatted amounts.
          { op: 'set_cell_text', anchor: '0;1;4;2;0', text: '$141,246.60' }
        ]
      });
      expect(result.results[2]).toMatchObject({
        ok: false,
        error: 'model_authored_number'
      });
      expect(result.changeSet).toMatchObject({ status: 'failed' });
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a user-dictated figure goes in verbatim under `literal: true`, recorded as not-engine-computed', () => {
    const ed = makeRealDocumentEditor(proposalSfdt());
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          {
            op: 'set_cell_text',
            anchor: '0;1;2;1;0',
            text: '$90,000.00',
            literal: true
          }
        ]
      });
      expect(result.results[0].error).toBeUndefined();
      expect(cellTextAt(ed, '0;1;2;1;0')).toBe('$90,000.00');
      expect(result.results[0].literalNumber).toMatchObject({
        text: '$90,000.00',
        previousText: '$84,193.99'
      });
      expect(result.results[0].literalNumber?.note).toContain(
        'NOT computed by the engine'
      );
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: the gate does not touch prose, identifiers, or non-quantity columns', () => {
    const sfdt = {
      sections: [
        {
          blocks: [
            para('Location Schedule'),
            {
              tableFormat: {},
              rows: [
                tableRow('Loc #', 'Address', 'Notes'),
                tableRow('0093', '1 King St W', 'Included'),
                tableRow('0094', '94 Main St', 'N/A')
              ]
            },
            para('End')
          ]
        }
      ]
    };
    const ed = makeRealDocumentEditor(sfdt);
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          // A zero-padded id column: numeric, but identifiers, not amounts.
          { op: 'set_cell_text', anchor: '0;1;1;0;0', text: '0101' },
          // Prose that contains digits.
          { op: 'set_cell_text', anchor: '0;1;1;1;0', text: '7 Bay St' },
          // Plain text.
          { op: 'set_cell_text', anchor: '0;1;2;2;0', text: 'Waived' }
        ]
      });
      expect(result.results.map((entry) => entry.error)).toEqual([
        undefined,
        undefined,
        undefined
      ]);
      expect(result.results.every((entry) => !entry.literalNumber)).toBe(true);
      expect(cellTextAt(ed, '0;1;1;0;0')).toBe('0101');
      expect(cellTextAt(ed, '0;1;1;1;0')).toBe('7 Bay St');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

// ---------------------------------------------------------------------------
// Structure-read-first, end to end on the real editor.
// ---------------------------------------------------------------------------

describe('read the facts, choose the range, compute', () => {
  it('real SDK: table_facts then a formula over the rows the facts justify', () => {
    const ed = makeRealDocumentEditor(proposalSfdt());
    try {
      ed.enableTrackChanges = true;
      const facts = getDocumentInventory(ed as unknown as LiveEditor, {
        scope: 'table_facts',
        tableAnchor: '0;1'
      }) as any;
      // The facts alone tell a reader that row 0 is prose and rows 1-3 hold
      // amounts in column 2, with row 4 a fourth amount (the existing total).
      expect(facts.table).toMatchObject({ rowCount: 5, columnCount: 3 });
      expect(facts.table.columns[2]).toMatchObject({
        numericCells: 4,
        quantityCells: 4,
        units: ['$'],
        decimals: [2]
      });
      expect(facts.table.rows[0].cells[2].numeric).toBe(false);

      // Nothing in the engine decided rows 1..3; this test did, from the facts.
      const dataRows = facts.table.rows
        .filter((row: any) => row.cells[2]?.quantity && row.row !== 4)
        .map((row: any) => row.row);
      expect(dataRows).toEqual([1, 2, 3]);

      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          {
            op: 'set_cell_formula',
            anchor: '0;1;4;2;0',
            formula: `sum([0;1;${dataRows[0]}..${
              dataRows[dataRows.length - 1]
            };2])`
          }
        ]
      });
      expect(result.results[0].error).toBeUndefined();
      expect(cellTextAt(ed, '0;1;4;2;0')).toBe('$141,246.60');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});
