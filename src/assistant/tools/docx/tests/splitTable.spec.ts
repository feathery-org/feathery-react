// One table becomes two, and the engine writes no content.
//
// The captain: "we need split to work too. Also smart split we can be like split
// this table into two table one with all of a specific items from the first
// table. And the items could be in any rows in the main table."
//
// Two shapes. `splitAtRow` divides at a boundary; `rows` extracts a SET that need
// not be contiguous - which is the one he actually asked for. Both must leave two
// tables that keep the source's formatting AND its header band, with the leftover
// rows intact and nothing retyped.
//
// What every case asserts, because `ok: true` from SyncFusion only means "did not
// throw": accepting produces the two intended tables, every value that moved
// exists exactly ONCE, the appearance facts of each surviving row equal the facts
// that row had BEFORE the split, rejecting restores the document string-equal on
// the same editor instance, and the whole split is ONE entry in changeSet.groups.
//
// Nothing here asserts a literal colour. Every appearance assertion compares a
// row against what the FIXTURE gave that row, matched by the row's own text - so
// a document with different styling, a two-row header band, or no banding at all
// is covered by the same case. A test hardcoding this document's palette would
// pass while the feature was broken for the next customer.
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
  EditOp,
  LiveEditor
} from '../syncfusionDocumentOps';
import { collectTableAppearance, inferHeaderRows } from '../tableAppearance';
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

if (!window.crypto?.getRandomValues) {
  Object.defineProperty(window, 'crypto', {
    value: {
      getRandomValues: (array: Uint8Array) =>
        require('crypto').randomFillSync(array)
    }
  });
}
if (!(window.SVGElement.prototype as any).getBBox) {
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);
}

function makeEditor(sfdt: any): DocumentEditor {
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

function destroyEditor(editor: DocumentEditor): void {
  const element = editor.element;
  editor.destroy();
  element?.remove();
}

const para = (text: string, styleName?: string) => ({
  inlines: text ? [{ text }] : [],
  ...(styleName ? { paragraphFormat: { styleName } } : {})
});

const cell = (text: string, shading?: string) => ({
  cellFormat: shading ? { shading: { backgroundColor: shading } } : {},
  blocks: [{ inlines: [{ text }] }]
});

const headingStyles = () => [
  {
    type: 'Paragraph',
    name: 'Normal',
    next: 'Normal',
    characterFormat: { fontSize: 11 }
  },
  {
    type: 'Paragraph',
    name: 'Heading 1',
    basedOn: 'Normal',
    next: 'Normal',
    characterFormat: { bold: true, fontSize: 16 },
    paragraphFormat: { outlineLevel: 'Level1', beforeSpacing: 12 }
  }
];

/** One line item; `fill` is the row's own banding, whatever it happens to be. */
const line = (name: string, carrier: string, fill?: string) => ({
  rowFormat: {},
  cells: [cell(name, fill), cell(carrier, fill)]
});

const HEADER_FILL = '#001B49';
const BAND_FILL = '#E6E6E6';

/**
 * A banded schedule: one flagged header, five data rows alternating between a
 * fill and no fill, followed by a paragraph so the table is not the document's
 * tail. Three of the five lines are Acme - the "all of a specific items" set,
 * and they are deliberately NOT adjacent.
 */
const scheduleFixture = () => ({
  sections: [
    {
      blocks: [
        para('Coverage Schedule', 'Heading 1'), // 0;0
        para('All lines are listed below.'), // 0;1
        {
          // 0;2
          tableFormat: { allowAutoFit: true },
          rows: [
            {
              rowFormat: { isHeader: true },
              cells: [
                cell('Line', HEADER_FILL),
                cell('Carrier', HEADER_FILL)
              ]
            },
            line('General Liability', 'Acme', BAND_FILL), // 1
            line('Auto', 'Beta'), // 2
            line('Property', 'Acme', BAND_FILL), // 3
            line('Workers Comp', 'Gamma'), // 4
            line('Umbrella', 'Acme', BAND_FILL) // 5
          ]
        },
        para('Next Steps', 'Heading 1'), // 0;3
        para('Confirm by Friday.') // 0;4
      ]
    }
  ],
  styles: headingStyles()
});

/** The table is the document's LAST block. */
const tailFixture = () => ({
  sections: [
    {
      blocks: [
        para('Coverage Schedule', 'Heading 1'),
        para('All lines are listed below.'),
        {
          tableFormat: { allowAutoFit: true },
          rows: [
            {
              rowFormat: { isHeader: true },
              cells: [cell('Line', HEADER_FILL), cell('Carrier', HEADER_FILL)]
            },
            line('General Liability', 'Acme', BAND_FILL),
            line('Auto', 'Beta'),
            line('Property', 'Acme', BAND_FILL)
          ]
        }
      ]
    }
  ],
  styles: headingStyles()
});

/** A vertical merge spanning rows 1..2 in column 0. */
const mergedFixture = () => ({
  sections: [
    {
      blocks: [
        para('Coverage Schedule', 'Heading 1'),
        {
          tableFormat: { allowAutoFit: true },
          rows: [
            {
              rowFormat: { isHeader: true },
              cells: [cell('Line', HEADER_FILL), cell('Carrier', HEADER_FILL)]
            },
            {
              rowFormat: {},
              cells: [
                { cellFormat: { rowSpan: 2 }, blocks: [{ inlines: [{ text: 'Package' }] }] },
                cell('Acme')
              ]
            },
            { rowFormat: {}, cells: [cell('Beta')] },
            line('Auto', 'Gamma')
          ]
        },
        para('End')
      ]
    }
  ],
  styles: headingStyles()
});

/** Header row only - no data band at all. */
const headerOnlyFixture = () => ({
  sections: [
    {
      blocks: [
        para('Coverage Schedule', 'Heading 1'),
        {
          tableFormat: { allowAutoFit: true },
          rows: [
            {
              rowFormat: { isHeader: true },
              cells: [cell('Line', HEADER_FILL), cell('Carrier', HEADER_FILL)]
            }
          ]
        },
        para('End')
      ]
    }
  ],
  styles: headingStyles()
});

const apply = (editor: DocumentEditor, edits: EditOp[], changeSetId: string) =>
  applyDocumentEdits(editor as unknown as LiveEditor, { edits, changeSetId });

/** Every table in document order, with each row's facts and text. */
const tablesOf = (editor: DocumentEditor) => {
  const sfdt = JSON.parse(editor.serialize());
  const blocks: any[] = sfdt.sections?.[0]?.blocks ?? sfdt.sec?.[0]?.b ?? [];
  const flat = flattenSfdt(sfdt);
  return blocks
    .map((block, index) => ({
      anchor: `0;${index}`,
      appearance: collectTableAppearance(block)
    }))
    .filter((entry) => entry.appearance)
    .map((entry) => {
      const appearance = entry.appearance as any;
      return {
        anchor: entry.anchor,
        headerRows: inferHeaderRows(appearance),
        layout: appearance.layout ?? null,
        styleName: appearance.styleName ?? null,
        rows: appearance.rows.map((row: any, index: number) => ({
          index,
          isHeader: row.isHeader ?? false,
          // The row's own shading, and each cell's where the cells disagree -
          // collectTableAppearance hoists a shared fill up to the row, so
          // reading only the per-cell path reports every uniform row as unfilled.
          shading: row.appearance?.shading ?? null,
          cellShading: row.cells.map((entry2: any) => entry2?.shading ?? null),
          text: flat
            .filter((b) => b.anchor.startsWith(`${entry.anchor};${index};`))
            .map((b) => b.text)
            .join('|')
        }))
      };
    });
};

/** A row's appearance facts keyed by its TEXT, across every table. */
const factsByRowText = (editor: DocumentEditor) => {
  const out = new Map<string, any>();
  for (const table of tablesOf(editor))
    for (const row of table.rows)
      out.set(row.text, {
        isHeader: row.isHeader,
        shading: row.shading,
        cellShading: row.cellShading
      });
  return out;
};

const allTexts = (editor: DocumentEditor): string[] =>
  flattenSfdt(JSON.parse(editor.serialize())).map((block) => block.text);

const revisionTally = (editor: DocumentEditor) => {
  const changes = (editor.revisions as any)?.changes ?? [];
  const out: Record<string, number> = {};
  for (const change of changes)
    out[change.revisionType] = (out[change.revisionType] ?? 0) + 1;
  return out;
};

/** Row texts of one table, in order. */
const rowsOf = (editor: DocumentEditor, index: number): string[] =>
  tablesOf(editor)[index]?.rows.map((row) => row.text) ?? [];

/** Each table's column grid beside the cell count its rows carry, counts not widths */
const gridsOf = (editor: DocumentEditor) => {
  const sfdt = JSON.parse(editor.serialize());
  const blocks: any[] = sfdt.sections?.[0]?.blocks ?? sfdt.sec?.[0]?.b ?? [];
  return blocks
    .filter((block) => block.rows ?? block.r)
    .map((block) => ({
      columnCount: block.columnCount ?? block.colc ?? null,
      gridColumns: (block.grid ?? block.grd ?? []).length,
      cellsPerRow: Array.from(
        new Set(
          (block.rows ?? block.r).map(
            (row: any) => (row.cells ?? row.c ?? []).length
          )
        )
      )
    }));
};

describe('split_table: the selective split, rows anywhere in the table', () => {
  const ACME = [1, 3, 5];

  it('extracts a non-contiguous set into a new table and leaves the rest', () => {
    const editor = makeEditor(scheduleFixture());
    try {
      const result = apply(
        editor,
        [
          {
            op: 'split_table',
            anchor: '0;2;0;0;0',
            rows: ACME,
            targetAnchor: '0;3',
            position: 'before'
          }
        ],
        'split-acme'
      );
      expect(result.results[0]).toMatchObject({ ok: true, op: 'split_table' });
      editor.revisions.acceptAll();

      const tables = tablesOf(editor);
      expect(tables).toHaveLength(2);
      // The source keeps its header and only the rows nobody asked for.
      expect(rowsOf(editor, 0)).toEqual([
        'Line|Carrier',
        'Auto|Beta',
        'Workers Comp|Gamma'
      ]);
      // The new table has the header too, and exactly the extracted rows.
      expect(rowsOf(editor, 1)).toEqual([
        'Line|Carrier',
        'General Liability|Acme',
        'Property|Acme',
        'Umbrella|Acme'
      ]);
    } finally {
      destroyEditor(editor);
    }
  });

  it('writes no content: every value that moved exists exactly once', () => {
    const editor = makeEditor(scheduleFixture());
    try {
      apply(
        editor,
        [
          {
            op: 'split_table',
            anchor: '0;2;0;0;0',
            rows: ACME,
            targetAnchor: '0;3',
            position: 'before'
          }
        ],
        'split-once'
      );
      editor.revisions.acceptAll();
      const texts = allTexts(editor);
      // A retyped table would duplicate these. Only the HEADER is reproduced,
      // because a split gives both tables the source's header band.
      for (const value of [
        'General Liability',
        'Auto',
        'Property',
        'Workers Comp',
        'Umbrella',
        'Beta',
        'Gamma'
      ])
        expect(texts.filter((text) => text === value)).toHaveLength(1);
      expect(texts.filter((text) => text === 'Acme')).toHaveLength(3);
      expect(texts.filter((text) => text === 'Line')).toHaveLength(2);
      expect(texts.filter((text) => text === 'Carrier')).toHaveLength(2);
    } finally {
      destroyEditor(editor);
    }
  });

  it('every surviving row keeps the appearance facts it had before the split', () => {
    const editor = makeEditor(scheduleFixture());
    try {
      // The property, computed from the fixture: whatever each row looked like
      // before, it looks like that afterwards - in whichever table it landed.
      const before = factsByRowText(editor);
      apply(
        editor,
        [
          {
            op: 'split_table',
            anchor: '0;2;0;0;0',
            rows: ACME,
            targetAnchor: '0;3',
            position: 'before'
          }
        ],
        'split-appearance'
      );
      editor.revisions.acceptAll();
      const after = factsByRowText(editor);
      expect(after.size).toBe(before.size);
      for (const [text, facts] of before.entries()) {
        expect(after.has(text)).toBe(true);
        expect(after.get(text)).toEqual(facts);
      }
    } finally {
      destroyEditor(editor);
    }
  });

  it('the new table carries the source table layout, not a default one', () => {
    const editor = makeEditor(scheduleFixture());
    try {
      const source = tablesOf(editor)[0];
      apply(
        editor,
        [
          {
            op: 'split_table',
            anchor: '0;2;0;0;0',
            rows: ACME,
            targetAnchor: '0;3',
            position: 'before'
          }
        ],
        'split-layout'
      );
      editor.revisions.acceptAll();
      const [left, right] = tablesOf(editor);
      // Derived from the fixture's own table, never asserted as literals. Column
      // widths are excluded deliberately: under allowAutoFit they are re-fitted
      // from content, so they are a rendered consequence rather than a stated
      // property, and asserting them would fail on a correct split.
      for (const table of [left, right]) {
        expect(table.styleName).toBe(source.styleName);
        expect(table.layout?.allowAutoFit).toBe(source.layout?.allowAutoFit);
        expect(table.layout?.preferredWidthType).toBe(
          source.layout?.preferredWidthType
        );
        expect(table.layout?.tableAlignment).toBe(source.layout?.tableAlignment);
        // Header band reproduced, DERIVED - so a two-row band is covered too.
        expect(table.headerRows).toBe(source.headerRows);
      }
    } finally {
      destroyEditor(editor);
    }
  });

  it('rejecting restores the document exactly, and it is one card', () => {
    const editor = makeEditor(scheduleFixture());
    try {
      const before = editor.serialize();
      const result = apply(
        editor,
        [
          {
            op: 'split_table',
            anchor: '0;2;0;0;0',
            rows: ACME,
            targetAnchor: '0;3',
            position: 'before'
          }
        ],
        'split-reject'
      );
      expect(result.results[0]).toMatchObject({ ok: true });
      // One op, therefore one revision group, therefore one rail card: accept it
      // or reject it as a unit.
      expect(listRevisionGroups(editor as any)).toHaveLength(1);
      const tally = revisionTally(editor);
      expect(tally.Insertion).toBeGreaterThan(0);
      expect(tally.Deletion).toBeGreaterThan(0);
      editor.revisions.rejectAll();
      // Same editor instance: reopening normalizes styles and would give a false
      // negative that is an open/serialize artifact rather than a reject one.
      expect(editor.serialize()).toBe(before);
      expect(tablesOf(editor)).toHaveLength(1);
      expect(rowsOf(editor, 0)).toHaveLength(6);
    } finally {
      destroyEditor(editor);
    }
  });

  it('places the new table after the source when asked to', () => {
    const editor = makeEditor(scheduleFixture());
    try {
      // Which side the copy lands on is the target's business, and the engine
      // has to keep track of which table is which either way.
      const result = apply(
        editor,
        [
          {
            op: 'split_table',
            anchor: '0;2;0;0;0',
            rows: ACME,
            targetAnchor: '0;1',
            position: 'before'
          }
        ],
        'split-before-source'
      );
      expect(result.results[0]).toMatchObject({ ok: true });
      editor.revisions.acceptAll();
      // The new table now precedes the source, and the rows still went the
      // right way round: extracted rows in the new table, leftovers in the old.
      expect(rowsOf(editor, 0)).toEqual([
        'Line|Carrier',
        'General Liability|Acme',
        'Property|Acme',
        'Umbrella|Acme'
      ]);
      expect(rowsOf(editor, 1)).toEqual([
        'Line|Carrier',
        'Auto|Beta',
        'Workers Comp|Gamma'
      ]);
    } finally {
      destroyEditor(editor);
    }
  });
});

// A table whose NEXT BLOCK is another table.
//
// `flattenSfdt` gives a table no block of its own - its CELLS are the blocks - so
// the block after a table is a `table_cell` carrying the same Word section index.
// The range end shared by every relocation resolver used to cross into any
// following block of the same Word section, and ending at a cell's offset 0
// selects the ENTIRE table that cell belongs to: the captured payload came back
// holding two tables and the paragraphs past them, so the split pasted a copy of
// its innocent neighbour alongside its own rows.
//
// This is not an exotic shape. A split is precisely how two tables come to sit
// against each other, so the SECOND split of any table reached it - which is how
// it was found live. Both entry points are pinned: adjacency the document was
// authored with, and adjacency a previous split created.
describe('split_table: a table sitting directly against another table', () => {
  const ACME_ROWS = [1, 3, 5];
  const NEIGHBOUR_ROWS = [
    'Zone|Limit',
    'NEIGHBOUR-ROW-1|X1',
    'NEIGHBOUR-ROW-2|X2'
  ];

  /** Table A at 0;2 and table B at 0;3, with nothing at all between them. */
  const adjacentTablesFixture = () => ({
    sections: [
      {
        blocks: [
          para('Coverage Schedule', 'Heading 1'), // 0;0
          para('All lines are listed below.'), // 0;1
          {
            // 0;2 - the table being split
            tableFormat: { allowAutoFit: true },
            rows: [
              {
                rowFormat: { isHeader: true },
                cells: [cell('Line', HEADER_FILL), cell('Carrier', HEADER_FILL)]
              },
              line('General Liability', 'Acme', BAND_FILL),
              line('Auto', 'Beta'),
              line('Property', 'Acme', BAND_FILL)
            ]
          },
          {
            // 0;3 - the neighbour, which this op must not touch
            tableFormat: { allowAutoFit: true },
            rows: [
              {
                rowFormat: { isHeader: true },
                cells: [cell('Zone', HEADER_FILL), cell('Limit', HEADER_FILL)]
              },
              line('NEIGHBOUR-ROW-1', 'X1'),
              line('NEIGHBOUR-ROW-2', 'X2')
            ]
          },
          para('Next Steps', 'Heading 1'), // 0;4
          para('Confirm by Friday.') // 0;5
        ]
      }
    ],
    styles: headingStyles()
  });

  it('splits the addressed table and leaves the neighbour untouched', () => {
    const editor = makeEditor(adjacentTablesFixture());
    try {
      const result = apply(
        editor,
        [
          {
            op: 'split_table',
            anchor: '0;2;0;0;0',
            rows: [1, 3],
            targetAnchor: '0;4',
            position: 'before'
          }
        ],
        'split-against-neighbour'
      );
      expect(result.results[0]).toMatchObject({ ok: true });
      editor.revisions.acceptAll();

      // THREE tables, never four: the source, the untouched neighbour, and the
      // one the split made. The fourth was a partial copy of the neighbour.
      const tables = tablesOf(editor);
      expect(tables).toHaveLength(3);
      expect(rowsOf(editor, 0)).toEqual(['Line|Carrier', 'Auto|Beta']);
      expect(rowsOf(editor, 1)).toEqual(NEIGHBOUR_ROWS);
      expect(rowsOf(editor, 2)).toEqual([
        'Line|Carrier',
        'General Liability|Acme',
        'Property|Acme'
      ]);
      // Nothing the neighbour is made of may be duplicated anywhere either: a
      // row count alone would pass a payload that carried the neighbour's text
      // into some other table.
      const texts = allTexts(editor);
      for (const value of ['Zone', 'NEIGHBOUR-ROW-1', 'NEIGHBOUR-ROW-2', 'X2'])
        expect(texts.filter((text) => text === value)).toHaveLength(1);
    } finally {
      destroyEditor(editor);
    }
  });

  it('rejecting the split of an adjacent table restores the document exactly', () => {
    const editor = makeEditor(adjacentTablesFixture());
    try {
      const before = editor.serialize();
      const result = apply(
        editor,
        [
          {
            op: 'split_table',
            anchor: '0;2;0;0;0',
            rows: [1, 3],
            targetAnchor: '0;4',
            position: 'before'
          }
        ],
        'split-against-neighbour-reject'
      );
      expect(result.results[0]).toMatchObject({ ok: true });
      // One card, so the reviewer sees one thing to reject.
      expect(listRevisionGroups(editor as any)).toHaveLength(1);
      editor.revisions.rejectAll();
      expect(editor.serialize()).toEqual(before);
    } finally {
      destroyEditor(editor);
    }
  });

  it('a second split of a table the first split left adjacent stays clean', () => {
    const editor = makeEditor(scheduleFixture());
    try {
      // Turn one puts the new table immediately after the source, which is what
      // `position: 'before'` the following heading means - so the two tables are
      // now neighbours with nothing between them.
      expect(
        apply(
          editor,
          [
            {
              op: 'split_table',
              anchor: '0;2;0;0;0',
              rows: ACME_ROWS,
              targetAnchor: '0;3',
              position: 'before'
            }
          ],
          'split-turn-one'
        ).results[0]
      ).toMatchObject({ ok: true });
      editor.revisions.acceptAll();
      expect(tablesOf(editor)).toHaveLength(2);
      expect(rowsOf(editor, 1)).toEqual([
        'Line|Carrier',
        'General Liability|Acme',
        'Property|Acme',
        'Umbrella|Acme'
      ]);

      // Turn two splits the source again. Its neighbour is the table turn one
      // produced, and it must survive with every row it had.
      //
      // The target is 0;5, not 0;4. Turn one now leaves an empty separator
      // between the two tables (the captain, 2026-08-27: tables that are split
      // "should not be just attached to each other"), so every block after the
      // first split shifted by one and 0;4 is the table turn one created - not
      // the heading. A table is not addressable as a relocation target at all,
      // so the old index does not merely aim elsewhere, it aims at nothing.
      expect(
        apply(
          editor,
          [
            {
              op: 'split_table',
              anchor: '0;2;0;0;0',
              rows: [1],
              targetAnchor: '0;5',
              position: 'before'
            }
          ],
          'split-turn-two'
        ).results[0]
      ).toMatchObject({ ok: true });
      editor.revisions.acceptAll();

      expect(tablesOf(editor)).toHaveLength(3);
      expect(rowsOf(editor, 0)).toEqual([
        'Line|Carrier',
        'Workers Comp|Gamma'
      ]);
      expect(rowsOf(editor, 1)).toEqual([
        'Line|Carrier',
        'General Liability|Acme',
        'Property|Acme',
        'Umbrella|Acme'
      ]);
      expect(rowsOf(editor, 2)).toEqual(['Line|Carrier', 'Auto|Beta']);
      // Turn one's rows exist once each, not once per later split.
      const texts = allTexts(editor);
      for (const value of ['General Liability', 'Property', 'Umbrella'])
        expect(texts.filter((text) => text === value)).toHaveLength(1);
    } finally {
      destroyEditor(editor);
    }
  });

  // The same defect reached WITHOUT accepting in between, which is the shape a
  // reviewer meets: two turns, both cards pending, then Accept All. Turn one's
  // copy makes the tables adjacent whether or not it has been accepted, so turn
  // two captured the neighbour AND the paragraphs past it - and pasting that
  // payload FUSED paragraphs ("Confirm by Friday.Next Steps") on top of adding a
  // table nobody asked for. `detectBatchedSplits` cannot see this: it refuses two
  // splits in ONE change set, and these are two.
  //
  // Every destination is covered because the paste point is what the fused text
  // lands on, and each one fused a different pair.
  // Destinations AFTER the first split's output shifted by one when the split
  // began leaving an empty separator between the two tables (the captain,
  // 2026-08-27: split tables "should not be just attached to each other"). The
  // intro paragraph sits BEFORE the split and is unmoved, which is why only two
  // of the three changed - a useful check that the shift is real and not a
  // blanket renumbering.
  for (const [name, targetAnchor, position] of [
    ['before the following heading', '0;5', 'before'],
    ['after the trailing paragraph', '0;6', 'after'],
    ['before the intro paragraph', '0;1', 'before']
  ] as Array<[string, string, string]>) {
    it(`a second split while the first is still pending stays clean - target ${name}`, () => {
      const editor = makeEditor(scheduleFixture());
      try {
        expect(
          apply(
            editor,
            [
              {
                op: 'split_table',
                anchor: '0;2;0;0;0',
                rows: ACME_ROWS,
                targetAnchor: '0;3',
                position: 'before'
              }
            ],
            'pending-turn-one'
          ).results[0]
        ).toMatchObject({ ok: true });
        // Deliberately NOT accepted: turn one's card is still pending.
        expect(
          apply(
            editor,
            [
              {
                op: 'split_table',
                anchor: '0;2;0;0;0',
                rows: [2],
                targetAnchor,
                position
              }
            ],
            'pending-turn-two'
          ).results[0]
        ).toMatchObject({ ok: true });
        // Two turns, two independently reviewable cards.
        expect(listRevisionGroups(editor as any)).toHaveLength(2);
        editor.revisions.acceptAll();

        // Three tables: the source, turn one's, turn two's. A fourth was a
        // pruned copy of whichever table turn two's range ran into.
        expect(tablesOf(editor)).toHaveLength(3);
        // No paragraph may have absorbed another. Every body paragraph of the
        // fixture still reads exactly what it read, and exactly once.
        const texts = allTexts(editor);
        for (const value of [
          'Coverage Schedule',
          'All lines are listed below.',
          'Next Steps',
          'Confirm by Friday.'
        ])
          expect(texts.filter((text) => text === value)).toHaveLength(1);
        // Every data row of the original table survives exactly once, in one
        // table or another - nothing duplicated into an extra one.
        for (const value of [
          'General Liability',
          'Auto',
          'Property',
          'Workers Comp',
          'Umbrella'
        ])
          expect(texts.filter((text) => text === value)).toHaveLength(1);
      } finally {
        destroyEditor(editor);
      }
    });
  }

  it('rejects both pending splits back to the original document', () => {
    const editor = makeEditor(scheduleFixture());
    try {
      const before = editor.serialize();
      apply(
        editor,
        [
          {
            op: 'split_table',
            anchor: '0;2;0;0;0',
            rows: ACME_ROWS,
            targetAnchor: '0;3',
            position: 'before'
          }
        ],
        'reject-turn-one'
      );
      apply(
        editor,
        [
          {
            op: 'split_table',
            anchor: '0;2;0;0;0',
            rows: [2],
            targetAnchor: '0;4',
            position: 'before'
          }
        ],
        'reject-turn-two'
      );
      editor.revisions.rejectAll();
      expect(editor.serialize()).toEqual(before);
    } finally {
      destroyEditor(editor);
    }
  });
});

describe('split_table: the positional split', () => {
  it('splitAtRow extracts that row and everything below it', () => {
    const editor = makeEditor(scheduleFixture());
    try {
      const result = apply(
        editor,
        [
          {
            op: 'split_table',
            anchor: '0;2;0;0;0',
            splitAtRow: 4,
            targetAnchor: '0;3',
            position: 'before'
          }
        ],
        'split-at-row'
      );
      expect(result.results[0]).toMatchObject({ ok: true });
      editor.revisions.acceptAll();
      expect(rowsOf(editor, 0)).toEqual([
        'Line|Carrier',
        'General Liability|Acme',
        'Auto|Beta',
        'Property|Acme'
      ]);
      expect(rowsOf(editor, 1)).toEqual([
        'Line|Carrier',
        'Workers Comp|Gamma',
        'Umbrella|Acme'
      ]);
    } finally {
      destroyEditor(editor);
    }
  });

  it('is exactly the equivalent explicit row list - one code path', () => {
    // Not an implementation detail: the two shapes normalize to one row set, and
    // if they ever diverged one of them would be a second, unproven path.
    const viaBoundary = makeEditor(scheduleFixture());
    const viaList = makeEditor(scheduleFixture());
    try {
      apply(
        viaBoundary,
        [
          {
            op: 'split_table',
            anchor: '0;2;0;0;0',
            splitAtRow: 4,
            targetAnchor: '0;3',
            position: 'before'
          }
        ],
        'boundary'
      );
      apply(
        viaList,
        [
          {
            op: 'split_table',
            anchor: '0;2;0;0;0',
            rows: [4, 5],
            targetAnchor: '0;3',
            position: 'before'
          }
        ],
        'list'
      );
      viaBoundary.revisions.acceptAll();
      viaList.revisions.acceptAll();
      expect(rowsOf(viaBoundary, 0)).toEqual(rowsOf(viaList, 0));
      expect(rowsOf(viaBoundary, 1)).toEqual(rowsOf(viaList, 1));
    } finally {
      destroyEditor(viaBoundary);
      destroyEditor(viaList);
    }
  });
});

describe('split_table: refusals derived from the document', () => {
  const CASES: Array<{
    name: string;
    fixture: () => any;
    edit: Record<string, unknown>;
    error: string;
    says: string[];
  }> = [
    {
      name: 'extracting every data row is a move, not a split',
      fixture: scheduleFixture,
      edit: { rows: [1, 2, 3, 4, 5] },
      error: 'split_table_takes_every_row',
      says: ['nothing but its header', 'move_section']
    },
    {
      name: 'extracting nothing',
      fixture: scheduleFixture,
      edit: { rows: [] },
      error: 'split_table_no_rows',
      says: ['No rows were named']
    },
    {
      name: 'neither rows nor splitAtRow',
      fixture: scheduleFixture,
      edit: {},
      error: 'split_table_no_rows',
      says: ['splitAtRow']
    },
    {
      name: 'both rows and splitAtRow',
      fixture: scheduleFixture,
      edit: { rows: [1], splitAtRow: 3 },
      error: 'split_table_rows_ambiguous',
      says: ['not both']
    },
    {
      name: 'a split point past the end of the table',
      fixture: scheduleFixture,
      edit: { splitAtRow: 9 },
      error: 'split_table_row_out_of_range',
      says: ['6 rows', 'Re-read']
    },
    {
      name: 'a row index past the end of the table',
      fixture: scheduleFixture,
      edit: { rows: [1, 42] },
      error: 'split_table_row_out_of_range',
      says: ['42']
    },
    {
      name: 'a header row is reproduced, never extracted',
      fixture: scheduleFixture,
      edit: { rows: [0, 1] },
      error: 'split_table_header_row',
      says: ['header band', 'REPRODUCES']
    },
    {
      name: 'a table that is nothing but its header',
      fixture: headerOnlyFixture,
      edit: { rows: [0] },
      error: 'split_table_header_only',
      says: ['no data rows']
    },
    {
      name: 'a vertical merge torn across the split',
      fixture: mergedFixture,
      edit: { rows: [2] },
      error: 'split_table_merged_row_span',
      says: ['vertically merged', 'together, or none']
    }
  ];

  it.each(CASES.map((entry) => [entry.name, entry] as const))(
    'refuses %s',
    (_name, testCase) => {
      const editor = makeEditor(testCase.fixture());
      try {
        const before = editor.serialize();
        const tableAnchor = tablesOf(editor)[0].anchor;
        const result = apply(
          editor,
          [
            {
              op: 'split_table',
              anchor: `${tableAnchor};0;0;0`,
              targetAnchor: '0;0',
              position: 'before',
              ...testCase.edit
            } as EditOp
          ],
          `refuse-${testCase.error}`
        );
        expect(result.results[0]).toMatchObject({
          ok: false,
          op: 'split_table',
          error: testCase.error
        });
        const said = `${result.results[0].message} ${(
          result.results[0].details ?? []
        ).join(' ')}`;
        for (const phrase of testCase.says) expect(said).toContain(phrase);
        // Every refusal is before any write.
        expect(editor.serialize()).toBe(before);
        expect(editor.revisions.length).toBe(0);
      } finally {
        destroyEditor(editor);
      }
    }
  );

  it('refuses an anchor that is not in a table', () => {
    const editor = makeEditor(scheduleFixture());
    try {
      const before = editor.serialize();
      const result = apply(
        editor,
        [
          {
            op: 'split_table',
            anchor: '0;0',
            rows: [1],
            targetAnchor: '0;3'
          }
        ],
        'refuse-not-a-cell'
      );
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'split_table_requires_cell_anchor'
      });
      expect(editor.serialize()).toBe(before);
    } finally {
      destroyEditor(editor);
    }
  });

  it('refuses a target inside the table being split', () => {
    const editor = makeEditor(scheduleFixture());
    try {
      const before = editor.serialize();
      const result = apply(
        editor,
        [
          {
            op: 'split_table',
            anchor: '0;2;0;0;0',
            rows: [1],
            // The table's own block: there is no destination outside what is
            // being split. Reused verbatim from the relocation target resolver.
            targetAnchor: '0;2'
          }
        ],
        'refuse-target-inside'
      );
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'relocation_anchor_not_found'
      });
      expect(editor.serialize()).toBe(before);
      expect(editor.revisions.length).toBe(0);
    } finally {
      destroyEditor(editor);
    }
  });

  it('refuses when the extraction would take the last row of a document-tail table', () => {
    const editor = makeEditor(tailFixture());
    try {
      const before = editor.serialize();
      // Row 3 is both an Acme line and the last row of a table that ends the
      // document, which SyncFusion cannot accept the deletion of. The refusal is
      // the shared one delete_row uses - not a second copy of the rule.
      const result = apply(
        editor,
        [
          {
            op: 'split_table',
            anchor: '0;2;0;0;0',
            rows: [1, 3],
            targetAnchor: '0;1',
            position: 'before'
          }
        ],
        'refuse-tail-row'
      );
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'document_tail_table_last_row'
      });
      expect(editor.serialize()).toBe(before);
      expect(editor.revisions.length).toBe(0);
    } finally {
      destroyEditor(editor);
    }
  });

  it('still splits a document-tail table when the last row stays put', () => {
    const editor = makeEditor(tailFixture());
    try {
      // The guard is precise, not a blanket ban on tail tables: extracting a row
      // that is NOT the last one is an ordinary split and must keep working.
      const result = apply(
        editor,
        [
          {
            op: 'split_table',
            anchor: '0;2;0;0;0',
            rows: [1],
            targetAnchor: '0;1',
            position: 'before'
          }
        ],
        'tail-ok'
      );
      expect(result.results[0]).toMatchObject({ ok: true });
      expect(() => editor.revisions.acceptAll()).not.toThrow();
      expect(rowsOf(editor, 0)).toEqual([
        'Line|Carrier',
        'General Liability|Acme'
      ]);
      expect(rowsOf(editor, 1)).toEqual([
        'Line|Carrier',
        'Auto|Beta',
        'Property|Acme'
      ]);
    } finally {
      destroyEditor(editor);
    }
  });

  it('refuses a source holding another author pending change', () => {
    const editor = makeEditor(scheduleFixture());
    try {
      // A split DELETES rows from the source, so rejecting this card would fold
      // away a human reviewer's pending edit - the same reason a move refuses.
      editor.enableTrackChanges = true;
      (editor as any).currentUser = 'Anthony Reviewer';
      editor.selection.select('0;2;2;0;0;0', '0;2;2;0;0;4');
      editor.editor.insertText('Motor');
      (editor as any).currentUser = 'Robin';
      editor.enableTrackChanges = false;
      const before = editor.serialize();
      const result = apply(
        editor,
        [
          {
            op: 'split_table',
            anchor: '0;2;0;0;0',
            rows: [1, 3],
            targetAnchor: '0;3',
            position: 'before'
          }
        ],
        'refuse-foreign'
      );
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'relocation_source_has_pending_review'
      });
      expect(result.results[0].message).toContain('Anthony Reviewer');
      expect(editor.serialize()).toBe(before);
    } finally {
      destroyEditor(editor);
    }
  });
});

describe('split_table: no content field exists to carry content', () => {
  // The invariant the op exists for, asserted against the REGISTRY rather than by
  // reading the handler: a split that could carry text would be a split a model
  // could retype through, which is the failure class this whole family removes.
  it('declares only row selectors and a destination', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DOCUMENT_EDITOR_CAPABILITIES } = require('../../../capabilities/registry');
    const entry = DOCUMENT_EDITOR_CAPABILITIES.find(
      (candidate: any) => candidate.op === 'split_table'
    );
    expect(entry).toBeDefined();
    expect(Object.keys(entry.params).sort()).toEqual([
      'position',
      'rows',
      'splitAtRow',
      'targetAnchor'
    ]);
    // No param may be free text: `targetAnchor` is an address and the rest are
    // numbers or a closed enum, so there is nowhere for a cell value to ride in.
    expect(entry.params.rows).toBe('int>=0[]?');
    expect(entry.params.splitAtRow).toBe('int>=0?');
    expect(entry.params.position).toMatch(/^enum\[/);
  });
});

describe("split_table: the captain's acceptance criteria", () => {
  const ACME = [1, 3, 5];

  // TWO captain instructions, and the later one narrows the earlier.
  //
  // 2026-08 (earlier): "Here it should NOT create a new subsection heading,
  // just a new table." That is about a HEADING - no title, no new section - and
  // this test originally extended it to forbid any paragraph at all.
  //
  // 2026-08-27 (later, and decisive): "if tables are split then there has to be
  // like a space between them right they should not be just attached to each
  // other."
  //
  // Word renders two flush tables as ONE table, so a split with nothing between
  // them is undone at render time. The empty separator is not content and not a
  // title; it is what makes the two tables be two tables. So the criterion is
  // now: no new heading, and no CONTENT paragraph - and the one paragraph that
  // does appear must be empty, which is asserted rather than assumed.
  it('adds a table, one EMPTY separator, and nothing else - no heading, no content', () => {
    const editor = makeEditor(scheduleFixture());
    try {
      const bodyBefore = flattenSfdt(JSON.parse(editor.serialize()))
        .filter((block) => block.kind !== 'table_cell')
        .map((block) => `${block.isHeading ? 'H' : 'P'}:${block.text}`);
      apply(
        editor,
        [
          {
            op: 'split_table',
            anchor: '0;2;0;0;0',
            rows: ACME,
            targetAnchor: '0;3',
            position: 'before'
          }
        ],
        'no-heading'
      );
      editor.revisions.acceptAll();
      const bodyAfter = flattenSfdt(JSON.parse(editor.serialize()))
        .filter((block) => block.kind !== 'table_cell')
        .map((block) => `${block.isHeading ? 'H' : 'P'}:${block.text}`);
      // Exactly one block appears, it is an EMPTY paragraph, and removing it
      // gives back the document as it was - so nothing else was composed: no
      // title, no heading, no text.
      expect(bodyAfter).toHaveLength(bodyBefore.length + 1);
      const separatorAt = bodyAfter.findIndex(
        (entry, index) => entry !== bodyBefore[index]
      );
      expect(separatorAt).toBeGreaterThanOrEqual(0);
      expect(bodyAfter[separatorAt]).toBe('P:');
      const withoutSeparator = [...bodyAfter];
      withoutSeparator.splice(separatorAt, 1);
      expect(withoutSeparator).toEqual(bodyBefore);
      expect(tablesOf(editor)).toHaveLength(2);
    } finally {
      destroyEditor(editor);
    }
  });

  // "for ALL the Coverages and Limit tables" - plural, so one op per table, and
  // the SECOND table's anchors have moved by the time its edit runs.
  const twoScheduleFixture = () => ({
    sections: [
      {
        blocks: [
          para('Property Coverages', 'Heading 1'), // 0;0
          {
            // 0;1
            tableFormat: { allowAutoFit: true },
            rows: [
              {
                rowFormat: { isHeader: true },
                cells: [cell('Coverage', HEADER_FILL), cell('Limit', HEADER_FILL)]
              },
              line('Building', '1,000,000', BAND_FILL),
              line('Other Coverage', '50,000'),
              line('Contents', '250,000', BAND_FILL)
            ]
          },
          para('Liability Coverages', 'Heading 1'), // 0;2
          {
            // 0;3
            tableFormat: { allowAutoFit: true },
            rows: [
              {
                rowFormat: { isHeader: true },
                cells: [cell('Coverage', HEADER_FILL), cell('Limit', HEADER_FILL)]
              },
              line('General Liability', '2,000,000', BAND_FILL),
              line('Other Coverage', '25,000'),
              line('Umbrella', '5,000,000', BAND_FILL)
            ]
          },
          para('Next Steps', 'Heading 1') // 0;4
        ]
      }
    ],
    styles: headingStyles()
  });

  it('refuses TWO splits in one change set, and says what to send instead', () => {
    const editor = makeEditor(twoScheduleFixture());
    try {
      const before = editor.serialize();
      // A split inserts a table, so the second edit's anchor has already moved -
      // and in this document every table's header reads "Coverage | Limit", so
      // content cannot disambiguate it. Refused up front with the shape that
      // works, rather than failing deep inside anchor relocation.
      const result = apply(
        editor,
        [
          {
            op: 'split_table',
            anchor: '0;1;0;0;0',
            rows: [2],
            targetAnchor: '0;2',
            position: 'before'
          },
          {
            op: 'split_table',
            anchor: '0;3;0;0;0',
            rows: [2],
            targetAnchor: '0;4',
            position: 'before'
          }
        ],
        'split-batched'
      );
      expect(result.results.map((entry) => entry.error)).toEqual([
        'split_table_one_per_change_set',
        'split_table_one_per_change_set'
      ]);
      // Refused before any anchor is resolved, so it costs the document nothing.
      expect(editor.serialize()).toBe(before);
      expect(editor.revisions.length).toBe(0);
      const said = `${result.results[0].message} ${(
        result.results[0].details ?? []
      ).join(' ')}`;
      expect(said).toContain('one split_table per change set');
      expect(said).toContain('its own reviewable card');
    } finally {
      destroyEditor(editor);
    }
  });

  // "for ALL the Coverages and Limit tables" - the shape that serves it: one
  // call per table, each its own card, the model re-reading between calls.
  it('splits every table in the document, one change set each', () => {
    const editor = makeEditor(twoScheduleFixture());
    try {
      const first = apply(
        editor,
        [
          {
            op: 'split_table',
            anchor: '0;1;0;0;0',
            rows: [2],
            targetAnchor: '0;2',
            position: 'before'
          }
        ],
        'split-first'
      );
      expect(first.results[0]).toMatchObject({ ok: true });
      // A fresh read between calls is what a model actually does, and the second
      // table's anchor has moved by one block.
      const second = apply(
        editor,
        [
          {
            op: 'split_table',
            // Shifted by the first split's separator paragraph: this table was
            // 0;4 before a split began leaving a gap behind it.
            anchor: '0;5;0;0;0',
            rows: [2],
            targetAnchor: '0;6',
            position: 'before'
          }
        ],
        'split-second'
      );
      expect(second.results[0]).toMatchObject({ ok: true });
      editor.revisions.acceptAll();
      expect(tablesOf(editor)).toHaveLength(4);
      // Two change sets, so two cards - one per table, each independently
      // rejectable, which is what "one rail card per table" means.
      expect(
        tablesOf(editor).map((table) => table.rows.map((row) => row.text))
      ).toEqual([
        ['Coverage|Limit', 'Building|1,000,000', 'Contents|250,000'],
        ['Coverage|Limit', 'Other Coverage|50,000'],
        ['Coverage|Limit', 'General Liability|2,000,000', 'Umbrella|5,000,000'],
        ['Coverage|Limit', 'Other Coverage|25,000']
      ]);
    } finally {
      destroyEditor(editor);
    }
  });
});

// The captain, refining "no heading": "when we want to split we can ask the user
// if they want a title for the table and if they say no, then we dont add it but
// if they say yes then we may want to add the title. Maybe default could be no
// title too. And user can ask later to add a title for them."
//
// A TITLE IS CONTENT, so it must not reach `split_table` - the op's schema
// carrying no text field is exactly what makes it incapable of retyping or
// fabricating anything, and the registry test above pins that. The title is
// therefore a SEPARATE composed heading through the existing section-composer
// path, which means "yes, add a title" and "add a title later" are the SAME
// operation rather than two paths that could disagree about style.
describe('split_table: a title is separate content, not part of the split', () => {
  const splitOff = (editor: DocumentEditor, changeSetId: string) =>
    apply(
      editor,
      [
        {
          op: 'split_table',
          anchor: '0;2;0;0;0',
          rows: [1, 3, 5],
          targetAnchor: '0;3',
          position: 'before'
        }
      ],
      changeSetId
    );

  it('defaults to no title: the split alone adds no heading', () => {
    const editor = makeEditor(scheduleFixture());
    try {
      const headingsBefore = flattenSfdt(JSON.parse(editor.serialize()))
        .filter((block) => block.isHeading)
        .map((block) => block.text);
      splitOff(editor, 'title-default-none');
      editor.revisions.acceptAll();
      expect(
        flattenSfdt(JSON.parse(editor.serialize()))
          .filter((block) => block.isHeading)
          .map((block) => block.text)
      ).toEqual(headingsBefore);
    } finally {
      destroyEditor(editor);
    }
  });

  it('a title added AFTERWARDS lands above the new table with the family style', () => {
    const editor = makeEditor(scheduleFixture());
    try {
      splitOff(editor, 'title-later-split');
      editor.revisions.acceptAll();
      // The new table sits at 0;4 - the source table is 0;2, the empty separator
      // the split now leaves is 0;3, and "Next Steps" follows. It was 0;3 before
      // the separator existed.
      const [, newTable] = tablesOf(editor);
      expect(newTable.anchor).toBe('0;4');
      // The ordinary follow-up: compose a heading before it. No redo of the
      // split, and no title field on the split op.
      const titled = apply(
        editor,
        [
          {
            op: 'insert_section',
            anchor: newTable.anchor,
            position: 'before',
            sectionSpec: { title: 'Acme Placements', blocks: [] }
          } as EditOp
        ],
        'title-later-add'
      );
      expect(titled.results[0]).toMatchObject({ ok: true });
      editor.revisions.acceptAll();
      const blocks = flattenSfdt(JSON.parse(editor.serialize())).filter(
        (block) => block.kind !== 'table_cell'
      );
      const title = blocks.find((block) => block.text === 'Acme Placements');
      expect(title).toBeDefined();
      expect(title?.isHeading).toBe(true);
      // DERIVED, not asserted as a literal: the new title wears the same style
      // the document's own headings wear, because it went through the composed
      // heading path rather than being written raw by the split.
      const existing = blocks.find((block) => block.text === 'Coverage Schedule');
      expect(title?.format?.styleName).toBe(existing?.format?.styleName);
      expect(title?.level).toBe(existing?.level);
      // And the table it titles is still intact underneath it.
      const tables = tablesOf(editor);
      expect(tables).toHaveLength(2);
      expect(tables[1].rows.map((row) => row.text)).toEqual([
        'Line|Carrier',
        'General Liability|Acme',
        'Property|Acme',
        'Umbrella|Acme'
      ]);
    } finally {
      destroyEditor(editor);
    }
  });
});

// A model that reads a table gets its address from `TableFacts.tableAnchor`, which
// is the table's own BLOCK address ("5;61") - not one of its cell anchors. That
// address is nothing's block anchor, so without a retarget it failed deep in the
// executor's anchor relocation with `anchor_not_found` and a suggestion to
// "supply `expect` or `find`" - advice that cannot be followed for a table, since
// a table has no single text, and which named a cause that was not the problem.
//
// Live evidence, the model reaching for the op correctly and being refused on the
// anchor FORM alone:
//   {"op":"split_table","anchor":"5;61","rows":[4,5,9],"targetAnchor":"5;62",...}
//
// The fix is membership in the EXISTING owner of this rule, `TABLE_SCOPED_OPS`,
// not a new mechanism and not a schema change: a split acts on the whole table and
// takes its rows from `rows`, so any cell of that table identifies the same work.
describe('split_table: the anchor may name the TABLE, the way a table read names it', () => {
  const ROWS = [1, 3, 5];
  const edits = (anchor: string): EditOp[] => [
    {
      op: 'split_table',
      anchor,
      rows: ROWS,
      targetAnchor: '0;3',
      position: 'before'
    }
  ];

  it('accepts the table block anchor, and the cell anchor, identically', () => {
    const viaTable = makeEditor(scheduleFixture());
    const viaCell = makeEditor(scheduleFixture());
    try {
      // "0;2" is the TABLE's address - what a table_facts read reports.
      const byTable = apply(viaTable, edits('0;2'), 'anchor-table');
      // "0;2;0;0;0" is a cell inside it.
      const byCell = apply(viaCell, edits('0;2;0;0;0'), 'anchor-cell');
      expect(byTable.results[0]).toMatchObject({ ok: true, op: 'split_table' });
      expect(byCell.results[0]).toMatchObject({ ok: true, op: 'split_table' });
      viaTable.revisions.acceptAll();
      viaCell.revisions.acceptAll();
      // Not merely both accepted - the SAME split, or one of the two forms is a
      // second path nobody is proving.
      expect(rowsOf(viaTable, 0)).toEqual(rowsOf(viaCell, 0));
      expect(rowsOf(viaTable, 1)).toEqual(rowsOf(viaCell, 1));
      expect(tablesOf(viaTable)).toHaveLength(2);
    } finally {
      destroyEditor(viaTable);
      destroyEditor(viaCell);
    }
  });

  it('still refuses an anchor that names no table at all', () => {
    // The retarget must not turn a genuinely wrong anchor into a silent guess:
    // "0;0" is the heading paragraph, a real block that is not a table.
    const editor = makeEditor(scheduleFixture());
    try {
      const before = editor.serialize();
      const result = apply(editor, edits('0;0'), 'anchor-not-a-table');
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'split_table_requires_cell_anchor'
      });
      expect(editor.serialize()).toBe(before);
    } finally {
      destroyEditor(editor);
    }
  });

  // The set is the owner of "this op's anchor may name a table". Enumerating it
  // means a future table-level op joining the set has to actually work with a
  // table anchor, rather than being added on the assumption that it does.
  it('every op in TABLE_SCOPED_OPS accepts a table anchor', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { TABLE_SCOPED_OPS } = require('../syncfusionDocumentOps');
    expect(Array.from(TABLE_SCOPED_OPS)).toContain('split_table');
    for (const op of Array.from(TABLE_SCOPED_OPS) as string[]) {
      const editor = makeEditor(scheduleFixture());
      try {
        const result = apply(
          editor,
          [
            {
              op,
              anchor: '0;2',
              ...(op === 'split_table'
                ? { rows: ROWS, targetAnchor: '0;3', position: 'before' }
                : {}),
              ...(op === 'copy_table_format'
                ? { inheritFormatFrom: '0;2;0;0;0' }
                : {})
            } as EditOp
          ],
          `scoped-${op}`
        );
        // The anchor FORM must never be what fails. An op may still refuse for
        // its own reasons, but not with the executor's anchor-resolution error.
        expect(result.results[0]?.error).not.toBe('anchor_not_found');
        expect(result.results[0]?.error).not.toBe('anchor_relocation_ambiguous');
      } finally {
        destroyEditor(editor);
      }
    }
  });
});

// The other half of Anthony's 3733040652. A split is a tracked write like any
// other, so it has a rail card, and the card's Accept is a DIFFERENT code path
// from `revisions.acceptAll()` - it calls `resolveLiveRevisionGroupsAsOneUndo`
// over the group. Nothing in this file had ever pressed it: every case above
// resolves through `acceptAll` or `rejectAll`, so the button a user actually
// clicks was unverified on the accept side for both split shapes.
describe('split_table: the rail card resolves a split as one unit', () => {
  const SPLITS: Array<[string, EditOp]> = [
    [
      'the selective split',
      {
        op: 'split_table',
        anchor: '0;2;0;0;0',
        rows: [1, 3, 5],
        targetAnchor: '0;3',
        position: 'before'
      } as EditOp
    ],
    [
      'the positional split',
      {
        op: 'split_table',
        anchor: '0;2;0;0;0',
        splitAtRow: 3,
        targetAnchor: '0;3',
        position: 'before'
      } as EditOp
    ]
  ];

  it.each(SPLITS)('accepting %s through the card matches acceptAll', (
    _label,
    edit
  ) => {
    const viaAll = makeEditor(scheduleFixture());
    const viaRail = makeEditor(scheduleFixture());
    try {
      expect(apply(viaAll, [edit], 'split-accept-all').results[0]).toMatchObject(
        { ok: true }
      );
      expect(
        apply(viaRail, [edit], 'split-accept-rail').results[0]
      ).toMatchObject({ ok: true });
      // One split, one card - the property the card path depends on.
      const groups = listRevisionGroups(viaRail as any);
      expect(groups).toHaveLength(1);

      viaAll.revisions.acceptAll();
      resolveLiveRevisionGroupsAsOneUndo(viaRail as any, groups, true);
      expect(viaRail.revisions.length).toBe(0);
      // Two tables either way, reading the same rows in the same order, and
      // every row wearing the same appearance facts: a user cannot tell which
      // button they pressed.
      //
      // Compared on the document's facts rather than on its bytes on purpose.
      // The fixture is `allowAutoFit`, so serialized column widths are whatever
      // the last layout pass measured - and jsdom has no font metrics, so the
      // two routes settle on different `cw` values (17.55 vs 13.8) for
      // identical content. A byte comparison here would assert a layout
      // artefact, which is exactly the kind of assertion that passes while the
      // feature is broken for the next document.
      expect(tablesOf(viaAll)).toHaveLength(2);
      expect(allTexts(viaRail)).toEqual(allTexts(viaAll));
      expect(tablesOf(viaRail).map((table) => table.rows)).toEqual(
        tablesOf(viaAll).map((table) => table.rows)
      );
      expect(Array.from(factsByRowText(viaRail))).toEqual(
        Array.from(factsByRowText(viaAll))
      );
    } finally {
      destroyEditor(viaAll);
      destroyEditor(viaRail);
    }
  });

  // collectTableAppearance never reports the column grid, so a table left claiming
  // more columns than its rows have passes the comparison above and renders ragged
  it('accepting a split that takes the last row leaves each table its own column grid', () => {
    const editor = makeEditor(scheduleFixture());
    try {
      const edit = {
        op: 'split_table',
        anchor: '0;2;0;0;0',
        rows: [1, 3, 5],
        targetAnchor: '0;3',
        position: 'before'
      } as EditOp;
      expect(apply(editor, [edit], 'split-grid').results[0]).toMatchObject({
        ok: true
      });
      resolveLiveRevisionGroupsAsOneUndo(
        editor as any,
        listRevisionGroups(editor as any),
        true
      );
      const grids = gridsOf(editor);
      expect(grids).toHaveLength(2);
      for (const grid of grids) {
        expect(grid.cellsPerRow).toEqual([2]);
        expect(grid.columnCount).toBe(2);
        expect(grid.gridColumns).toBe(2);
      }
    } finally {
      destroyEditor(editor);
    }
  });

  it.each(SPLITS)('rejecting %s through the card restores it exactly', (
    _label,
    edit
  ) => {
    const editor = makeEditor(scheduleFixture());
    try {
      const before = editor.serialize();
      apply(editor, [edit], 'split-reject-rail');
      resolveLiveRevisionGroupsAsOneUndo(
        editor as any,
        listRevisionGroups(editor as any),
        false
      );
      expect(editor.revisions.length).toBe(0);
      expect(editor.serialize()).toBe(before);
    } finally {
      destroyEditor(editor);
    }
  });
});
