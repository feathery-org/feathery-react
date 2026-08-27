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
    { rowFormat: {}, cells: [cell('Coverage', HEADER_BAND), cell('Amount', HEADER_BAND)] },
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
    { rowFormat: {}, cells: [cell('Item', HEADER_BAND), cell('Amount', HEADER_BAND)] },
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
const bookmarkedTable = () => ({
  sections: [
    {
      sectionFormat: { pageWidth: 612, pageHeight: 792 },
      blocks: [
        para('Coverages and Limits'),
        {
          rows: [
            { rowFormat: {}, cells: [cell('Coverage', HEADER_BAND), cell('Amount', HEADER_BAND)] },
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
      bands.slice(1).every((b, i) => (i % 2 === 0 ? b === UNSHADED : b === STRIPE));
    expect(bodyAlternates(originalBands)).toBe(true);
    expect(bodyAlternates(createdBands)).toBe(true);
  });

  it('(c) splits a BOUND table, conserving every binding tag', () => {
    // The capability this slice buys back. Today this is refused outright.
    const live = open(docWith(boundStripedTable()));
    const before = tagsIn(doc()).sort();
    expect(before.length).toBe(3);

    const result = splitAt(live, 2, 'contract-c');
    expect(result.results[0].ok).toBe(true);

    // Judged after ACCEPT, because that is where binding damage has landed
    // every time we have seen it: the pending view kept all eleven tags on the
    // HILB document and ten of them died on accept.
    editor.revisions.acceptAll();
    const after = tagsIn(doc()).sort();

    // Conserved: same tags, same count, none destroyed and none invented.
    expect(after).toEqual(before);

    // IDENTITY, which tag conservation alone does not prove. A split RELOCATES
    // rows; it does not copy them. So each binding must still appear EXACTLY
    // ONCE - a duplicate would mean the extracted rows were cloned into a second
    // identity while the originals survived, which is how one value silently
    // becomes two that drift apart.
    const counts = new Map<string, number>();
    for (const tag of after) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    expect([...counts.values()].every((n) => n === 1)).toBe(true);

    // And the rows carry their own row identity across the move rather than
    // being renumbered into the copy's positions - a formula that referenced
    // r-2 must still find r-2.
    expect(after.filter((t) => /row=r-2/.test(t))).toHaveLength(1);
    expect(after.filter((t) => /row=r-3/.test(t))).toHaveLength(1);
  });

  it('(d) wraps the whole change set in exactly ONE undo group', () => {
    // WHAT THIS PROVES, and what it does not.
    //
    // The property that matters to a person is "one Ctrl+Z puts it back", and
    // that CANNOT be tested here: editorHistory.undo() throws in jsdom -
    // "Cannot read properties of undefined (reading 'getSplitWidgets')" from
    // inside SyncFusion's re-layout, which needs real rendering widgets. So a
    // byte-equal-after-undo assertion in this harness would not be a strict
    // test, it would be an impossible one, and writing it would have quietly
    // parked the row as permanently red for the wrong reason.
    //
    // What IS checkable here is the mechanism the property rests on: the change
    // set opens exactly one undo group and closes it, so the SDK records one
    // entry instead of one per operation. The byte-equal half is owed by the
    // browser proof, and is recorded as owed rather than implied.
    const live = open(docWith(stripedTable(5)));
    const history = (editor as any).editorHistory;
    let begins = 0;
    let ends = 0;
    const realBegin = history.beginUndoAction.bind(history);
    const realEnd = history.endUndoAction.bind(history);
    history.beginUndoAction = () => {
      begins++;
      return realBegin();
    };
    history.endUndoAction = () => {
      ends++;
      return realEnd();
    };

    const result = splitAt(live, 3, 'contract-d');
    expect(result.results[0].ok).toBe(true);
    expect(begins).toBe(1);
    expect(ends).toBe(1);
  });

  it('(d2) closes the undo group even when the change set FAILS', () => {
    // The half that actually bites. A group left open silently swallows the
    // NEXT change set, so a later undo reverts two acts at once - and the
    // person who typed the second one never asked for the first to go.
    const live = open(docWith(stripedTable(5)));
    const history = (editor as any).editorHistory;
    let begins = 0;
    let ends = 0;
    const realBegin = history.beginUndoAction.bind(history);
    const realEnd = history.endUndoAction.bind(history);
    history.beginUndoAction = () => {
      begins++;
      return realBegin();
    };
    history.endUndoAction = () => {
      ends++;
      return realEnd();
    };

    // A refusal, not a success: an anchor that addresses nothing.
    const result = apply(
      live,
      [
        {
          op: 'split_table',
          anchor: '0;9;0;0;0',
          splitAtRow: 2,
          targetAnchor: '0;2',
          position: 'before',
          group: 'g'
        }
      ],
      'contract-d2'
    );
    expect(result.results[0].ok).toBe(false);
    expect(begins).toBe(1);
    expect(ends).toBe(1);
  });

  it('(e) rejecting every revision restores the document byte-equal', () => {
    // The conservation law. If rejecting the whole change set does not give the
    // prior document back, the change was never truly reviewable.
    const live = open(docWith(stripedTable(5)));
    const before = editor.serialize();
    const result = splitAt(live, 3, 'contract-e');
    expect(result.results[0].ok).toBe(true);

    editor.revisions.rejectAll();
    expect(editor.serialize()).toBe(before);
  });

  it('S2(d) refuses a boundary that would cut a bookmark, and the bookmark survives', () => {
    // The row carrying the bookmark is row 2; splitting AT row 2 puts the tear
    // straight through the named range. Refusing is the answer, and the refusal
    // has to leave the bookmark intact - a "refusal" that dropped it would be
    // the same lie this workstream keeps finding.
    const live = open(bookmarkedTable());
    const before = editor.serialize();
    const namesBefore = bookmarkNames(doc());
    expect(namesBefore).toContain('coverage_detail');

    const result = splitAt(live, 2, 'contract-s2d');
    expect(result.results[0].ok).toBe(false);
    expect(editor.serialize()).toBe(before);
    expect(bookmarkNames(doc())).toEqual(namesBefore);
  });

  it('S2(e) carries the section format onto the result', () => {
    // The new table lands in the same section, so the page geometry it is laid
    // out against must be the section's own. If a split silently changed the
    // page width the rows would re-wrap and the document would repaginate - a
    // change nobody asked for, in a document somebody is about to send.
    const live = open(docWith(stripedTable(4)));
    const sectionFormatBefore = JSON.stringify(
      (doc().sections ?? doc().sec)[0].sectionFormat ?? (doc().sections ?? doc().sec)[0].sf
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
        (r.cells ?? r.c).map((c: any) =>
          ((c.blocks ?? c.b)[0]?.inlines ?? []).map((i: any) => i.text ?? '').join('')
        ).join('|')
      );

    // Header preserved on both; no row lost or duplicated across the pair.
    expect(textOf(original)[0]).toBe('Coverage|Amount');
    expect(textOf(created)[0]).toBe('Coverage|Amount');
    const bodyRows = [...textOf(original).slice(1), ...textOf(created).slice(1)];
    expect(bodyRows).toEqual([
      'Item 1|$100',
      'Item 2|$200',
      'Item 3|$300',
      'Item 4|$400'
    ]);
  });
});
