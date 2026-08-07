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
              cells: [cell('Line', HEADER_FILL), cell('Carrier', HEADER_FILL)]
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

/**
 * The shape the captain's own proposal is in: an empty paragraph sits after the
 * table, and it is formatted HIDDEN.
 *
 * Measured on his 22-page document, where `5;62` reads
 * `{cf:{hdn:true}, i:[{cf:{hdn:true}, tlp:""}]}` under the plain `Normal`
 * style - ten such paragraphs in the file, every one empty. A hidden paragraph
 * mark carries no line, so a table pasted past one is still flush against the
 * table above it. His words on the result: "it still feels like there is no
 * actual gap between both the tables and I actually want a line between both
 * the tables. Blank line."
 *
 * The hiding is DIRECT formatting on the mark and on the run, not a style, so
 * the fixture states it the same way the document does.
 */
const hiddenSpacerFixture = () => ({
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
            line('General Liability', 'Acme', BAND_FILL), // 1
            line('Auto', 'Beta'), // 2
            line('Property', 'Acme', BAND_FILL), // 3
            line('Workers Comp', 'Gamma'), // 4
            line('Umbrella', 'Acme', BAND_FILL) // 5
          ]
        },
        // 0;3 - the document's own hidden spacer, which renders no line
        { inlines: [], characterFormat: { hidden: true } },
        para('Next Steps', 'Heading 1'), // 0;4
        para('Confirm by Friday.') // 0;5
      ]
    }
  ],
  styles: headingStyles()
});

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
                {
                  cellFormat: { rowSpan: 2 },
                  blocks: [{ inlines: [{ text: 'Package' }] }]
                },
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

/**
 * The top-level block sequence: `TABLE(rows)` for a table, `P:text` otherwise.
 *
 * Read from the block array rather than from `flattenSfdt`, because a table has
 * no block of its own there - its cells do - so a flattened read cannot say
 * whether anything sits BETWEEN two tables, which is the whole question here.
 */
const topLevelKindsOf = (editor: DocumentEditor): string[] => {
  const sfdt = JSON.parse(editor.serialize());
  const blocks: any[] = sfdt.sections?.[0]?.blocks ?? sfdt.sec?.[0]?.b ?? [];
  return blocks.map((block) => {
    const rows = block.rows ?? block.r ?? block.rw;
    if (Array.isArray(rows)) return `TABLE(${rows.length})`;
    const inlines = block.inlines ?? block.i ?? [];
    return `P:${inlines.map((run: any) => run.text ?? run.tlp ?? '').join('')}`;
  });
};

/** Every index where a table sits directly against the table before it. */
const weldedTablePairs = (editor: DocumentEditor): number[] => {
  const kinds = topLevelKindsOf(editor);
  return kinds.reduce<number[]>(
    (found, kind, index) =>
      index > 0 &&
      kind.startsWith('TABLE') &&
      kinds[index - 1].startsWith('TABLE')
        ? [...found, index]
        : found,
    []
  );
};

/**
 * Whether each top-level paragraph's MARK is hidden - `null` for a table.
 *
 * A hidden mark is the difference between a blank line and nothing at all, and
 * it is invisible to `topLevelKindsOf`: both read `P:`. Asserting on the text
 * alone would pass on a separator the reviewer cannot see, which is exactly the
 * result being fixed.
 */
const hiddenMarksOf = (editor: DocumentEditor): Array<boolean | null> => {
  const sfdt = JSON.parse(editor.serialize());
  const blocks: any[] = sfdt.sections?.[0]?.blocks ?? sfdt.sec?.[0]?.b ?? [];
  return blocks.map((block) => {
    if (Array.isArray(block.rows ?? block.r ?? block.rw)) return null;
    const format = block.characterFormat ?? block.cf ?? {};
    return (format.hidden ?? format.hdn) === true;
  });
};

/**
 * Where SyncFusion actually puts the caret when the user clicks the position a
 * block address names. Two tables with nothing between them have no caret there
 * at all: the request lands inside the second table's first cell, which is the
 * "cannot add any break between them" the captain reported.
 */
const caretAt = (editor: DocumentEditor, anchor: string) => {
  editor.selection.select(anchor, anchor);
  return {
    offset: String(editor.selection.startOffset),
    insideTable: Boolean(
      (editor.selection.start as any)?.paragraph?.isInsideTable
    )
  };
};

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
        expect(table.layout?.tableAlignment).toBe(
          source.layout?.tableAlignment
        );
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

  it('a second split of a table the first split put a table below stays clean', () => {
    const editor = makeEditor(scheduleFixture());
    try {
      // Turn one puts the new table immediately after the source, which is what
      // `position: 'before'` the following heading means. The separator is what
      // keeps them two tables rather than neighbours with nothing between them.
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
      // Turn one's separator sits between them, so turn two addresses the
      // heading at 0;5 - the new table is at 0;4, and a target inside a table is
      // refused. This is the shape a second turn actually meets.
      expect(topLevelKindsOf(editor)).toEqual([
        'P:Coverage Schedule',
        'P:All lines are listed below.',
        'TABLE(3)',
        'P:',
        'TABLE(4)',
        'P:Next Steps',
        'P:Confirm by Friday.'
      ]);

      // Turn two splits the source again. Below it is the table turn one
      // produced, and it must survive with every row it had.
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
      expect(rowsOf(editor, 0)).toEqual(['Line|Carrier', 'Workers Comp|Gamma']);
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
  // copy used to make the tables adjacent whether or not it had been accepted, so
  // turn two captured the neighbour AND the paragraphs past it - and pasting that
  // payload FUSED paragraphs ("Confirm by Friday.Next Steps") on top of adding a
  // table nobody asked for. `detectBatchedSplits` cannot see this: it refuses two
  // splits in ONE change set, and these are two.
  //
  // Turn one now leaves its separator, so the pending sequence turn two reads is
  // TABLE / P / TABLE / "Next Steps" / "Confirm by Friday." - every anchor below
  // is one block later than it was, and none of them names a table.
  //
  // Every destination is covered because the paste point is what the fused text
  // lands on, and each one fused a different pair.
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
    const {
      DOCUMENT_EDITOR_CAPABILITIES
    } = require('../../../capabilities/registry');
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

  // "Here it should NOT create a new subsection heading, just a new table."
  //
  // Refined by the report that made the separator necessary: "both the tables are
  // still connected and so we cannot add any break between them so can we make
  // this more deterministic where when it splits the table it creates a new table
  // and not just start adding new rows into the existing table". So the split adds
  // exactly two things - the table, and the EMPTY paragraph that makes it a second
  // table the reviewer can get between - and still writes no text of any kind.
  it('adds a table and an empty separator - no heading, no text, nothing else', () => {
    const editor = makeEditor(scheduleFixture());
    try {
      const textsBefore = flattenSfdt(JSON.parse(editor.serialize()))
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
      // Exactly ONE block was added, it is a paragraph and not a heading, and it
      // is empty: every heading and every word of text is as it was.
      expect(bodyAfter.filter((entry) => entry !== 'P:')).toEqual(
        textsBefore.filter((entry) => entry !== 'P:')
      );
      expect(bodyAfter).toHaveLength(textsBefore.length + 1);
      expect(bodyAfter.filter((entry) => entry === 'P:')).toHaveLength(
        textsBefore.filter((entry) => entry === 'P:').length + 1
      );
      expect(tablesOf(editor)).toHaveLength(2);
      // And it is between the two tables, which is the only place it helps.
      expect(topLevelKindsOf(editor)).toEqual([
        'P:Coverage Schedule',
        'P:All lines are listed below.',
        'TABLE(3)',
        'P:',
        'TABLE(4)',
        'P:Next Steps',
        'P:Confirm by Friday.'
      ]);
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
                cells: [
                  cell('Coverage', HEADER_FILL),
                  cell('Limit', HEADER_FILL)
                ]
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
                cells: [
                  cell('Coverage', HEADER_FILL),
                  cell('Limit', HEADER_FILL)
                ]
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
      // table's anchor has moved by the two blocks the first split added - its
      // table and the separator that keeps that table separate.
      const second = apply(
        editor,
        [
          {
            op: 'split_table',
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
      // The new table sits at 0;4 - after the source table and the separator
      // paragraph that keeps the two apart, and before "Next Steps".
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
      const existing = blocks.find(
        (block) => block.text === 'Coverage Schedule'
      );
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
        expect(result.results[0]?.error).not.toBe(
          'anchor_relocation_ambiguous'
        );
      } finally {
        destroyEditor(editor);
      }
    }
  });
});

// A split produces two tables the reviewer can get BETWEEN.
//
// The captain: "whenever we ask it to split the tables it do split the tables but
// then both the tables are still connected and so we cannot add any break between
// them so can we make this more deterministic where when it splits the table it
// creates a new table and not just start adding new rows into the existing table".
//
// Measured on his own 22-page proposal before the fix: the split DID produce two
// table blocks (24 -> 25), but with zero blocks between them, and asking for the
// caret at the position between them - `5;62;0` - came back `5;62;0;0;0;0`, inside
// the new table's first cell. There is no caret between two adjacent tables, so
// there is nowhere to put a break, a heading or a paragraph, and the pair reads
// and behaves as one table. It survived accept and a full DOCX round trip.
//
// Which of the two happens was decided by the model's `targetAnchor`, not by us:
// the same request produced `"5;62"` (the block right after the source, welded) on
// one turn and `"5;63"` (past a paragraph that happened to be there, separated) on
// another. That is the nondeterminism the separator removes.
describe('split_table: the two halves are two tables, not one', () => {
  const ACME_ROWS = [1, 3, 5];
  const splitAfterSource = (editor: DocumentEditor, changeSetId: string) =>
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
      changeSetId
    );

  it('leaves a block the caret can reach between them, pending AND accepted', () => {
    const editor = makeEditor(scheduleFixture());
    try {
      expect(
        splitAfterSource(editor, 'separator-caret').results[0]
      ).toMatchObject({ ok: true });
      // Pending: the separator is already a real block, so the reviewer can click
      // between the two tables before deciding anything.
      expect(weldedTablePairs(editor)).toEqual([]);
      expect(caretAt(editor, '0;3;0')).toEqual({
        offset: '0;3;0',
        insideTable: false
      });
      // Accepted, which is where the recurring failure has been: pending-correct
      // and accept-wrong. The block is still there and still addressable.
      editor.revisions.acceptAll();
      expect(weldedTablePairs(editor)).toEqual([]);
      expect(caretAt(editor, '0;3;0')).toEqual({
        offset: '0;3;0',
        insideTable: false
      });
      expect(tablesOf(editor)).toHaveLength(2);
      // The separator is a body paragraph, not a heading, even though the block
      // the paste targeted IS one - it rides on the payload rather than being cut
      // out of the target paragraph, so it cannot inherit "Heading 1".
      const separator = flattenSfdt(JSON.parse(editor.serialize())).find(
        (candidate) => candidate.anchor === '0;3'
      );
      expect(separator?.text).toBe('');
      expect(separator?.isHeading).toBeFalsy();
    } finally {
      destroyEditor(editor);
    }
  });

  it('the separator belongs to the same card, and reject takes it away too', () => {
    const editor = makeEditor(scheduleFixture());
    try {
      const before = editor.serialize();
      const blocksBefore = topLevelKindsOf(editor);
      expect(
        splitAfterSource(editor, 'separator-reject').results[0]
      ).toMatchObject({ ok: true });
      // ONE card covering the table and its separator, so it is one accept and
      // one reject rather than two things to notice.
      expect(listRevisionGroups(editor as any)).toHaveLength(1);
      expect(topLevelKindsOf(editor)).toHaveLength(blocksBefore.length + 2);
      editor.revisions.rejectAll();
      // Byte-exact, on the same editor instance: the separator paragraph is a
      // tracked insertion in that group, so rejecting removes it with the table.
      expect(editor.serialize()).toEqual(before);
      expect(editor.serialize().length).toBe(before.length);
      expect(topLevelKindsOf(editor)).toEqual(blocksBefore);
      expect(editor.revisions.length).toBe(0);
    } finally {
      destroyEditor(editor);
    }
  });

  it('adds nothing when the new table does not land against a table', () => {
    const editor = makeEditor(scheduleFixture());
    try {
      // Target the intro paragraph, so the block above the paste point is a
      // paragraph. There is no adjacency to prevent and no blank line appears -
      // the separator is a consequence of the shape, not a fixed extra block.
      const result = apply(
        editor,
        [
          {
            op: 'split_table',
            anchor: '0;2;0;0;0',
            rows: ACME_ROWS,
            targetAnchor: '0;1',
            position: 'before'
          }
        ],
        'no-separator-needed'
      );
      expect(result.results[0]).toMatchObject({ ok: true });
      editor.revisions.acceptAll();
      expect(topLevelKindsOf(editor)).toEqual([
        'P:Coverage Schedule',
        'TABLE(4)',
        'P:All lines are listed below.',
        'TABLE(3)',
        'P:Next Steps',
        'P:Confirm by Friday.'
      ]);
      expect(weldedTablePairs(editor)).toEqual([]);
    } finally {
      destroyEditor(editor);
    }
  });

  it('separates from a table the DOCUMENT put there, not just from the source', () => {
    const editor = makeEditor(adjacentTablesFixture());
    try {
      // The paste point follows the neighbour table, so the table that would be
      // welded is one this op never touched. The rule is about the paste point,
      // which is why it holds for a target beside any table rather than only for
      // the table being split.
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
        'separate-from-neighbour'
      );
      expect(result.results[0]).toMatchObject({ ok: true });
      editor.revisions.acceptAll();
      // The authored adjacency at 0;2/0;3 is the document's own and is left
      // alone; the pair this op would have created is separated.
      expect(topLevelKindsOf(editor)).toEqual([
        'P:Coverage Schedule',
        'P:All lines are listed below.',
        'TABLE(2)',
        'TABLE(3)',
        'P:',
        'TABLE(3)',
        'P:Next Steps',
        'P:Confirm by Friday.'
      ]);
      expect(caretAt(editor, '0;4;0')).toEqual({
        offset: '0;4;0',
        insideTable: false
      });
    } finally {
      destroyEditor(editor);
    }
  });

  // A hidden paragraph between the tables is not a gap. This is the captain's
  // own document: he ran the split on the SERVED build with the separator fix in
  // it, the fix correctly added nothing because a paragraph was already there,
  // and the two tables still rendered flush - because that paragraph is hidden.
  //
  // Measured live on the 22-page proposal, on a freshly loaded page:
  //
  //   op        {"op":"split_table","anchor":"5;61","rows":[4,5,9],
  //              "targetAnchor":"5;63","position":"before"}
  //   result    5;61 TABLE(10) / 5;62 P "" / 5;63 TABLE(4) / 5;64 P "Deductibles"
  //   5;62      {cf:{hdn:true}, i:[{cf:{hdn:true}, tlp:""}]}, style "Normal",
  //             present at rev 0 before any operation - the document's own
  //
  // So the rule is about a VISIBLE block between the tables, and the hidden one
  // is the author's content: it is never unhidden, moved or removed.
  describe('a hidden paragraph is not a gap', () => {
    const HIDDEN_SPACER_ROWS = [1, 3, 5];
    const splitPastSpacer = (editor: DocumentEditor, changeSetId: string) =>
      apply(
        editor,
        [
          {
            op: 'split_table',
            anchor: '0;2;0;0;0',
            rows: HIDDEN_SPACER_ROWS,
            // The anchor the model actually sent: the heading AFTER the hidden
            // spacer, so the block above the paste point is the spacer itself.
            targetAnchor: '0;4',
            position: 'before'
          }
        ],
        changeSetId
      );

    it('adds a VISIBLE separator and leaves the hidden paragraph exactly as it is', () => {
      const editor = makeEditor(hiddenSpacerFixture());
      try {
        expect(hiddenMarksOf(editor)).toEqual([
          false,
          false,
          null,
          true,
          false,
          false
        ]);
        expect(
          splitPastSpacer(editor, 'hidden-spacer').results[0]
        ).toMatchObject({ ok: true });
        editor.revisions.acceptAll();
        expect(topLevelKindsOf(editor)).toEqual([
          'P:Coverage Schedule',
          'P:All lines are listed below.',
          'TABLE(3)',
          'P:', // the document's hidden spacer, untouched
          'P:', // the separator this op added
          'TABLE(4)',
          'P:Next Steps',
          'P:Confirm by Friday.'
        ]);
        // THE ASSERTION THAT MATTERS: the paragraph we added renders a line.
        // A new paragraph inherits its neighbour's mark formatting when the
        // editor makes one in place - `insertText('\n')` at the live document's
        // hidden paragraph comes back `{cf:{hdn:true}}` - so a separator that
        // did not state its own visibility would be a second invisible one, and
        // the split would look fixed while changing nothing the captain sees.
        expect(hiddenMarksOf(editor)).toEqual([
          false,
          false,
          null,
          true, // the author's hidden spacer, still hidden
          false, // ours, visible
          null,
          false,
          false
        ]);
        expect(weldedTablePairs(editor)).toEqual([]);
      } finally {
        destroyEditor(editor);
      }
    });

    it('adds nothing when the paragraph already between them is visible', () => {
      const editor = makeEditor(scheduleFixture());
      try {
        // Same shape, same anchors, but `0;3` is an ordinary heading rather than
        // a hidden spacer: there is a line there already and no second one is
        // authored. Exactly one visible block between the tables, never two.
        expect(
          apply(
            editor,
            [
              {
                op: 'split_table',
                anchor: '0;2;0;0;0',
                rows: HIDDEN_SPACER_ROWS,
                targetAnchor: '0;4',
                position: 'before'
              }
            ],
            'visible-block-already-there'
          ).results[0]
        ).toMatchObject({ ok: true });
        editor.revisions.acceptAll();
        expect(topLevelKindsOf(editor)).toEqual([
          'P:Coverage Schedule',
          'P:All lines are listed below.',
          'TABLE(3)',
          'P:Next Steps',
          'TABLE(4)',
          'P:Confirm by Friday.'
        ]);
      } finally {
        destroyEditor(editor);
      }
    });

    it('rejecting takes the separator away and restores the document exactly', () => {
      const editor = makeEditor(hiddenSpacerFixture());
      try {
        const before = editor.serialize();
        const blocksBefore = topLevelKindsOf(editor);
        const marksBefore = hiddenMarksOf(editor);
        expect(
          splitPastSpacer(editor, 'hidden-spacer-reject').results[0]
        ).toMatchObject({ ok: true });
        expect(topLevelKindsOf(editor).length).toBe(blocksBefore.length + 2);
        editor.revisions.rejectAll();
        // Byte-exact on the same editor instance, and the hidden spacer is still
        // the only hidden paragraph: the separator left with the table it came
        // in with, in the same card.
        expect(editor.serialize().length).toBe(before.length);
        expect(editor.serialize()).toBe(before);
        expect(topLevelKindsOf(editor)).toEqual(blocksBefore);
        expect(hiddenMarksOf(editor)).toEqual(marksBefore);
        expect(editor.revisions.length).toBe(0);
      } finally {
        destroyEditor(editor);
      }
    });
  });

  it('holds for the document-tail table, where the target precedes the source', () => {
    const editor = makeEditor(tailFixture());
    try {
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
        'tail-separator'
      );
      expect(result.results[0]).toMatchObject({ ok: true });
      editor.revisions.acceptAll();
      expect(weldedTablePairs(editor)).toEqual([]);
      expect(topLevelKindsOf(editor)).toEqual([
        'P:Coverage Schedule',
        'TABLE(2)',
        'P:All lines are listed below.',
        'TABLE(3)'
      ]);
    } finally {
      destroyEditor(editor);
    }
  });

  // The invariant lives in `relocateBlockRange`, the one primitive `split_table`,
  // `move_section` and `copy_section` all paste through, and it keys off the
  // PAYLOAD leading with a table rather than off which op asked. Today only a
  // split produces such a payload - `TABLE_SCOPED_OPS` holds `split_table` but
  // not the two relocations, so they are always anchored at a heading and their
  // payload leads with one. Placed at the primitive so a relocation joining that
  // set inherits the rule instead of needing it remembered; asserted here from the
  // other side, that a payload which is not a table is written exactly as before.
  it('a relocation whose payload is not a table is written exactly as before', () => {
    const editor = makeEditor(scheduleFixture());
    try {
      // "Next Steps" and its paragraph, moved above the intro. The trailing empty
      // paragraph is what a move has always left where the section was - the whole
      // of relocateSection.spec.ts pins that behaviour and it is untouched here.
      const result = apply(
        editor,
        [
          {
            op: 'move_section',
            anchor: '0;3',
            targetAnchor: '0;1',
            position: 'before'
          } as EditOp
        ],
        'move-not-a-table'
      );
      expect(result.results[0]).toMatchObject({ ok: true });
      editor.revisions.acceptAll();
      expect(topLevelKindsOf(editor)).toEqual([
        'P:Coverage Schedule',
        'P:Next Steps',
        'P:Confirm by Friday.',
        'P:All lines are listed below.',
        'TABLE(6)',
        'P:'
      ]);
    } finally {
      destroyEditor(editor);
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

  it.each(SPLITS)(
    'accepting %s through the card matches acceptAll',
    (_label, edit) => {
      const viaAll = makeEditor(scheduleFixture());
      const viaRail = makeEditor(scheduleFixture());
      try {
        expect(
          apply(viaAll, [edit], 'split-accept-all').results[0]
        ).toMatchObject({ ok: true });
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
    }
  );

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

  it.each(SPLITS)(
    'rejecting %s through the card restores it exactly',
    (_label, edit) => {
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
    }
  );
});
