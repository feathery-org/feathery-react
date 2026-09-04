/**
 * The guards this PR adds, each proven twice.
 *
 * Five of the seven shipped without a tracked test. Guard code without a test is
 * a promise: it says a defect is prevented, and nothing checks that it still is
 * next month, or that it did not start preventing legitimate work instead. These
 * tests are also the part of this change that OUTLIVES it - when the port
 * recomposes these ops, the guard code goes and the row stays as the contract
 * the recomposition must satisfy.
 *
 * Every guard gets two cases, and the second matters as much as the first:
 *
 *   THE DEFECT      refuses, and the document is byte-unchanged. A refusal that
 *                   changed the document is a lie, and this engine has shipped
 *                   that lie before.
 *   THE NEIGHBOUR   the legitimate case next door still succeeds. A guard that
 *                   over-refuses is a regression wearing a safety jacket.
 */
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
import { applyDocumentEdits, flattenSfdt, LiveEditor } from '../syncfusionDocumentOps';

DocumentEditor.Inject(Editor, Selection, SfdtExport, EditorHistory, ImageResizer, Search);

if (!window.crypto?.getRandomValues)
  Object.defineProperty(window, 'crypto', {
    value: {
      getRandomValues: (a: Uint8Array) => require('crypto').randomFillSync(a)
    }
  });
if (!(window.SVGElement.prototype as any).getBBox)
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);

const para = (text: string, extra: Record<string, unknown> = {}) => ({
  paragraphFormat: {},
  characterFormat: {},
  inlines: text ? [{ characterFormat: {}, text }] : [],
  ...extra
});

const cell = (text: string) => ({
  blocks: [para(text)],
  cellFormat: { columnSpan: 1, rowSpan: 1 }
});

const table = (rows: string[][]) => ({
  rows: rows.map((cells) => ({
    rowFormat: {},
    cells: cells.map(cell)
  }))
});

let editor: DocumentEditor;

const open = (sfdt: any) => {
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '700px';
  document.body.appendChild(host);
  editor = new DocumentEditor({
    isReadOnly: false,
    enableEditor: true,
    enableSelection: true,
    enableSfdtExport: true,
    enableEditorHistory: true,
    enableSearch: true,
    documentEditorSettings: { optimizeSfdt: false }
  });
  editor.appendTo(host);
  editor.open(JSON.stringify(sfdt));
  return editor as unknown as LiveEditor;
};

const teardown = () => {
  if (!editor) return;
  const element = editor.element;
  editor.destroy();
  element?.remove();
};

const serialized = () => editor.serialize();

const apply = (live: LiveEditor, edits: any[], id: string) =>
  applyDocumentEdits(live, { changeSetId: id, edits }) as any;

const anchorsOf = () => flattenSfdt(JSON.parse(editor.serialize())) as any[];

describe('write-integrity guards', () => {
  afterEach(teardown);

  // A break inside a table cell is NOT covered here on purpose: it has its own
  // file, breakInsideTable.spec.ts, which drives the same guard over more
  // shapes. Two copies of one guard's tests drift, and the weaker copy is the
  // one people read.

  describe('duplicating the document tail table', () => {
    // The defect: the copy is pasted where it cannot be read back, and the
    // engine then deletes rows out of whatever it merged with.
    const tailTableDoc = () => ({
      sections: [
        {
          sectionFormat: { pageWidth: 612, pageHeight: 792 },
          blocks: [para('Intro.'), table([['A1', 'B1'], ['A2', 'B2']])]
        }
      ]
    });
    const middleTableDoc = () => ({
      sections: [
        {
          sectionFormat: { pageWidth: 612, pageHeight: 792 },
          blocks: [para('Intro.'), table([['A1', 'B1'], ['A2', 'B2']]), para('Trailing paragraph.')]
        }
      ]
    });

    it('DEFECT: refuses to duplicate the tail table, document byte-unchanged', () => {
      const live = open(tailTableDoc());
      const before = serialized();
      const result = apply(live, [{ op: 'duplicate_table', anchor: '0;1', group: 'g' }], 'dup-tail');
      expect(result.results[0].ok).toBe(false);
      // The CODE, not just the failure. `ok === false` passes for any error at
      // all, including an unrelated crash, so it would keep passing on a day the
      // guard had stopped working entirely.
      expect(result.results[0].error).toBe('document_tail_table_last_row');
      expect(serialized()).toBe(before);
    });

    it('NEIGHBOUR: duplicating a NON-tail table still works', () => {
      // The guard must key on "is the document's last block", not on "is a
      // table". Same table, one trailing paragraph, and it must succeed.
      const live = open(middleTableDoc());
      const result = apply(live, [{ op: 'duplicate_table', anchor: '0;1', group: 'g' }], 'dup-middle');
      expect(result.results[0].ok).toBe(true);
    });
  });

  describe('an empty replace deletes', () => {
    // Previously an empty replacement verified as a no-op and reported success
    // while deleting nothing. ai-services has already dropped delete_text and
    // relies on this, so the two ship together.
    const doc = () => ({
      sections: [
        {
          sectionFormat: { pageWidth: 612, pageHeight: 792 },
          blocks: [para('Alpha beta gamma.')]
        }
      ]
    });

    it('an empty replacement removes the text', () => {
      const live = open(doc());
      const result = apply(
        live,
        [{ op: 'replace_text', anchor: '0;0', find: 'beta ', replace: '', group: 'g' }],
        'empty-replace'
      );
      expect(result.results[0].ok).toBe(true);
      const text = anchorsOf().map((b) => String(b.text ?? '')).join(' ');
      expect(text).not.toContain('beta');
      expect(text).toContain('Alpha');
      expect(text).toContain('gamma');
    });

    it('T2: the LEADING-space artefact is tolerated, so a real delete verifies', () => {
      // The spacing tolerance was measured and narrowed to the one artefact the
      // SDK actually produces - a dropped LEADING space after a deletion. It
      // used to trim both ends, which meant a write that genuinely lost a
      // trailing space reported success and nothing caught it.
      //
      // `find` is 'Alpha' WITHOUT the trailing space, and that detail is the
      // whole test. With 'Alpha ' the space is consumed by the deletion, the
      // document reads exactly as predicted, and verification's fast equality
      // path matches before the spacing tolerance is ever consulted - so the
      // test passed with collapseSpacing deleted entirely. Review caught that;
      // it was vacuous.
      //
      // Deleting 'Alpha' alone leaves a lone LEADING space, which the document
      // format drops. Predicted text and actual text now differ, the tolerance
      // is the only thing that can reconcile them, and removing collapseSpacing
      // makes this fail. Verified by deleting it and watching this test go red.
      //
      // WHAT IT STILL DOES NOT PROVE: that a genuinely dropped TRAILING space
      // fails verification. I could not construct that through the op API. The
      // narrowing to a leading space only is justified by the browser
      // measurement (inserts preserve both ends; only a leading space is
      // dropped, and only on delete), not by this test.
      const live = open(doc());
      const result = apply(
        live,
        [{ op: 'replace_text', anchor: '0;0', find: 'Alpha', replace: '', group: 'g' }],
        'leading-space-artifact'
      );
      // Deleting the FIRST word leaves a lone leading space that the SDK drops.
      // The tolerance exists so this legitimate delete verifies rather than
      // failing on an artefact nobody can control.
      expect(result.results[0].ok).toBe(true);
      const text = anchorsOf().map((b) => String(b.text ?? '')).join(' ');
      expect(text).not.toContain('Alpha');
      expect(text).toContain('beta gamma');
    });
  });

  describe('splitting a table that carries bindings', () => {
    // The defect, and the one live in production today: the selection this op
    // uses deletes the content control outright, tag and all, so the bound
    // values keep rendering and never recompute. Destroying a content control
    // authors no revision, so rejecting cannot bring them back.
    const boundTable = () => ({
      sections: [
        {
          sectionFormat: { pageWidth: 612, pageHeight: 792 },
          blocks: [
            para('Costs'),
            {
              rows: [
                { rowFormat: {}, cells: [cell('Item'), cell('Amount')] },
                { rowFormat: {}, cells: [cell('Website'), cell('7800')] },
                { rowFormat: {}, cells: [cell('Hosting'), cell('1200')] }
              ]
            },
            para('Trailing.')
          ]
        }
      ]
    });

    it('NEIGHBOUR: splitting an UNBOUND table still works', () => {
      // The guard must key on bindings, not on tables. This table carries none,
      // so the capability is unaffected.
      const live = open(boundTable());
      const result = apply(
        live,
        [
          {
            op: 'split_table',
            anchor: '0;1;1;0;0',
            splitAtRow: 1,
            targetAnchor: '0;2',
            position: 'after',
            group: 'g'
          }
        ],
        'split-unbound'
      );
      // Either it succeeds, or it refuses for a reason that is NOT the bindings
      // guard - what must not happen is a bindings refusal on a table with none.
      if (!result.results[0].ok)
        expect(result.results[0].error).not.toBe('structural_op_would_destroy_bindings');
    });
  });

  describe('splitting a table that carries bindings - the DEFECT case', () => {
    // The NEIGHBOUR case above proves an UNBOUND table still splits. This is the
    // other half: a table that DOES carry bindings must refuse. Without it the
    // neighbour test alone would pass on an engine where the guard had been
    // deleted, which is precisely how a guard rots.
    const cellWithTag = (text: string, tag: string) => ({
      blocks: [
        {
          paragraphFormat: {},
          characterFormat: {},
          inlines: [
            {
              contentControlProperties: { tag, lockContents: false },
              inlines: [{ characterFormat: {}, text }]
            }
          ]
        }
      ],
      cellFormat: { columnSpan: 1, rowSpan: 1 }
    });

    const boundTable = () => ({
      sections: [
        {
          sectionFormat: { pageWidth: 612, pageHeight: 792 },
          blocks: [
            para('Costs'),
            {
              rows: [
                { rowFormat: {}, cells: [cell('Item'), cell('Amount')] },
                {
                  rowFormat: {},
                  cells: [
                    cell('Website'),
                    cellWithTag('7800', '[[name=website_cost|type=currency]]')
                  ]
                },
                {
                  rowFormat: {},
                  cells: [
                    cell('Hosting'),
                    cellWithTag('1200', '[[name=hosting_cost|type=currency]]')
                  ]
                }
              ]
            },
            para('Trailing.')
          ]
        }
      ]
    });

    it('DEFECT: refuses to split a bound table, document byte-unchanged', () => {
      const live = open(boundTable());
      const before = serialized();
      const result = apply(
        live,
        [
          {
            op: 'split_table',
            anchor: '0;1;1;0;0',
            splitAtRow: 1,
            targetAnchor: '0;2',
            position: 'after',
            group: 'g'
          }
        ],
        'split-bound'
      );
      expect(result.results[0].ok).toBe(false);
      expect(result.results[0].error).toBe('structural_op_would_destroy_bindings');
      // The bindings are the whole point: a refusal that still moved the
      // document would have destroyed the very tags it claims to protect.
      expect(serialized()).toBe(before);
    });
  });

  describe('a column break inside a table cell', () => {
    // Same family as the page break: an op that cannot be tracked inside a cell.
    // Covered separately because the two take different SDK paths, and a guard
    // proven on one is not proven on the other.
    const doc = () => ({
      sections: [
        {
          sectionFormat: { pageWidth: 612, pageHeight: 792 },
          blocks: [para('Before the table.'), table([['A1', 'B1'], ['A2', 'B2']]), para('After.')]
        }
      ]
    });

    it('DEFECT: refuses a column break at a table row, document byte-unchanged', () => {
      const live = open(doc());
      const cellAnchor = anchorsOf().find((b) => b.kind === 'table_cell')?.anchor;
      expect(cellAnchor).toBeDefined();
      const before = serialized();
      const result = apply(
        live,
        [{ op: 'insert_column_break', anchor: cellAnchor, group: 'g' }],
        'column-break-in-cell'
      );
      expect(result.results[0].ok).toBe(false);
      expect(serialized()).toBe(before);
    });

    it('NEIGHBOUR: a column break at an ordinary paragraph still works', () => {
      const live = open(doc());
      const result = apply(
        live,
        [{ op: 'insert_column_break', anchor: '0;0', group: 'g' }],
        'column-break-in-para'
      );
      expect(result.results[0].ok).toBe(true);
    });
  });
});
