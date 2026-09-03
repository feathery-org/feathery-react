/**
 * The contract slice 1 must satisfy: split_table recomposed as
 * copy{rows} + delete_row, under the relocation law.
 *
 * WRITTEN BEFORE THE IMPLEMENTATION, AND FAILING. Every row below states a
 * property the recomposition owes, and each one currently fails for a reason
 * that is the MISSING BEHAVIOUR rather than a broken harness - that distinction
 * is the negative control for the tests themselves, and it is checked in the
 * step-2 report rather than assumed.
 *
 * Two of these rows are capabilities the current engine deliberately gave up:
 * splitting a bound table is refused outright today, and banding does not
 * restart. This file is where those come back.
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

/** A cell whose value is owned by the binding engine, not typed by a person. */
const boundCell = (text: string, tag: string, shading?: string) => ({
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
  cellFormat: {
    columnSpan: 1,
    rowSpan: 1,
    ...(shading ? { shading: { backgroundColor: shading } } : {})
  }
});

/**
 * A striped table with an ODD number of body rows.
 *
 * Odd on purpose: it is the case where the original's own banding has to be
 * re-derived after rows leave, not merely left alone. An even split can look
 * correct by accident.
 */
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

const boundStripedTable = () => ({
  rows: [
    {
      rowFormat: {},
      cells: [cell('Item', HEADER_BAND), cell('Amount', HEADER_BAND)]
    },
    {
      rowFormat: {},
      cells: [
        cell('Website'),
        boundCell('7800', '[[name=website_cost|type=currency|row=r-1]]')
      ]
    },
    {
      rowFormat: {},
      cells: [
        cell('Hosting', STRIPE),
        boundCell('1200', '[[name=hosting_cost|type=currency|row=r-2]]', STRIPE)
      ]
    },
    {
      rowFormat: {},
      cells: [
        cell('Support'),
        boundCell('900', '[[name=support_cost|type=currency|row=r-3]]')
      ]
    }
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

const doc = () => JSON.parse(editor.serialize());
const blocksOf = () => {
  const s = (doc().sections ?? doc().sec)[0];
  return s.blocks ?? s.b;
};
const isTable = (b: any) => !!(b?.rows ?? b?.r);
const tablesIn = () => blocksOf().filter(isTable);

/**
 * The shading of each row's first cell, which is what a reader sees as banding.
 *
 * "empty" and an ABSENT shading key are the same thing on the page: both render
 * unshaded. A document that never carried a fill omits the key; one the engine
 * has explicitly cleared says "empty". Treating those as different made a
 * correctly re-banded table read as wrong - the same trap the border-colour fix
 * records, where an unstated border colour and an explicit #000000 both render
 * black. Normalised here so this test measures what the page shows rather than
 * which of two encodings the document happens to use.
 */
const UNSHADED = 'none';
const bandsOf = (table: any): string[] =>
  (table.rows ?? table.r).map((r: any) => {
    const c = (r.cells ?? r.c)[0] ?? {};
    const f = c.cellFormat ?? c.cf ?? {};
    const raw = String(f.shading?.backgroundColor ?? f.shd?.bgc ?? UNSHADED);
    return raw === 'empty' ? UNSHADED : raw;
  });

const tagsIn = (node: any): string[] => {
  const out: string[] = [];
  const walk = (n: any): void => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    const ccp = n.contentControlProperties ?? n.ccp;
    if (ccp?.tag) out.push(String(ccp.tag));
    Object.values(n).forEach(walk);
  };
  walk(node);
  return out;
};

const apply = (live: LiveEditor, edits: any[], id: string) =>
  applyDocumentEdits(live, { changeSetId: id, edits }) as any;

/**
 * Split so the new table starts at `splitAtRow`, landing immediately after the
 * original.
 *
 * Both anchors matter and neither is obvious. `anchor` is a CELL anchor inside
 * the table - `flattenSfdt` does not expose a table as a top-level block at all,
 * it flattens tables into their cells, so "0;1" addresses nothing and the op
 * refuses with relocation_anchor_not_found. And `targetAnchor` must be a
 * PARAGRAPH: the trailing one, taken `before`, which is the position directly
 * after the table. Aiming further away would hand row (a) a separating
 * paragraph by construction and test nothing.
 */
const splitAt = (live: LiveEditor, splitAtRow: number, id: string) =>
  apply(
    live,
    [
      {
        op: 'split_table',
        anchor: '0;1;0;0;0',
        splitAtRow,
        targetAnchor: '0;2',
        position: 'before',
        group: 'g'
      }
    ],
    id
  );

/**
 * A table whose middle row sits inside a bookmark.
 *
 * A bookmark is a named range someone else depends on - a cross-reference, a
 * table of contents entry, a link from elsewhere in the document. Splitting
 * ACROSS its boundary would either tear the range in half or silently drop it,
 * and a dropped bookmark takes every reference to it with it.
 */
/**
 * A table whose bookmark SPANS the cut: it opens in row 1 and closes in row 3,
 * so extracting from row 2 tears the named range in half.
 */
const spanningBookmarkTable = () => ({
  sections: [
    {
      sectionFormat: { pageWidth: 612, pageHeight: 792 },
      blocks: [
        para('Coverages and Limits'),
        {
          rows: [
            {
              rowFormat: {},
              cells: [
                cell('Coverage', HEADER_BAND),
                cell('Amount', HEADER_BAND)
              ]
            },
            {
              rowFormat: {},
              cells: [
                {
                  blocks: [
                    {
                      paragraphFormat: {},
                      characterFormat: {},
                      inlines: [
                        { bookmarkType: 0, name: 'coverage_span' },
                        { characterFormat: {}, text: 'Item 1' }
                      ]
                    }
                  ],
                  cellFormat: { columnSpan: 1, rowSpan: 1 }
                },
                cell('$100')
              ]
            },
            { rowFormat: {}, cells: [cell('Item 2'), cell('$200', STRIPE)] },
            {
              rowFormat: {},
              cells: [
                {
                  blocks: [
                    {
                      paragraphFormat: {},
                      characterFormat: {},
                      inlines: [
                        { characterFormat: {}, text: 'Item 3' },
                        { bookmarkType: 1, name: 'coverage_span' }
                      ]
                    }
                  ],
                  cellFormat: { columnSpan: 1, rowSpan: 1 }
                },
                cell('$300')
              ]
            }
          ]
        },
        para('Driver Information')
      ]
    }
  ]
});

const bookmarkedTable = () => ({
  sections: [
    {
      sectionFormat: { pageWidth: 612, pageHeight: 792 },
      blocks: [
        para('Coverages and Limits'),
        {
          rows: [
            {
              rowFormat: {},
              cells: [
                cell('Coverage', HEADER_BAND),
                cell('Amount', HEADER_BAND)
              ]
            },
            { rowFormat: {}, cells: [cell('Item 1'), cell('$100')] },
            {
              rowFormat: {},
              cells: [
                {
                  blocks: [
                    {
                      paragraphFormat: {},
                      characterFormat: {},
                      inlines: [
                        { bookmarkType: 0, name: 'coverage_detail' },
                        { characterFormat: {}, text: 'Item 2' },
                        { bookmarkType: 1, name: 'coverage_detail' }
                      ]
                    }
                  ],
                  cellFormat: { columnSpan: 1, rowSpan: 1 }
                },
                cell('$200', STRIPE)
              ]
            },
            { rowFormat: {}, cells: [cell('Item 3'), cell('$300')] }
          ]
        },
        para('Driver Information')
      ]
    }
  ]
});

const bookmarkNames = (node: any): string[] => {
  const out: string[] = [];
  const walk = (n: any): void => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.bookmarkType === 0 && n.name) out.push(String(n.name));
    Object.values(n).forEach(walk);
  };
  walk(node);
  return out;
};

describe('split_table contract - what the recomposition owes', () => {
  afterEach(teardown);

  it('(a) leaves a separating paragraph between the two tables', () => {
    // Word treats two adjacent table blocks as ONE table. Without a paragraph
    // between them the split is undone at render time, and the document the
    // person sees is not the document the engine believes it wrote.
    const live = open(docWith(stripedTable(5)));
    const result = splitAt(live, 3, 'contract-a');
    expect(result.results[0].ok).toBe(true);

    // Judged after accept, like the banding row: what matters is the document
    // the reader ends up with, not the pending view.
    editor.revisions.acceptAll();

    const blocks = blocksOf();
    const tableIndexes = blocks
      .map((b: any, i: number) => (isTable(b) ? i : -1))
      .filter((i: number) => i >= 0);
    expect(tableIndexes).toHaveLength(2);
    expect(tableIndexes[1] - tableIndexes[0]).toBeGreaterThan(1);
    expect(isTable(blocks[tableIndexes[0] + 1])).toBe(false);
  });

  it('(a2) NEGATIVE CONTROL: no separator where the tables are NOT flush', () => {
    // The other half of the separator rule, and the one that says it is a rule
    // rather than a habit. Row (a) proves a separator appears where two tables
    // would otherwise land flush. If one also appeared where it is NOT needed,
    // the "fix" would just be an unconditional blank paragraph, quietly adding
    // empty paragraphs to every document a relocation touches.
    //
    // The document here has an extra paragraph before the table, so the paste
    // point is preceded by a PARAGRAPH rather than a table. Nothing is flush, so
    // nothing should be inserted.
    const live = open({
      sections: [
        {
          sectionFormat: { pageWidth: 612, pageHeight: 792 },
          blocks: [
            para('Coverages and Limits'),
            para('The policy covers the vehicles listed below.'),
            stripedTable(5),
            para('Driver Information')
          ]
        }
      ]
    });
    const emptyParagraphs = () => {
      const doc = JSON.parse(editor.serialize());
      const blocks =
        (doc.sections ?? doc.sec ?? [])[0].blocks ??
        (doc.sections ?? doc.sec ?? [])[0].b;
      return blocks.filter((b: any) => {
        if (Array.isArray(b.rows ?? b.rw)) return false;
        return (b.inlines ?? b.i ?? []).length === 0;
      }).length;
    };
    const before = emptyParagraphs();

    const result = apply(
      live,
      [
        {
          op: 'split_table',
          anchor: '0;2;0;0;0',
          splitAtRow: 2,
          targetAnchor: '0;1',
          position: 'before',
          group: 'g'
        }
      ],
      'contract-a2'
    );
    expect(result.results[0].ok).toBe(true);
    expect(emptyParagraphs()).toBe(before);
  });

  it('(a3) a table is not a valid paste target, which is what makes trailing flush unreachable', () => {
    // The separator is only ever considered for the PRECEDING side. That is a
    // guarantee rather than an unfinished job, and this is the row that holds it
    // up: a relocation cannot land immediately in front of a table, because a
    // table anchor is not a valid caret. Found while writing (a2) - the first
    // version of it aimed at the table and was refused rather than
    // mis-separated.
    const live = open(docWith(stripedTable(5)));
    const result = apply(
      live,
      [
        {
          op: 'split_table',
          anchor: '0;1;0;0;0',
          splitAtRow: 2,
          targetAnchor: '0;1',
          position: 'before',
          group: 'g'
        }
      ],
      'contract-a3'
    );
    expect(result.results[0].ok).toBe(false);
  });

  it('(b) restarts banding on the new table and re-derives it on the original', () => {
    // THE SPLIT POINT IS THE TEST. Body rows alternate unshaded, stripe,
    // unshaded, stripe, unshaded. Splitting after row 3 extracts rows 3-5,
    // whose first row is ALREADY unshaded - so inherited bands and re-derived
    // bands look identical and the row proves nothing. That is how this test
    // passed before it was fixed, and it is exactly the vacuity the captain
    // warned about: "split after row 3 does not test restriping".
    //
    // Splitting after row 2 extracts rows 2-5, whose first row CARRIES THE
    // STRIPE. Inherited, the new table opens on a shaded row; re-derived, it
    // opens unshaded. Only this split point can tell the two apart. The
    // original is left with an odd body count, so its own alternation has to
    // hold too.
    const live = open(docWith(stripedTable(5)));
    const result = splitAt(live, 2, 'contract-b');
    expect(result.results[0].ok).toBe(true);

    // MEASURED AFTER ACCEPT, and that is the whole point of this row. While the
    // change is still pending the original keeps its deleted rows, so both
    // tables read as correctly banded - measuring there says nothing about what
    // the reader ends up with. The damage, if any, lands on accept. This is the
    // same shape as the binding destruction: the pending view looks right.
    editor.revisions.acceptAll();

    const [original, created] = tablesIn();
    const originalBands = bandsOf(original);
    const createdBands = bandsOf(created);

    // Header band survives on BOTH - the new table is not a headless fragment.
    expect(originalBands[0]).toBe(HEADER_BAND);
    expect(createdBands[0]).toBe(HEADER_BAND);

    // Body alternation starts unshaded on both, and alternates from there.
    const bodyAlternates = (bands: string[]) =>
      bands
        .slice(1)
        .every((b, i) => (i % 2 === 0 ? b === UNSHADED : b === STRIPE));
    expect(bodyAlternates(originalBands)).toBe(true);
    expect(bodyAlternates(createdBands)).toBe(true);
  });

  // JSDOM-ONLY CHARACTERIZATION - NOT retirement evidence, and not a capability
  // claim. Read this before touching the bindings guard.
  //
  // Conservation genuinely holds in this harness, which is why the row is not
  // inverted: it states something true about jsdom. What it is NOT is evidence
  // about the product. Measured in a real browser on 2026-08-27, on the very
  // build this branch produces: splitting the bound costs table reported
  // success and destroyed TEN OF ELEVEN binding tags on ACCEPT, leaving only
  // "[[table=costs]]" - identical to the pre-fix engine.
  //
  // I retired assertTableHasNoBindings on the strength of this row passing, and
  // that was wrong. The guard is restored. The capability's acceptance lives in
  // the browser evidence table, where it is currently FAILING.
  //
  // The cause is the same one diagnosed for the travelling bookmark: SyncFusion's
  // paste drops IDENTIFIED ELEMENTS - content controls and bookmarks alike - and
  // the originals then die with the tracked-deleted source rows on accept. jsdom's
  // paste preserves them, so this harness structurally cannot see the failure.
  it('(c) JSDOM ONLY: a bound split conserves tags in this harness - the browser disagrees', () => {
    // Kept because it pins the harness behaviour and would catch a jsdom-side
    // regression. It must never again be read as licence to retire the guard.
    const live = open(docWith(boundStripedTable()));
    const beforeSerialized = editor.serialize();
    const before = tagsIn(doc()).sort();
    expect(before.length).toBe(3);

    // The guard is RESTORED, so a bound split is refused - in this harness and in
    // the browser alike. What this row records now is that the refusal writes
    // NOTHING, which is the property that actually protects the document.
    const result = splitAt(live, 2, 'contract-c');
    expect(result.results[0].ok).toBe(false);
    expect(result.results[0].error).toBe(
      'structural_op_would_destroy_bindings'
    );
    expect(editor.serialize()).toBe(beforeSerialized);
    // Every tag still present, because nothing was written.
    expect(tagsIn(doc()).sort()).toEqual(before);
  });

  it('(d) CHARACTERIZATION: the change set opens NO undo group', () => {
    // This row used to assert the opposite, and the story of why it flipped is
    // the most useful thing in this file.
    //
    // It asserted that the seam opened exactly ONE undo group, and its comment
    // explained that the property people actually care about - "one Ctrl+Z puts
    // it back" - could not be tested here, because editorHistory.undo() throws
    // "Cannot read properties of undefined (reading 'getSplitWidgets')" in
    // jsdom, from inside SyncFusion's re-layout, which needs real rendering
    // widgets. That reasoning was WRONG in its second half, and the error was
    // mine: I read a real defect signature as a harness artifact.
    //
    // Measured in the real browser on 2026-08-27, that same throw happens with
    // full rendering. Grouped, a split_table's 13 history entries collapse to
    // one; undoing that one group throws in getSplitWidgets partway through
    // replaying the inverses; the rest are abandoned; and the group has ALREADY
    // been popped, so the history is empty and ~115K characters of damage are
    // unreachable by any number of Ctrl+Z presses. Ungrouped, the same split
    // undoes in 13 clean steps with no error.
    //
    // So the grouping wrapper was reverted from applyDocumentEdits - the seam
    // every change set flows through, where it had been grouping every op on
    // the evidence of one. The law: grouping is an optimisation, recoverability
    // is correctness, and only a per-op BROWSER ledger can license it, because
    // jsdom has no layout to throw from.
    //
    // This row is now a tripwire. If someone reintroduces grouping, it fails
    // here and they read this before shipping a document nobody can undo.
    const live = open(docWith(stripedTable(5)));
    const history = (editor as any).editorHistory;
    let begins = 0;
    const realBegin = history.beginUndoAction.bind(history);
    history.beginUndoAction = () => {
      begins++;
      return realBegin();
    };

    // TWO DOORS. beginUndoAction is the one the reverted wrapper used, but it is
    // not the only way to group: the editor module's initComplexHistory opens a
    // named complex action, and it is already used elsewhere in this codebase
    // for Accept All / Reject All. A tripwire watching one door would let
    // grouping back in through the other and report green while doing it.
    //
    // This door is NOT expected to be shut, and the difference matters. Measured
    // by capturing the call stack: the one complex action a split opens is
    // SyncFusion's OWN, named 'Paste', from defaultPaste inside pasteContents -
    // the SDK grouping the internals of a single paste it was asked to perform.
    // That is also why a split lands as 13 history entries rather than dozens:
    // each SDK operation contributes one. Asserting 0 here would fail forever
    // for something we do not do and cannot fix.
    //
    // So the count is PINNED at the SDK's own one. If it rises, something opened
    // a complex action that SyncFusion did not, and that is the regression this
    // row exists to catch.
    const editorModule = (editor as any).editor;
    const openedActions: string[] = [];
    if (editorModule && typeof editorModule.initComplexHistory === 'function') {
      const realInit = editorModule.initComplexHistory.bind(editorModule);
      editorModule.initComplexHistory = (action: string) => {
        openedActions.push(action);
        return realInit(action);
      };
    }

    const result = splitAt(live, 3, 'contract-d');
    expect(result.results[0].ok).toBe(true);
    expect(begins).toBe(0);
    expect(openedActions).toEqual(['Paste']);
  });

  it('(e) rejecting every revision restores the document byte-equal', () => {
    // The conservation law. If rejecting the whole change set does not give the
    // prior document back, the change was never truly reviewable.
    //
    // SPLIT AT 2, NOT 3, AND THE NUMBER IS LOAD-BEARING. Shading is the one
    // thing a reject cannot undo on its own, because SyncFusion authors no
    // revision for a fill - so this row is only a real test of conservation if
    // the restripe actually WROTE something. Measured on stripedTable(5), body
    // banding `. #E6 . #E6 .`, comparing what the copy would have inherited
    // against what it ended up with:
    //   at=2  inherit `#E6 . #E6 .`  ->  got `. #E6 . #E6`   restripe WROTE
    //   at=3  inherit `. #E6 .`      ->  got `. #E6 .`       restripe wrote NOTHING
    //   at=4  inherit `#E6 .`        ->  got `. #E6`         restripe WROTE
    // At 3 the inherited phase already equals the re-derived phase, so the row
    // passed without the restripe path ever running - green for a reason that
    // had nothing to do with what it claimed. 2 is the smallest cut that writes.
    const live = open(docWith(stripedTable(5)));
    const before = editor.serialize();
    const result = splitAt(live, 2, 'contract-e');
    expect(result.results[0].ok).toBe(true);

    editor.revisions.rejectAll();
    expect(editor.serialize()).toBe(before);
  });

  // KNOWN DEFECT, DIAGNOSED AND DEFERRED - `test.failing` so it passes while the
  // defect exists and FAILS LOUDLY the day someone fixes it. A green suite keeps
  // meaning "everything asserted here is true", and the defect stays pinned in a
  // test rather than a paragraph.
  //
  // WHAT HAPPENS: a bookmark inside the extracted rows survives the split while
  // the change is PENDING and DIES ON ACCEPT - the same accept-time destruction
  // as the bindings on the HILB document. Measured: pending ["coverage_detail"],
  // accepted [].
  //
  // DIAGNOSIS, three measurements:
  //   1. the captured payload CONTAINS the bookmark (2 markers, both named), so
  //      the capture is not at fault
  //   2. after the paste the markers are only in the SOURCE table's row - the
  //      copy has none, so SyncFusion's paste drops them
  //   3. inserting a bookmark whose name already exists does NOT create a second
  //      one - a bookmark name is UNIQUE per document
  //
  // WHY IT IS NOT FIXED HERE: the original lives in a tracked-DELETED row until
  // accept, so throughout the pending window the copy cannot hold the same name.
  // Re-registering it on the pasted rows inside the change set is therefore not
  // possible - the conflict is between bookmark name uniqueness and tracked
  // deletion keeping the old row alive, which is relocation-wide semantics
  // rather than anything about splitting a table. Fixing it here would mean
  // changing how tracked deletes treat named ranges.
  //
  // Backlog: "split_table destroys a travelling bookmark on accept" on the SFDT
  // set.
  //
  // Written as an assertion of the DEFECT rather than of the property, because
  // `test.failing` is not available in this jest. Same effect: it is green while
  // the defect exists and goes RED the day someone fixes it, at which point the
  // reader finds this comment and flips it to the property below.
  it('S2(d) KNOWN DEFECT: a travelling bookmark does NOT survive accept', () => {
    // The case the spanning refusal must NOT over-reach - and it does not: this
    // split is PERMITTED. It is the survival that fails.
    const live = open(bookmarkedTable());
    const namesBefore = bookmarkNames(doc());
    expect(namesBefore).toContain('coverage_detail');

    const result = splitAt(live, 2, 'contract-s2d-travel');
    // NOT refused - the spanning guard correctly leaves this case alone.
    expect(result.results[0].ok).toBe(true);
    // Present while pending, which is what makes the loss so easy to miss.
    expect(bookmarkNames(doc())).toEqual(namesBefore);

    editor.revisions.acceptAll();

    // THE DEFECT. What this SHOULD assert, once fixed:
    //     expect(bookmarkNames(doc())).toEqual(namesBefore);
    // What it does today, because the bookmark is destroyed on accept:
    expect(bookmarkNames(doc())).toEqual([]);
  });

  it('S2(d2) a bookmark SPANNING the cut is clamped to the rows that stay, and says so', () => {
    // The range opens in row 1 and closes in row 3, so extracting from row 2
    // tears it and the clamp keeps it on the row that stays
    const live = open(spanningBookmarkTable());
    const namesBefore = bookmarkNames(doc());
    expect(namesBefore).toContain('coverage_span');

    const result = splitAt(live, 2, 'contract-s2d-span');
    expect(result.results[0].ok).toBe(true);
    expect(result.results[0].details).toContain(
      'bookmark "coverage_span" clamped to rows 1-1'
    );
    expect(bookmarkNames(doc())).toEqual(namesBefore);

    editor.revisions.acceptAll();
    expect(bookmarkNames(doc())).toEqual(namesBefore);
  });

  it('S2(e) carries the section format onto the result', () => {
    // The new table lands in the same section, so the page geometry it is laid
    // out against must be the section's own. If a split silently changed the
    // page width the rows would re-wrap and the document would repaginate - a
    // change nobody asked for, in a document somebody is about to send.
    const live = open(docWith(stripedTable(4)));
    const sectionFormatBefore = JSON.stringify(
      (doc().sections ?? doc().sec)[0].sectionFormat ??
        (doc().sections ?? doc().sec)[0].sf
    );
    const result = splitAt(live, 2, 'contract-s2e');
    expect(result.results[0].ok).toBe(true);
    editor.revisions.acceptAll();

    const sections = doc().sections ?? doc().sec;
    expect(sections).toHaveLength(1);
    expect(JSON.stringify(sections[0].sectionFormat ?? sections[0].sf)).toBe(
      sectionFormatBefore
    );
  });

  it('S2(f) leaves list numbering continuous around the split', () => {
    // A numbered list either side of the table must still read 1, 2 after the
    // split. Relocation that resets a list is the kind of damage nobody notices
    // in review and everybody notices in print.
    const numbered = (text: string, listId: number) => ({
      paragraphFormat: { listFormat: { listId, listLevelNumber: 0 } },
      characterFormat: {},
      inlines: [{ characterFormat: {}, text }]
    });
    // A bare listFormat.listId does not survive serialization on its own: the
    // document has to actually DEFINE the list, or SyncFusion drops the
    // reference and every paragraph comes back unnumbered. Learned from this
    // test's own control, which failed on the pristine document before the
    // split had run at all - and would otherwise have blamed the engine for my
    // construction.
    const live = open({
      lists: [{ listId: 1, abstractListId: 1 }],
      abstractLists: [
        {
          abstractListId: 1,
          levels: [
            {
              listLevelPattern: 'Arabic',
              followCharacter: 'Tab',
              startAt: 1,
              restartLevel: 0,
              numberFormat: '%1.',
              characterFormat: {},
              paragraphFormat: {}
            }
          ]
        }
      ],
      sections: [
        {
          sectionFormat: { pageWidth: 612, pageHeight: 792 },
          blocks: [
            numbered('First point', 1),
            stripedTable(4),
            numbered('Second point', 1),
            para('Driver Information')
          ]
        }
      ]
    });
    // NEGATIVE CONTROL for this test's own accessor: if the PRISTINE document
    // does not already read [1, 1], the assertion below would be measuring my
    // path into paragraphFormat rather than the engine's behaviour.
    const listIdsOf = () =>
      blocksOf()
        .filter((b: any) => !isTable(b))
        .map((b: any) => (b.paragraphFormat ?? b.pf)?.listFormat?.listId)
        .filter((id: any) => id != null);
    expect(listIdsOf()).toEqual([1, 1]);

    const result = apply(
      live,
      [
        {
          op: 'split_table',
          anchor: '0;1;0;0;0',
          splitAtRow: 2,
          targetAnchor: '0;2',
          position: 'before',
          group: 'g'
        }
      ],
      'contract-s2f'
    );
    expect(result.results[0].ok).toBe(true);
    editor.revisions.acceptAll();

    // Both numbered paragraphs still belong to the same list.
    expect(listIdsOf()).toEqual([1, 1]);
  });

  it('(f) the accepted result matches what the legacy split produced on an unbound table', () => {
    // Parity, so the recomposition is a change of MECHANISM and not a change of
    // outcome. Recorded here as the accepted text of both tables; the legacy
    // expectation is the row content and header the old path produced.
    const live = open(docWith(stripedTable(4)));
    const result = splitAt(live, 2, 'contract-f');
    expect(result.results[0].ok).toBe(true);
    editor.revisions.acceptAll();

    const [original, created] = tablesIn();
    const textOf = (t: any) =>
      (t.rows ?? t.r).map((r: any) =>
        (r.cells ?? r.c)
          .map((c: any) =>
            ((c.blocks ?? c.b)[0]?.inlines ?? [])
              .map((i: any) => i.text ?? '')
              .join('')
          )
          .join('|')
      );

    // Header preserved on both; no row lost or duplicated across the pair.
    expect(textOf(original)[0]).toBe('Coverage|Amount');
    expect(textOf(created)[0]).toBe('Coverage|Amount');
    const bodyRows = [
      ...textOf(original).slice(1),
      ...textOf(created).slice(1)
    ];
    expect(bodyRows).toEqual([
      'Item 1|$100',
      'Item 2|$200',
      'Item 3|$300',
      'Item 4|$400'
    ]);
  });
});
