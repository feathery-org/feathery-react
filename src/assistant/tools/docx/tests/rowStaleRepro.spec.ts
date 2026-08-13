// Regression coverage for the live 2026-07-27 failure: insert_row anchored at
// a mid-table row of a ~112-row table, with the new row's set_cell_text fills
// in the same change set, failed on every attempt - while the identical batch
// at the END of the table applied cleanly. Mid-table, the created row's
// indices are occupied at preflight (the old rows shift down to make room), so
// the fills either relocated onto the shifted OLD row or died
// `anchor_relocation_ambiguous`; and a stale `expect` on the insert refused
// `stale_anchor` with no hint of what mismatched, inviting an identical retry
// loop. These tests pin down: both insert directions mid-table, end appends,
// wrong-target protection, and the actionable stale_anchor details.
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

// A large "location schedule"-shaped document: a heading paragraph, a table
// with `rows` data rows x 4 columns, and a trailing paragraph. The last column
// repeats 'ON' in every row, the shape that made text-based anchor relocation
// ambiguous in the live failure.
function bigTableSfdt(rows: number) {
  const cell = (text: string) => ({
    cellFormat: {},
    blocks: [{ inlines: [{ text }] }]
  });
  const row = (i: number) => ({
    rowFormat: {},
    cells: [
      cell(`${String(i).padStart(4, '0')}`),
      cell(`${i} Main St`),
      cell(`City ${i}`),
      cell('ON')
    ]
  });
  return {
    sections: [
      {
        blocks: [
          { inlines: [{ text: 'Location Schedule' }] },
          {
            tableFormat: {},
            rows: Array.from({ length: rows }, (_, i) => row(i))
          },
          { inlines: [{ text: 'End' }] }
        ]
      }
    ]
  };
}

const cellText = (editor: DocumentEditor, anchor: string) =>
  flattenSfdt(JSON.parse(editor.serialize())).find(
    (block) => block.anchor === anchor
  )?.text;

jest.setTimeout(120000);

describe('mid-table insert_row with same-change-set cell fills (live 2026-07-27 shape)', () => {
  it('real SDK: insert BELOW row 93 of a 112-row table fills the NEW row, leaves the shifted rows intact, and rejects byte-for-byte', () => {
    const ed = makeRealDocumentEditor(bigTableSfdt(112));
    try {
      ed.enableTrackChanges = false;
      const before = ed.serialize();

      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'mid-insert-below',
        edits: [
          { op: 'insert_row', anchor: '0;1;93;0;0', above: false, count: 1 },
          { op: 'set_cell_text', anchor: '0;1;94;0;0', text: '9999' },
          { op: 'set_cell_text', anchor: '0;1;94;1;0', text: '9 New St' },
          { op: 'set_cell_text', anchor: '0;1;94;2;0', text: 'Newtown' },
          { op: 'set_cell_text', anchor: '0;1;94;3;0', text: 'ON' }
        ]
      });

      expect(result.results.map((r) => r.error)).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      ]);
      expect(result.results.every((r) => r.ok)).toBe(true);
      expect(result.changeSet).toMatchObject({ status: 'applied' });

      // The values landed in the NEW row...
      expect(cellText(ed, '0;1;94;0;0')).toBe('9999');
      expect(cellText(ed, '0;1;94;3;0')).toBe('ON');
      // ...the anchored row is untouched...
      expect(cellText(ed, '0;1;93;0;0')).toBe('0093');
      // ...and the old row 94 shifted down intact instead of being overwritten.
      expect(cellText(ed, '0;1;95;0;0')).toBe('0094');
      expect(cellText(ed, '0;1;95;1;0')).toBe('94 Main St');

      // The whole batch stays one rejectable tracked change: rejecting every
      // revision restores the document byte-for-byte.
      rejectEveryRealRevision(ed);
      expect(ed.revisions.length).toBe(0);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: insert ABOVE row 93 fills the new row at the anchored index and shifts the anchored row down intact', () => {
    const ed = makeRealDocumentEditor(bigTableSfdt(112));
    try {
      ed.enableTrackChanges = false;
      const before = ed.serialize();

      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'mid-insert-above',
        edits: [
          { op: 'insert_row', anchor: '0;1;93;0;0', above: true, count: 1 },
          { op: 'set_cell_text', anchor: '0;1;93;0;0', text: '9999' },
          { op: 'set_cell_text', anchor: '0;1;93;1;0', text: '9 New St' },
          { op: 'set_cell_text', anchor: '0;1;93;2;0', text: 'Newtown' },
          { op: 'set_cell_text', anchor: '0;1;93;3;0', text: 'ON' }
        ]
      });

      expect(result.results.map((r) => r.error)).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      ]);
      expect(result.changeSet).toMatchObject({ status: 'applied' });

      // The new row sits at the anchored index with the new values, and the
      // previously-anchored row shifted below it intact.
      expect(cellText(ed, '0;1;93;0;0')).toBe('9999');
      expect(cellText(ed, '0;1;94;0;0')).toBe('0093');
      expect(cellText(ed, '0;1;92;0;0')).toBe('0092');

      rejectEveryRealRevision(ed);
      expect(ed.revisions.length).toBe(0);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: append at the LAST row still works (the deferred vacant-anchor path)', () => {
    const ed = makeRealDocumentEditor(bigTableSfdt(112));
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'end-append',
        edits: [
          { op: 'insert_row', anchor: '0;1;111;0;0', above: false, count: 1 },
          { op: 'set_cell_text', anchor: '0;1;112;0;0', text: '9999' }
        ]
      });
      expect(result.results.every((r) => r.ok)).toBe(true);
      expect(cellText(ed, '0;1;112;0;0')).toBe('9999');
      expect(cellText(ed, '0;1;111;0;0')).toBe('0111');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a fill anchor OUTSIDE the created-row range still refuses to write over the shifted table (no silent wrong-target write)', () => {
    const ed = makeRealDocumentEditor(bigTableSfdt(112));
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'mid-insert-wrong-fill',
        edits: [
          { op: 'insert_row', anchor: '0;1;93;0;0', above: false, count: 1 },
          // Row 95 is NOT a row this insert creates; after the shift its
          // repeated text ('ON') cannot be relocated deterministically.
          { op: 'set_cell_text', anchor: '0;1;95;3;0', text: 'QC' }
        ]
      });
      expect(result.results[1]).toMatchObject({ ok: false });
      expect(result.changeSet).toMatchObject({ status: 'failed' });
      // The failed change set rolled everything back.
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a stale `expect` on insert_row refuses expect_mismatch at preflight and names both texts (the live log shape, made actionable)', () => {
    const ed = makeRealDocumentEditor(bigTableSfdt(112));
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'stale-expect',
        edits: [
          {
            op: 'insert_row',
            anchor: '0;1;93;0;0',
            above: false,
            count: 1,
            expect: '0093-from-an-older-document'
          },
          { op: 'set_cell_text', anchor: '0;1;94;0;0', text: '9999' },
          { op: 'set_cell_text', anchor: '0;1;94;1;0', text: '9 New St' },
          { op: 'set_cell_text', anchor: '0;1;94;2;0', text: 'Newtown' },
          { op: 'set_cell_text', anchor: '0;1;94;3;0', text: 'ON' }
        ]
      });

      expect(result.results[0]).toMatchObject({
        ok: false,
        op: 'insert_row',
        anchor: '0;1;93;0;0',
        error: 'expect_mismatch'
      });
      // The refusal must let the next attempt differ: it names the mismatched
      // expect, the authoritative live text, and the correction.
      const details = (result.results[0] as any).details as string[];
      expect(details.join('\n')).toContain('"0093-from-an-older-document"');
      expect(details.join('\n')).toContain('"0093"');
      expect(details.join('\n')).toContain('omit `expect`');
      expect(
        result.results
          .slice(1)
          .every((r) => r.error === 'change_set_failed')
      ).toBe(true);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});
