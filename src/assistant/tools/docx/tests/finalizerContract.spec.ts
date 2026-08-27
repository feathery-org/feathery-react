/**
 * What the appearance finalizer owes, WRITTEN BEFORE IT EXISTS.
 *
 * Today `restripeSplitCopy` is called from inside the split handler, so banding
 * is settled in the middle of a change set. Two things follow, and both are
 * wrong:
 *
 *   1. A LATER op in the same change set can change the table again, and the
 *      striping is never revisited.
 *   2. Striping is computed from the LIVE table, which still physically
 *      contains rows that a tracked delete has only MARKED. The bands are laid
 *      out for rows that are about to disappear, so the moment somebody accepts
 *      the change the stripes are one row out of phase.
 *
 * The design's answer is one finalization pass per change set, after the last
 * edit, computing from the ACCEPT PROJECTION rather than the live document.
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
import { applyDocumentEdits, LiveEditor } from '../syncfusionDocumentOps';

DocumentEditor.Inject(
  Editor,
  Selection,
  SfdtExport,
  EditorHistory,
  ImageResizer,
  Search
);
if (!window.crypto?.getRandomValues)
  Object.defineProperty(window, 'crypto', {
    value: {
      getRandomValues: (a: Uint8Array) => require('crypto').randomFillSync(a)
    }
  });
if (!(window.SVGElement.prototype as any).getBBox)
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);

const HEADER_BAND = '#001B49FF';
const STRIPE = '#E6E6E6FF';

const para = (text: string) => ({
  paragraphFormat: {},
  characterFormat: {},
  inlines: text ? [{ characterFormat: {}, text }] : []
});
const cell = (text: string, shading?: string) => ({
  blocks: [para(text)],
  cellFormat: {
    columnSpan: 1,
    rowSpan: 1,
    ...(shading ? { shading: { backgroundColor: shading } } : {})
  }
});
const stripedTable = (bodyRows: number) => ({
  rows: [
    {
      rowFormat: {},
      cells: [cell('Coverage', HEADER_BAND), cell('Amount', HEADER_BAND)]
    },
    ...Array.from({ length: bodyRows }, (_, i) => ({
      rowFormat: {},
      cells: [
        cell(`Item ${i + 1}`, i % 2 === 1 ? STRIPE : undefined),
        cell(`$${(i + 1) * 100}`, i % 2 === 1 ? STRIPE : undefined)
      ]
    }))
  ]
});
const docWith = (table: any) => ({
  sections: [
    {
      sectionFormat: { pageWidth: 612, pageHeight: 792 },
      blocks: [para('Coverages and Limits'), table, para('Driver Information')]
    }
  ]
});

let editor: DocumentEditor;
const open = (sfdt: any): LiveEditor => {
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
    // Expanded dialect on purpose, matching the other structural specs. Without
    // it serialize() emits the OPTIMIZED dialect, where a table block keys on
    // `r` rather than `rows` - and a reader that checks the wrong key sees a
    // document with no tables in it and reports catastrophe instead of a typo.
    documentEditorSettings: { optimizeSfdt: false }
  });
  editor.appendTo(host);
  editor.open(JSON.stringify(sfdt));
  return editor as unknown as LiveEditor;
};

/**
 * First-cell fill of every row of the Nth TABLE, counted among tables.
 *
 * Not the Nth block. A split inserts a table and a separating paragraph, so
 * block indices move under the test, and reading a hardcoded index gave an
 * empty array that failed the assertion for a reason unrelated to banding.
 */
const tableBlocks = (): any[] => {
  const doc = JSON.parse(editor.serialize());
  const blocks =
    (doc.sections ?? doc.sec ?? [])[0].blocks ??
    (doc.sections ?? doc.sec ?? [])[0].b;
  return (blocks ?? []).filter((b: any) => Array.isArray(b.rows ?? b.rw));
};

const shadingOf = (nth: number): string[] => {
  const table = tableBlocks()[nth];
  if (!table) return [];
  return (table.rows ?? table.rw ?? []).map((r: any) => {
    const c0 = (r.cells ?? r.c ?? [])[0] ?? {};
    const sh = (c0.cellFormat ?? c0.cf ?? {}).shading ?? {};
    const bg = sh.backgroundColor;
    return bg == null || String(bg).toLowerCase() === 'empty'
      ? '.'
      : String(bg).slice(0, 7);
  });
};

/** A correct body band alternates, starting unshaded under the header. */
const bandsAlternate = (rows: string[]): boolean =>
  rows.slice(1).every((fill, i) => fill === (i % 2 === 1 ? '#E6E6E6' : '.'));

describe('appearance finalizer - one pass per change set, on the accept projection', () => {
  it('(a) CHARACTERIZATION: bands are settled mid-change-set, so accept leaves them wrong', () => {
    // THE DEFECT, pinned. Two ops touch one table in one change set: a row is
    // tracked-deleted, then the table is split. Striping is settled inside the
    // split handler, at a moment when the deleted row is still PHYSICALLY
    // PRESENT - a tracked delete only marks it. So the bands are laid out for a
    // table that is about to lose a row, and the moment anyone accepts, they are
    // one row out of phase.
    //
    // Measured on a 7-row striped table, deleting body row 2 and splitting at 4:
    // the source keeps body rows 1 and 3, and after accept they read
    //   #001B49 . .
    // where a correctly banded table reads
    //   #001B49 . #E6E6E6
    // Two unshaded rows in a row - the stripe is simply gone.
    //
    // Asserted AS THE DEFECT rather than as the requirement, because a
    // permanently red test teaches people to ignore red, and this jest is too
    // old for it.failing. When the finalizer lands - one pass per change set,
    // after the last edit, computing from the ACCEPT PROJECTION rather than the
    // live document - this row FAILS, and that failure is the signal to rewrite
    // it as the requirement.
    const live = open(docWith(stripedTable(7)));
    const result = applyDocumentEdits(live, {
      changeSetId: 'finalizer-a',
      edits: [
        { op: 'delete_row', anchor: '0;1;2;0;0', group: 'g' } as any,
        {
          op: 'split_table',
          anchor: '0;1;0;0;0',
          splitAtRow: 4,
          targetAnchor: '0;2',
          position: 'before',
          group: 'g'
        } as any
      ]
    }) as any;
    expect(result.results.every((r: any) => r.ok)).toBe(true);

    editor.revisions.acceptAll();

    expect(tableBlocks()).toHaveLength(2);
    const source = shadingOf(0);
    expect(source[0]).toBe('#001B49');
    // The defect: the body bands do NOT alternate.
    expect(bandsAlternate(source)).toBe(false);
    expect(source).toEqual(['#001B49', '.', '.']);
  });
});
