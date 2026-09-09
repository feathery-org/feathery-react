/**
 * What the appearance finalizer owes. Written before it existed, now met.
 *
 * Banding used to be settled inside the split handler, so
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
import {
  listRevisionGroups,
  resolveLiveRevisionGroupsAsOneUndo
} from '../../../../utils/documentEditorPrimitives';

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
  it('(a) declines a re-band that would colour never-coloured survivors, loudly', () => {
    // No public API restores a cell to never-coloured, so a re-band that would
    // colour a pristine survivor is declined, the banded fixture in
    // finalizerRoles.spec.ts is where the re-band applies
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
    // Out of phase, deliberately, until absence is reversible
    expect(bandsAlternate(source)).toBe(false);
  });

  it('(b) rejecting through the ENGINE SEAM restores source fills byte-equal', () => {
    // The restore-exactness claim the write scope makes, proven on the branch
    // that actually needs it.
    //
    // (a) covers ACCEPT only. Slice 1's row (e) covers a split alone, where the
    // source write is a no-op. Neither exercises the case the finalizer newly
    // creates: re-phased fills written to already-coloured cells in a table that
    // SURVIVES its own rejection, whose restore therefore has to run.
    //
    // Rejected through the engine seam because that is what the product does -
    // the rail's per-card reject and Reject all both call resolveGroups ->
    // resolveLiveRevisionGroupsAsOneUndo (TrackedChangeGroups/index.tsx:367 and
    // :375-388; RailHead.tsx:96), which is where appearance restores bound to
    // the card by groupRevisionsAtomic are applied. A raw SDK rejectAll is not a
    // product path and cannot run them.
    const live = open(docWith(stripedTable(7)));
    const before = editor.serialize();
    const bandsBefore = shadingOf(0).join(' ');

    const result = applyDocumentEdits(live, {
      changeSetId: 'finalizer-b',
      edits: [
        { op: 'delete_row', anchor: '0;1;2;0;0', group: 'g' } as any,
        {
          op: 'split_table',
          anchor: '0;1;0;0;0',
          // Split LATE on purpose. At splitAtRow 4 the source keeps only two
          // body rows, both of which either already match their band or are
          // keyless, so the finalizer writes nothing to it and this row would
          // prove nothing - the negative control below caught exactly that.
          // Splitting at 6 leaves the source a row that IS already coloured and
          // MUST change phase, which is the case the write scope claims to
          // restore exactly.
          splitAtRow: 6,
          targetAnchor: '0;2',
          position: 'before',
          group: 'g'
        } as any
      ]
    }) as any;
    expect(result.results.every((r: any) => r.ok)).toBe(true);

    // NEGATIVE CONTROL. Without this the row passes when the finalizer wrote
    // nothing at all, which is the vacuity that would make the whole assertion
    // meaningless: a restore of no writes is trivially byte-equal.
    expect(shadingOf(0).join(' ')).not.toBe(bandsBefore);

    // N2: this change set contains NO explicit formatting op - the finalizer is
    // its only appearance writer. The batch must still report that appearance
    // was written and name the group a reject would restore, which it did not
    // when the flag was computed before the finalizer ran.
    expect(result.changeSet.formatTracking).toBeDefined();
    expect(
      (result.changeSet.groups ?? []).some((g: any) => g.restoresAppearance)
    ).toBe(true);

    const groups = listRevisionGroups(editor as any);
    expect(groups.length).toBeGreaterThan(0);
    resolveLiveRevisionGroupsAsOneUndo(editor as any, groups, false);

    expect(editor.revisions.length).toBe(0);
    expect(editor.serialize()).toBe(before);
  });

  // Where a prior change set's revision ids can live. The guard must see ALL of
  // them: a version reading rowFormat alone was blind to a prior edit of cell
  // TEXT, which lands on the inline instead - so it passed, and the write
  // proceeded into the under-restoring path. Same id-universe gap as B1, a
  // third time, which is why the detection is now one deep walk.
  const PRIOR_PLACEMENTS: Array<[string, (row: any, id: string) => void]> = [
    [
      'rowFormat only',
      (row, id) => {
        row.rowFormat = { revisionIds: [id] };
      }
    ],
    [
      'INLINE only (a prior edit of cell text)',
      (row, id) => {
        for (const cell of row.cells)
          for (const block of cell.blocks)
            for (const inline of block.inlines ?? [])
              inline.characterFormat = { revisionIds: [id] };
      }
    ],
    [
      'both',
      (row, id) => {
        row.rowFormat = { revisionIds: [id] };
        for (const cell of row.cells)
          for (const block of cell.blocks)
            for (const inline of block.inlines ?? [])
              inline.characterFormat = { revisionIds: [id] };
      }
    ]
  ];

  it.each(PRIOR_PLACEMENTS)(
    '(c) a prior change set marked via %s makes the table off limits',
    (_label, mark) => {
      // The escape hatch says "this set inserted it, so this set's reject
      // removes it". That holds only for THIS set. A row inserted by an
      // earlier, still-unaccepted change set is tracked-inserted too, and this
      // set's reject leaves it exactly where it is - so the table is off
      // limits for surviving writes, and the finalizer must say so.
      const PRIOR = 'prior-set-insertion';
      const doc: any = docWith(stripedTable(7));
      const table = doc.sections[0].blocks[1];
      mark(table.rows[3], PRIOR);
      doc.revisions = [
        {
          // OUR OWN earlier set. A foreign author's pending revision is refused
          // outright by the guard slice 1 added, so it never reaches here.
          author: 'Robin',
          date: '2026-08-20T09:00:00Z',
          revisionType: 'Insertion',
          revisionId: PRIOR
        }
      ];

      const live = open(doc);
      const before = editor.serialize();
      expect(before).toContain(PRIOR);

      const result = applyDocumentEdits(live, {
        changeSetId: 'finalizer-c',
        edits: [
          { op: 'delete_row', anchor: '0;1;2;0;0', group: 'g' } as any,
          {
            op: 'split_table',
            anchor: '0;1;0;0;0',
            splitAtRow: 6,
            targetAnchor: '0;2',
            position: 'before',
            group: 'g'
          } as any
        ]
      }) as any;
      expect(result.results.every((r: any) => r.ok)).toBe(true);
      expect(
        (result.warnings ?? []).some((w: string) => /left unbanded/.test(w))
      ).toBe(true);

      const groups = listRevisionGroups(editor as any).filter(
        (group: any) => group.changeSetId === 'finalizer-c'
      );
      expect(groups.length).toBeGreaterThan(0);
      resolveLiveRevisionGroupsAsOneUndo(editor as any, groups, false);
      expect(editor.serialize()).toBe(before);
    }
  );

  it('(d) TRIPWIRE for the maintenance code: an op after a split is REFUSED', () => {
    // This row is why the footprint maintenance and dedupe code is allowed to
    // sit in the tree unexercised.
    //
    // Both depend on a footprint being recorded BEFORE a later shifting edit.
    // The engine forbids that shape, so they are unreachable rather than
    // untested - and that was PROSE until now, which is not a guarantee. If
    // somebody deletes this refusal for the capability it withholds, they would
    // silently activate two pieces of code nothing has ever run.
    //
    // So the refusal is asserted by its exact error string. When it goes, this
    // row fails, and its failure is the instruction: land the maintenance law
    // and its proofs in the same change - `docx-anchor-shifting-refusal`.
    const live = open(docWith(stripedTable(5)));
    const before = editor.serialize();
    const result = applyDocumentEdits(live, {
      changeSetId: 'tripwire',
      edits: [
        {
          op: 'split_table',
          anchor: '0;1;0;0;0',
          splitAtRow: 3,
          targetAnchor: '0;2',
          position: 'before',
          group: 'g'
        } as any,
        {
          op: 'set_cell_text',
          anchor: '0;1;1;1;0',
          text: '$1',
          group: 'g'
        } as any
      ]
    }) as any;
    expect(result.results[0].ok).toBe(false);
    expect(result.results[0].error).toBe(
      'anchor_shifting_op_must_end_change_set'
    );
    // Refused in preflight, so nothing was written.
    expect(editor.serialize()).toBe(before);
  });
});

/**
 * DELIBERATELY ABSENT: the maintenance, content-immunity and dedupe property
 * tests. The CODE for all three is present in this diff and reachable only in
 * principle; it is the PROOFS that wait.
 *
 * Each needs a change set the engine refuses in preflight today.
 * `detectAnchorShiftingNotLast` rejects any set where split_table or
 * copy_section is followed by another anchored edit, and
 * `split_table_one_per_change_set` allows only one split. So no footprint can
 * be recorded before a LATER shifting op, which makes the runner's maintenance
 * and the finalizer's dedupe unreachable rather than untested. Row (d) above
 * asserts that refusal by its exact error string, so the guarantee is
 * executable rather than a paragraph somebody has to notice.
 *
 * They become reachable when the anchor-shifting refusal is REPLACED BY THE
 * MAINTENANCE LAW - the backlog's `docx-anchor-shifting-refusal` - and their
 * proofs land with it.
 */
