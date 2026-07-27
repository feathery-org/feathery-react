// The captain's re-total scenario end-to-end, plus the completeness and
// honesty contracts around it (2026-07-27):
//   - a premium column with currency formatting, one value edited, then
//     re-totalled BY THE ENGINE, with the written cell keeping its format
//     byte-for-byte and the whole thing rejectable as tracked revisions;
//   - a ~100-row column read completely, and a deliberately-capped read
//     reporting "N of M" instead of truncating silently (the live bug:
//     maxEntries 60 against a ~94-row table made row 93 a guessed anchor);
//   - refusals that leave the document untouched;
//   - the post-write self-verification catching a write whose input column
//     changed under it.
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
  buildInventoryFromBlocks,
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

// 0;0 title, 0;1 premium table, 0;2 trailing paragraph. The Total premium
// cell holds a stale value on purpose.
const premiumSfdt = () => ({
  sections: [
    {
      blocks: [
        para('Premium Summary'),
        {
          tableFormat: {},
          rows: [
            tableRow('Line of Business', 'Premium'),
            tableRow('General Liability', '$36,803'),
            tableRow('Property', '$12,450'),
            tableRow('Umbrella', '$4,000'),
            tableRow('Total', '$53,253')
          ]
        },
        para('End')
      ]
    }
  ]
});

// A ~94-line-item premium schedule (header + 94 data rows + Total = 96 rows),
// the live session's table scale. Premiums are $101..$194, sum $13,865.
const DATA_ROWS = 94;
const bigPremiumSfdt = () => ({
  sections: [
    {
      blocks: [
        para('Premium Schedule'),
        {
          tableFormat: {},
          rows: [
            tableRow('Line', 'Premium'),
            ...Array.from({ length: DATA_ROWS }, (_, i) =>
              tableRow(`Line item ${i + 1}`, `$${101 + i}`)
            ),
            tableRow('Total', '$0')
          ]
        },
        para('End')
      ]
    }
  ]
});
const BIG_SUM = Array.from({ length: DATA_ROWS }, (_, i) => 101 + i).reduce(
  (a, b) => a + b,
  0
);

const cellTextAt = (editor: DocumentEditor, anchor: string) =>
  flattenSfdt(JSON.parse(editor.serialize())).find(
    (block) => block.anchor === anchor
  )?.text;

jest.setTimeout(120000);

// ---------------------------------------------------------------------------
// The captain's case: edit one premium, re-total, format preserved, rejectable.
// ---------------------------------------------------------------------------

describe("the captain's case: edit a premium, engine re-totals", () => {
  it('real SDK: one atomic change set edits the value and re-totals; the written total keeps the $x,xxx format exactly and the whole set rejects byte-for-byte', () => {
    const ed = makeRealDocumentEditor(premiumSfdt());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();

      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'edit-premium-and-retotal',
        edits: [
          { op: 'set_cell_text', anchor: '0;1;2;1;0', text: '$13,000' },
          { op: 'set_cell_computed', anchor: '0;1;4;1;0', operation: 'sum' }
        ]
      });

      expect(result.results.map((r) => r.error)).toEqual([
        undefined,
        undefined
      ]);
      expect(result.changeSet).toMatchObject({ status: 'applied' });

      // The engine summed the EDITED column state: 36,803 + 13,000 + 4,000.
      expect(cellTextAt(ed, '0;1;2;1;0')).toBe('$13,000');
      expect(cellTextAt(ed, '0;1;4;1;0')).toBe('$53,803');

      const computed = result.results[1].computed!;
      expect(computed).toMatchObject({
        renderedValue: '$53,803',
        counted: 3,
        rowsRead: 5,
        rowCount: 5,
        skipped: [],
        formatSource: 'target_cell',
        verifiedByReRead: true
      });
      expect(computed.receipt).toContain('$53,803');
      expect(computed.receipt).toContain('5 of 5 column rows read');

      // The total write is a tracked revision like any other edit: rejecting
      // the change set restores the document byte-for-byte, stale total and
      // all.
      expect(ed.revisions.length).toBeGreaterThan(0);
      rejectEveryRealRevision(ed);
      expect(ed.revisions.length).toBe(0);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: re-totals the 94-line-item schedule completely and the receipt proves the coverage', () => {
    const ed = makeRealDocumentEditor(bigPremiumSfdt());
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          {
            op: 'set_cell_computed',
            anchor: `0;1;${DATA_ROWS + 1};1;0`,
            operation: 'sum'
          }
        ]
      });
      expect(result.results[0].error).toBeUndefined();
      const computed = result.results[0].computed!;
      expect(computed).toMatchObject({
        counted: DATA_ROWS,
        rowsRead: DATA_ROWS + 2,
        rowCount: DATA_ROWS + 2,
        skipped: []
      });
      expect(computed.renderedValue).toBe('$13,865');
      expect(BIG_SUM).toBe(13865);
      expect(computed.receipt).toContain(`from ${DATA_ROWS} line items`);
      expect(computed.receipt).toContain(
        `${DATA_ROWS + 2} of ${DATA_ROWS + 2} column rows read`
      );
      expect(cellTextAt(ed, `0;1;${DATA_ROWS + 1};1;0`)).toBe('$13,865');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a refused computation (mixed units) writes nothing and leaves the document byte-identical', () => {
    const sfdt = premiumSfdt();
    // Poison one premium with a different currency.
    sfdt.sections[0].blocks[1].rows![2].cells[1].blocks[0].inlines[0].text =
      '€12,450';
    const ed = makeRealDocumentEditor(sfdt);
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          { op: 'set_cell_computed', anchor: '0;1;4;1;0', operation: 'sum' }
        ]
      });
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'mixed_units'
      });
      expect(result.changeSet).toMatchObject({ status: 'failed' });
      expect(ed.revisions.length).toBe(0);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: precision loss is refused, never silently rounded into the document', () => {
    const sfdt = premiumSfdt();
    sfdt.sections[0].blocks[1].rows![2].cells[1].blocks[0].inlines[0].text =
      '$12,450.55';
    const ed = makeRealDocumentEditor(sfdt);
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          { op: 'set_cell_computed', anchor: '0;1;4;1;0', operation: 'sum' }
        ]
      });
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'precision_loss'
      });
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: add a Total row and compute it in one atomic change set (deferred new cell)', () => {
    // A schedule with no totals row yet: header + three premiums.
    const sfdt = {
      sections: [
        {
          blocks: [
            para('Premium Summary'),
            {
              tableFormat: {},
              rows: [
                tableRow('Line of Business', 'Premium'),
                tableRow('General Liability', '$36,803'),
                tableRow('Property', '$12,450'),
                tableRow('Umbrella', '$4,000')
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
        changeSetId: 'add-total-row',
        edits: [
          { op: 'insert_row', anchor: '0;1;3;0;0' },
          { op: 'set_cell_text', anchor: '0;1;4;0;0', text: 'Total' },
          { op: 'set_cell_computed', anchor: '0;1;4;1;0', operation: 'sum' }
        ]
      });
      expect(result.results.map((r) => r.error)).toEqual([
        undefined,
        undefined,
        undefined
      ]);
      expect(cellTextAt(ed, '0;1;4;0;0')).toBe('Total');
      // The new cell was blank, so the format comes from the column itself.
      expect(cellTextAt(ed, '0;1;4;1;0')).toBe('$53,253');
      expect(result.results[2].computed).toMatchObject({
        renderedValue: '$53,253',
        formatSource: 'column_majority'
      });
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: the post-write re-read catches an input column that changed under the write and fails the change set', () => {
    const ed = makeRealDocumentEditor(premiumSfdt());
    try {
      ed.enableTrackChanges = true;
      // Simulate the wrong-cell/concurrent-mutation class: after the write
      // lands, every serialize shows one INPUT cell altered, so the re-read
      // recomputation cannot reproduce the total that was written. The target
      // cell itself is untouched, so plain write verification passes and only
      // the re-sum can catch it.
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
              const findCellInline = (node: any): any => {
                const rows = node?.rows ?? node?.r;
                if (!Array.isArray(rows)) return null;
                const cells = rows[1]?.cells ?? rows[1]?.c;
                const blocks = cells?.[1]?.blocks ?? cells?.[1]?.b;
                const inlines = blocks?.[0]?.inlines ?? blocks?.[0]?.i;
                return inlines?.find(
                  (inline: any) =>
                    typeof (inline?.text ?? inline?.tlp) === 'string'
                );
              };
              const sections = doc.sections ?? doc.sec;
              const blocks = sections?.[0]?.blocks ?? sections?.[0]?.b;
              for (const block of blocks ?? []) {
                const inline = findCellInline(block);
                if (inline) {
                  if (typeof inline.text === 'string') inline.text = '$99,999';
                  else inline.tlp = '$99,999';
                  break;
                }
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
          { op: 'set_cell_computed', anchor: '0;1;4;1;0', operation: 'sum' }
        ]
      });
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'post_write_verification_failed'
      });
      expect(result.changeSet).toMatchObject({ status: 'failed' });
      expect(result.results[0].computed).toBeUndefined();
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

// ---------------------------------------------------------------------------
// table_column reads: complete by default, honest when capped.
// ---------------------------------------------------------------------------

describe('table_column reads', () => {
  const bigBlocks = () => flattenSfdt(bigPremiumSfdt());

  it('returns every cell of a ~100-row column with row anchors and raw text', () => {
    const result = buildInventoryFromBlocks(bigBlocks(), {
      scope: 'table_column',
      tableAnchor: '0;1',
      column: 1
    }) as any;
    expect(result.column).toMatchObject({
      tableAnchor: '0;1',
      column: 1,
      columns: 2,
      rowCount: DATA_ROWS + 2,
      returned: DATA_ROWS + 2,
      truncated: false
    });
    expect(result.column.cells).toHaveLength(DATA_ROWS + 2);
    expect(result.column.cells[0]).toEqual({
      row: 0,
      anchor: '0;1;0;1;0',
      text: 'Premium'
    });
    expect(result.column.cells[94]).toEqual({
      row: 94,
      anchor: '0;1;94;1;0',
      text: '$194'
    });
    expect(result.truncation).toBeUndefined();
  });

  it('a deliberately capped read says "N of M" instead of truncating silently (the live maxEntries-60 bug)', () => {
    const result = buildInventoryFromBlocks(bigBlocks(), {
      scope: 'table_column',
      tableAnchor: '0;1',
      column: 1,
      maxEntries: 60
    }) as any;
    expect(result.column).toMatchObject({
      rowCount: DATA_ROWS + 2,
      returned: 60,
      truncated: true
    });
    expect(result.column.cells).toHaveLength(60);
    expect(result.truncation).toMatchObject({
      returned: 60,
      total: DATA_ROWS + 2
    });
    expect(result.truncation.message).toContain(
      `60 of ${DATA_ROWS + 2} rows`
    );
  });

  it('accepts a cell anchor as the tableAnchor and refuses honest limits', () => {
    const viaCell = buildInventoryFromBlocks(bigBlocks(), {
      scope: 'table_column',
      tableAnchor: '0;1;93;0;0',
      column: 1
    }) as any;
    expect(viaCell.column.tableAnchor).toBe('0;1');

    expect(
      buildInventoryFromBlocks(bigBlocks(), {
        scope: 'table_column',
        column: 1
      })
    ).toMatchObject({ error: 'missing_table_anchor', retry: 'modified_input' });
    expect(
      buildInventoryFromBlocks(bigBlocks(), {
        scope: 'table_column',
        tableAnchor: '0;1'
      })
    ).toMatchObject({ error: 'missing_column' });
    expect(
      buildInventoryFromBlocks(bigBlocks(), {
        scope: 'table_column',
        tableAnchor: '0;9',
        column: 1
      })
    ).toMatchObject({ error: 'table_not_found', retry: 'after_remedy' });
    expect(
      buildInventoryFromBlocks(bigBlocks(), {
        scope: 'table_column',
        tableAnchor: '0;1',
        column: 7
      })
    ).toMatchObject({ error: 'column_out_of_range' });
  });

  it('reports a short row as a missing cell rather than skipping the row', () => {
    const sfdt = premiumSfdt();
    // Drop the premium cell of the Property row (merged-cell shape).
    sfdt.sections[0].blocks[1].rows![2].cells.pop();
    const result = buildInventoryFromBlocks(flattenSfdt(sfdt), {
      scope: 'table_column',
      tableAnchor: '0;1',
      column: 1
    }) as any;
    expect(result.column.cells[2]).toEqual({ row: 2, text: null });
    expect(result.column.rowCount).toBe(5);
  });

  it('is reachable through the live getDocumentInventory read', () => {
    const stub = { serialize: () => JSON.stringify(premiumSfdt()) };
    const result = getDocumentInventory(stub as unknown as LiveEditor, {
      scope: 'table_column',
      tableAnchor: '0;1',
      column: 1
    }) as any;
    expect(result.column.cells.map((c: any) => c.text)).toEqual([
      'Premium',
      '$36,803',
      '$12,450',
      '$4,000',
      '$53,253'
    ]);
  });
});

// ---------------------------------------------------------------------------
// Capped section/full reads now carry the same completeness contract.
// ---------------------------------------------------------------------------

describe('inventory truncation honesty', () => {
  it('a capped section read reports returned-of-total instead of looking complete', () => {
    const blocks = flattenSfdt(bigPremiumSfdt());
    const result = buildInventoryFromBlocks(blocks, {
      scope: 'section',
      sectionAnchor: '0;0',
      maxEntries: 60
    }) as any;
    expect(result.inventory).toHaveLength(60);
    expect(result.truncation).toMatchObject({ returned: 60 });
    expect(result.truncation.total).toBeGreaterThan(60);
    expect(result.truncation.message).toContain('PARTIAL READ');
  });

  it('an uncapped section read carries no truncation field', () => {
    const blocks = flattenSfdt(premiumSfdt());
    const result = buildInventoryFromBlocks(blocks, {
      scope: 'section',
      sectionAnchor: '0;0'
    }) as any;
    expect(result.truncation).toBeUndefined();
  });

  it('a capped full read reports returned-of-total', () => {
    const blocks = flattenSfdt(premiumSfdt());
    const result = buildInventoryFromBlocks(blocks, {
      scope: 'full',
      maxEntries: 3
    }) as any;
    expect(result.inventory).toHaveLength(3);
    expect(result.truncation).toMatchObject({
      returned: 3,
      total: blocks.length
    });
  });
});
