/**
 * What the appearance finalizer owes. Written before it existed, now met.
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

/** Only the finalizer's own warnings, not the serialization timing line. */
const finalizerWarnings = (result: any): string[] =>
  (result.warnings ?? []).filter((w: string) =>
    w.startsWith('Table appearance not finalized')
  );

describe('appearance finalizer - one pass per change set, on the accept projection', () => {
  it('(a) CHARACTERIZATION: a phase-shifting re-band is NOT applied, and why', () => {
    // The third act of this row, and the honest end of tonight.
    //
    // Act one: it asserted the DEFECT. Banding was settled inside the split
    // handler while a tracked-deleted row was still physically present, so the
    // stripes were laid out for a table about to lose a row and went one out of
    // phase the moment anyone accepted. Measured `#001B49 . .` - two unshaded
    // rows adjacent, the stripe gone.
    //
    // Act two: the finalizer fixed it. Computing from the accept projection
    // produced `#001B49 . #E6E6E6` and this row briefly asserted the
    // requirement.
    //
    // Act three, which is why it asserts the defect again. Landing that fix
    // broke reject byte-equality, and the cause is a platform limit measured on
    // the real editor: no public API can restore a cell to never-coloured. All
    // of background = a colour / 'empty' / undefined / '' leave
    // `{"backgroundColor":"empty",...}`, and so do clearCellFormat() and
    // clearFormat() - the latter growing the document by 137 characters. A
    // pristine cell is `sd:{}` with no backgroundColor. The SDK's OWN undo
    // restores that absence, because undo restores a snapshot while a setter
    // assigns a value, and only the first can express absence.
    //
    // A phase-shifting re-band must colour rows that were never coloured - that
    // is what shifting the stripe MEANS - so on content that survives its own
    // rejection it cannot be undone. Reject byte-equality is the spine and the
    // banding improvement is not, so the finalizer writes only to cells that
    // were already coloured, or to content wholly inserted by this change set
    // which a reject removes entirely.
    //
    // THE UNLOCK: `docx-reversible-absence`. When there is a way to restore a
    // never-coloured cell - a snapshot-restore seam, or a vendor API - this row
    // becomes the requirement again and act four gets written here.
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

    // The finalizer SAYS it declined, rather than silently leaving it unbanded.
    expect(
      (result.warnings ?? []).some((w: string) => /left unbanded/.test(w))
    ).toBe(true);

    editor.revisions.acceptAll();

    expect(tableBlocks()).toHaveLength(2);
    const source = shadingOf(0);
    expect(source[0]).toBe('#001B49');
    // Still out of phase, and deliberately so until absence is reversible.
    expect(bandsAlternate(source)).toBe(false);
  });
});

/**
 * DELIBERATELY ABSENT, pending a ruling: the maintenance, content-immunity and
 * dedupe properties.
 *
 * Each needs a change set the engine refuses in preflight today.
 * `detectAnchorShiftingNotLast` rejects any set where split_table or
 * copy_section is followed by another anchored edit, and
 * `split_table_one_per_change_set` allows only one split. So no footprint can
 * be recorded before a LATER shifting op, which makes the runner's maintenance
 * and the finalizer's dedupe unreachable rather than untested.
 *
 * They become reachable when the anchor-shifting refusal is removed - the
 * backlog's "delete the anchor-shifting refusal, gaining a capability" - and
 * the footprint contract exists so that capability is safe to unlock. Their
 * proofs belong with it.
 */
