// `set_cell_text` into a column of formatted amounts, over its REAL route: a
// real DocumentEditor, through applyDocumentEdits, under the engine's forced
// track-changes invariant.
//
// Both halves of one live failure, 2026-07-30. The captain added a premium row
// read out of an uploaded policy PDF:
//
//   1. the figure landed as `9660`, not `$9,660.00` - *"it did not format it
//      correctly with the dollar signs... it doesn't understand if the
//      neighbors are dollar sign then it should be using dollar sign even
//      though I gave it just the value."*
//   2. sending it dressed as `$9,660.00` was refused six times over, because a
//      figure quoted out of an attachment is neither user-dictated nor
//      engine-derived and so had NO sanctioned route - and the refusal took
//      twelve sibling ops down with it as `change_set_failed`.
//
// What these tests hold in place: the value is the model's, the FORMAT is
// always the document's, and a number the engine did not compute still cannot
// enter a money column without a declared, recorded provenance.
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

// The captain's homeowners schedule. Table at 0;1, columns:
//   0 Coverage | 1 Premium | 2 Notes
// Row 4's Premium cell is EMPTY - the freshly added row waiting for the figure
// read out of the uploaded policy.
const scheduleSfdt = () => ({
  sections: [
    {
      blocks: [
        para('Homeowners Program'),
        {
          tableFormat: {},
          rows: [
            tableRow('Coverage', 'Premium', 'Notes'),
            tableRow('Dwelling', '$36,803.00', 'Included'),
            tableRow('Other Structures', '$4,120.00', 'Included'),
            tableRow('Personal Property', '$18,400.00', 'Included'),
            tableRow('Loss of Use', '', 'From policy')
          ]
        },
        para('End')
      ]
    }
  ]
});

// A column that is numeric but carries NO format: bare unpadded integers say
// nothing about grouping, decimals or currency, so there is nothing to inherit.
const unformattedSfdt = () => ({
  sections: [
    {
      blocks: [
        para('Unit Count'),
        {
          tableFormat: {},
          rows: [
            tableRow('Location', 'Units', 'Notes'),
            tableRow('Toronto', '312', 'Included'),
            tableRow('Ottawa', '148', 'Included'),
            tableRow('Barrie', '', 'From policy')
          ]
        },
        para('End')
      ]
    }
  ]
});

// A column of amounts that do NOT agree: dollars and a percentage share it, so
// there is no one format a value written here could be said to belong to.
const mixedFormatSfdt = () => ({
  sections: [
    {
      blocks: [
        para('Homeowners Program'),
        {
          tableFormat: {},
          rows: [
            tableRow('Coverage', 'Amount', 'Notes'),
            tableRow('Dwelling', '$36,803.00', 'Included'),
            tableRow('Deductible', '12.5%', 'Of insured value'),
            tableRow('Personal Property', '$18,400.00', 'Included'),
            tableRow('Loss of Use', '', 'From policy')
          ]
        },
        para('End')
      ]
    }
  ]
});

// The same schedule with a DERIVED column beside the premium, so a batch that
// touches both is following a dependency chain.
const taxedScheduleSfdt = () => ({
  sections: [
    {
      blocks: [
        para('Homeowners Program'),
        {
          tableFormat: {},
          rows: [
            tableRow('Coverage', 'Premium', 'Premium with Tax'),
            tableRow('Dwelling', '$36,803.00', '$41,587.39'),
            tableRow('Other Structures', '$4,120.00', '$4,655.60'),
            tableRow('Loss of Use', '', '')
          ]
        },
        para('End')
      ]
    }
  ]
});

const POLICY_QUOTE =
  'SECTION I - COVERAGE D: Loss of Use. Annual premium $9,660.00 per policy term.';

jest.setTimeout(120000);

// ---------------------------------------------------------------------------
// Defect 1: the column supplies the format.
// ---------------------------------------------------------------------------

describe('a figure written into a column of formatted amounts wears its format', () => {
  it('real SDK: a bare 9660 beside $36,803.00 lands as $9,660.00, and the re-render is recorded', () => {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          {
            op: 'set_cell_text',
            anchor: '0;1;4;1;0',
            // "I gave it just the value."
            text: '9660',
            literal: true
          }
        ]
      });

      expect(result.results[0].error).toBeUndefined();
      expect(cellTextAt(ed, '0;1;4;1;0')).toBe('$9,660.00');
      // The bytes sent and the bytes written are both on the record.
      expect(result.results[0].literalNumber).toMatchObject({
        text: '$9,660.00',
        source: 'user_stated',
        rendered: {
          asSent: '9660',
          written: '$9,660.00',
          formatSource: 'column_majority'
        }
      });
      // ...and it is still one rejectable change that restores every byte.
      expect(ed.revisions.length).toBeGreaterThan(0);
      rejectEveryRealRevision(ed);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it("real SDK: a cell that already holds an amount supplies its OWN format, not the column's", () => {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          {
            op: 'set_cell_text',
            anchor: '0;1;1;1;0',
            text: '41000',
            literal: true
          }
        ]
      });
      expect(result.results[0].error).toBeUndefined();
      expect(cellTextAt(ed, '0;1;1;1;0')).toBe('$41,000.00');
      expect(result.results[0].literalNumber?.rendered?.formatSource).toBe(
        'target_cell'
      );
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a column whose amounts do not agree on a format is left exactly as written', () => {
    // $36,803.00 and 12.5% in one column: there is no single format the
    // document can be said to want, so the engine invents none - and writing
    // "9660" here must not silently make it "$9,660.00" OR "9,660.0%".
    const ed = makeRealDocumentEditor(mixedFormatSfdt());
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [{ op: 'set_cell_text', anchor: '0;1;4;1;0', text: '9660' }]
      });
      expect(result.results[0].error).toBeUndefined();
      expect(cellTextAt(ed, '0;1;4;1;0')).toBe('9660');
      expect(result.results[0].literalNumber).toBeUndefined();
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a column of plain integers carries no format to inherit', () => {
    const ed = makeRealDocumentEditor(unformattedSfdt());
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [{ op: 'set_cell_text', anchor: '0;1;3;1;0', text: '96' }]
      });
      expect(result.results[0].error).toBeUndefined();
      // No unit, no decimals, no observed grouping anywhere in the column:
      // nothing is inherited and nothing is invented.
      expect(cellTextAt(ed, '0;1;3;1;0')).toBe('96');
      expect(result.results[0].literalNumber).toBeUndefined();
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: non-numeric cell text is unaffected, in a money column and out of one', () => {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          { op: 'set_cell_text', anchor: '0;1;4;0;0', text: 'Loss of Use' },
          { op: 'set_cell_text', anchor: '0;1;4;2;0', text: 'Per section I' },
          // Prose that happens to contain digits, aimed at the money column
          // itself: still prose, still untouched.
          { op: 'set_cell_text', anchor: '0;1;4;1;0', text: 'See page 12' }
        ]
      });
      expect(result.results.map((entry) => entry.error)).toEqual([
        undefined,
        undefined,
        undefined
      ]);
      expect(cellTextAt(ed, '0;1;4;0;0')).toBe('Loss of Use');
      expect(cellTextAt(ed, '0;1;4;2;0')).toBe('Per section I');
      expect(cellTextAt(ed, '0;1;4;1;0')).toBe('See page 12');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a figure that ARRIVES formatted is a format instruction and is written as sent', () => {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          {
            // "drop the currency symbol on this row" - the model said how the
            // cell should read, so the column must not re-dress it.
            op: 'set_cell_text',
            anchor: '0;1;1;1;0',
            text: '36803.00',
            literal: true
          }
        ]
      });
      expect(result.results[0].error).toBeUndefined();
      expect(cellTextAt(ed, '0;1;1;1;0')).toBe('36803.00');
      expect(result.results[0].literalNumber?.rendered).toBeUndefined();
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: an identifier is never re-rendered as an amount, even aimed at the money column', () => {
    // Re-rendering `0093` would write `$93.00`: the leading zeros are part of
    // what an identifier SAYS, so a value carrying them is never a quantity to
    // dress up, whatever column it is pointed at.
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [{ op: 'set_cell_text', anchor: '0;1;4;1;0', text: '0093' }]
      });
      expect(result.results[0].error).toBeUndefined();
      expect(cellTextAt(ed, '0;1;4;1;0')).toBe('0093');
      expect(result.results[0].literalNumber).toBeUndefined();
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

// ---------------------------------------------------------------------------
// Defect 2: a figure quoted out of an attachment has a sanctioned route.
// ---------------------------------------------------------------------------

describe('the provenance gate: who authored this number', () => {
  it('real SDK: an attachment-quoted figure is ACCEPTED into a money column and the citation is recorded', () => {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          {
            op: 'set_cell_text',
            anchor: '0;1;4;1;0',
            text: '$9,660.00',
            quotedFrom: 'homeowners-policy-2026.pdf',
            quotedText: POLICY_QUOTE
          }
        ]
      });
      expect(result.results[0].error).toBeUndefined();
      expect(cellTextAt(ed, '0;1;4;1;0')).toBe('$9,660.00');
      expect(result.results[0].literalNumber).toMatchObject({
        text: '$9,660.00',
        previousText: '',
        source: 'attachment',
        quotedFrom: 'homeowners-policy-2026.pdf',
        quotedText: POLICY_QUOTE
      });
      // The record says plainly what the engine did and did not verify.
      expect(result.results[0].literalNumber?.note).toContain(
        'NOT computed by the engine'
      );
      expect(result.results[0].literalNumber?.note).toContain(
        'cannot verify the excerpt came from that attachment'
      );
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: the citation is checked by VALUE, so a bare 9660 quoted as $9,660.00 is accepted and formatted', () => {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          {
            op: 'set_cell_text',
            anchor: '0;1;4;1;0',
            text: '9660',
            quotedFrom: 'homeowners-policy-2026.pdf',
            quotedText: POLICY_QUOTE
          }
        ]
      });
      expect(result.results[0].error).toBeUndefined();
      expect(cellTextAt(ed, '0;1;4;1;0')).toBe('$9,660.00');
      expect(result.results[0].literalNumber).toMatchObject({
        source: 'attachment',
        rendered: { asSent: '9660', written: '$9,660.00' }
      });
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a PLAIN model-authored number is still REFUSED, dressed or bare', () => {
    for (const text of ['$9,660.00', '9660']) {
      const ed = makeRealDocumentEditor(scheduleSfdt());
      try {
        ed.enableTrackChanges = true;
        const before = ed.serialize();
        const result = applyDocumentEdits(ed as unknown as LiveEditor, {
          edits: [{ op: 'set_cell_text', anchor: '0;1;4;1;0', text }]
        });
        expect(result.results[0]).toMatchObject({
          ok: false,
          error: 'model_authored_number'
        });
        // Nothing entered the document and no revision was created.
        expect(ed.revisions.length).toBe(0);
        expect(ed.serialize()).toBe(before);
        // The remedy names every route by name, including the new one.
        const rendered = JSON.stringify(result.results[0]);
        expect(rendered).toContain('set_cell_formula');
        expect(rendered).toContain('literal');
        expect(rendered).toContain('quotedFrom');
        expect(rendered).toContain('quotedText');
      } finally {
        destroyRealDocumentEditor(ed);
      }
    }
  });

  it('real SDK: a citation that does not contain the figure is REFUSED and says so', () => {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          {
            op: 'set_cell_text',
            anchor: '0;1;4;1;0',
            text: '$9,660.00',
            quotedFrom: 'homeowners-policy-2026.pdf',
            // The excerpt is real, but it is not evidence for THIS figure.
            quotedText:
              'SECTION I - COVERAGE A: Dwelling. Annual premium $36,803.00.'
          }
        ]
      });
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'model_authored_number'
      });
      expect(result.results[0].message).toContain(
        'does not contain this figure'
      );
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: half a citation is REFUSED - both the attachment and the excerpt are required', () => {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          {
            op: 'set_cell_text',
            anchor: '0;1;4;1;0',
            text: '$9,660.00',
            quotedFrom: 'homeowners-policy-2026.pdf'
          }
        ]
      });
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'model_authored_number'
      });
      expect(result.results[0].message).toContain('must BOTH be sent');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a provenance declaration does not open a NON-money column to laundering', () => {
    // The gate only ever guarded money columns; the new route must not become a
    // way to assert provenance where none was being asked for. Writing into the
    // plain-integer column is unguarded either way - what must hold is that the
    // engine records nothing it did not check.
    const ed = makeRealDocumentEditor(unformattedSfdt());
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          {
            op: 'set_cell_text',
            anchor: '0;1;3;1;0',
            text: '96',
            quotedFrom: 'homeowners-policy-2026.pdf',
            quotedText: 'Barrie: 412 units.'
          }
        ]
      });
      expect(result.results[0].error).toBeUndefined();
      expect(cellTextAt(ed, '0;1;3;1;0')).toBe('96');
      expect(result.results[0].literalNumber).toBeUndefined();
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a declared bare figure still counts as an amount to the announcement gate', () => {
    // The batch-level chain check reads the ops, not the document, so a figure
    // sent as "just the value" would be invisible to it - and a batch that
    // moves a premium AND its derived tax column would slip through
    // unannounced. The declaration is what makes it visible.
    const ed = makeRealDocumentEditor(taxedScheduleSfdt());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          {
            op: 'set_cell_text',
            anchor: '0;1;3;1;0',
            text: '9660',
            quotedFrom: 'homeowners-policy-2026.pdf',
            quotedText: POLICY_QUOTE
          },
          {
            op: 'set_cell_formula',
            anchor: '0;1;3;2;0',
            formula: '[0;1;3;1;0] * 1.13',
            label: 'Loss of Use premium plus 13% tax',
            round: 'half_up'
          }
        ]
      });
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'unannounced_dependency_chain'
      });
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

// ---------------------------------------------------------------------------
// The cascade: one refused cell used to take the whole premium row with it.
// ---------------------------------------------------------------------------

describe('the premium row from the uploaded policy, end to end', () => {
  const premiumRowEdits = (premium: Record<string, unknown>) => [
    { op: 'insert_row', anchor: '0;1;3;0;0' },
    { op: 'set_cell_text', anchor: '0;1;4;0;0', text: 'Loss of Use' },
    { op: 'set_cell_text', anchor: '0;1;4;1;0', ...premium },
    { op: 'set_cell_text', anchor: '0;1;4;2;0', text: 'From policy' }
  ];

  it('real SDK: without a provenance the refusal takes every sibling op with it', () => {
    const sfdt = scheduleSfdt();
    sfdt.sections[0].blocks[1].rows.pop();
    const ed = makeRealDocumentEditor(sfdt);
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'cs-homeowners-premium-row',
        edits: premiumRowEdits({ text: '$9,660.00' })
      });
      expect(result.results[2]).toMatchObject({
        ok: false,
        error: 'model_authored_number'
      });
      // This is the cascade the captain saw: the label and the note die too.
      expect(result.results[1]).toMatchObject({ error: 'change_set_failed' });
      expect(result.changeSet).toMatchObject({ status: 'failed' });
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: with the attachment citation the whole premium row applies, formatted', () => {
    const sfdt = scheduleSfdt();
    sfdt.sections[0].blocks[1].rows.pop();
    const ed = makeRealDocumentEditor(sfdt);
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'cs-homeowners-premium-row',
        edits: premiumRowEdits({
          // Just the value, quoted out of the uploaded policy.
          text: '9660',
          quotedFrom: 'homeowners-policy-2026.pdf',
          quotedText: POLICY_QUOTE
        })
      });

      expect(result.results.map((entry) => entry.error)).toEqual([
        undefined,
        undefined,
        undefined,
        undefined
      ]);
      expect(result.changeSet).toMatchObject({ status: 'applied' });
      expect(cellTextAt(ed, '0;1;4;0;0')).toBe('Loss of Use');
      expect(cellTextAt(ed, '0;1;4;1;0')).toBe('$9,660.00');
      expect(cellTextAt(ed, '0;1;4;2;0')).toBe('From policy');
      expect(result.results[2].literalNumber).toMatchObject({
        source: 'attachment',
        quotedFrom: 'homeowners-policy-2026.pdf'
      });
      // Still one rejectable unit that restores the document byte-for-byte.
      rejectEveryRealRevision(ed);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

// ---------------------------------------------------------------------------
// The same rule where a whole matrix is authored at once.
//
// `insert_table` writes its `initialCells` inside ONE op, so the per-cell gate
// above - one op's text against the one cell it targets - never saw those
// figures, and the section composer routes every composed table through that
// op. These hold the matrix to the same rule, with the same quantity-column
// definition, checked before any of the batch is written.
// ---------------------------------------------------------------------------

const FEE_SCHEDULE_QUOTE =
  'Fee schedule: policy fee $125.00, inspection fee $75.00, filing fee $40.00.';

const feeTableEdit = (extra: Record<string, unknown> = {}) => ({
  op: 'insert_table',
  anchor: '0;0',
  position: 'before',
  rows: 4,
  columns: 2,
  initialCells: [
    ['Fee', 'Amount'],
    ['Policy fee', '$125.00'],
    ['Inspection', '$75.00'],
    ['Filing', '$40.00']
  ],
  ...extra
});

describe('an authored cell matrix crosses the same number-provenance gate', () => {
  it('real SDK: a quantity column with no cited source is refused, document untouched', () => {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [feeTableEdit()]
      });

      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'unsourced_authored_figure'
      });
      expect(result.results[0].message).toContain('$125.00');
      expect(result.changeSet).toMatchObject({ status: 'failed' });
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a citation that does not contain the figure is refused as a citation, not as a missing one', () => {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          feeTableEdit({
            sourcedFrom: {
              quotedFrom: 'fees-2026.pdf',
              // Two of the three figures are here; the filing fee is not.
              quotedText: 'Policy fee $125.00 and inspection fee $75.00.'
            }
          })
        ]
      });

      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'unsourced_authored_figure'
      });
      expect(result.results[0].message).toContain('$40.00');
      expect(result.results[0].message).toContain(
        'does not contain this figure'
      );
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: every figure quoted from the cited excerpt applies, and rejecting restores the document', () => {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          feeTableEdit({
            sourcedFrom: {
              quotedFrom: 'fees-2026.pdf',
              quotedText: FEE_SCHEDULE_QUOTE
            }
          })
        ]
      });

      expect(result.results[0]).toMatchObject({ ok: true });
      expect(result.changeSet).toMatchObject({ status: 'applied' });
      rejectEveryRealRevision(ed);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a total the engine can verify against its own column needs no citation', () => {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          feeTableEdit({
            initialCells: [
              ['Fee', 'Amount'],
              ['Policy fee', '$125.00'],
              ['Inspection', '$75.00'],
              // Not in the excerpt; it is the exact sum of the two above it.
              ['Total fees', '$200.00']
            ],
            sourcedFrom: {
              quotedFrom: 'fees-2026.pdf',
              quotedText: 'Policy fee $125.00 and inspection fee $75.00.'
            }
          })
        ]
      });

      expect(result.results[0]).toMatchObject({ ok: true });
      expect(cellTextAt(ed, '0;0;3;1;0')).toBe('$200.00');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: the column headers are labels, not figures, and need no citation', () => {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          feeTableEdit({
            initialCells: [
              // A header can read like an amount; it is still a label the model
              // composed, and the service's half exempts headers for the same
              // reason - so both sides read the same cells as data.
              ['Fee', '$ per year'],
              ['Policy fee', '$125.00'],
              ['Inspection', '$75.00'],
              ['Filing', '$40.00']
            ],
            sourcedFrom: {
              quotedFrom: 'fees-2026.pdf',
              quotedText: FEE_SCHEDULE_QUOTE
            }
          })
        ]
      });

      expect(result.results[0]).toMatchObject({ ok: true });
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a total that does not add up is not derivable, so the citation must carry it', () => {
    const ed = makeRealDocumentEditor(scheduleSfdt());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          feeTableEdit({
            initialCells: [
              ['Fee', 'Amount'],
              ['Policy fee', '$125.00'],
              ['Inspection', '$75.00'],
              ['Total fees', '$210.00']
            ],
            sourcedFrom: {
              quotedFrom: 'fees-2026.pdf',
              quotedText: 'Policy fee $125.00 and inspection fee $75.00.'
            }
          })
        ]
      });

      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'unsourced_authored_figure'
      });
      expect(result.results[0].message).toContain('$210.00');
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});
