// Table look-and-feel: read it, apply it, and keep the banding correct.
//
// The captain, on a new section added from an uploaded document:
//
//   "it doesn't add it in the table format, it just adds this in lines ... We
//    need the new sections to have tables like their sibling sections ... Also
//    if we are adding a new row in the middle, it rn do not add highlights."
//
// Two capability gaps, not a prompting problem: the inventory could not SEE a
// table's appearance (cellFormat was read for merge spans only, and through the
// wrong optimized key at that), and there was no op that could write one.
//
// Everything here drives a REAL DocumentEditor, because the whole question is
// what SyncFusion actually stores and returns - a formatting capability verified
// against a mock is worthless. The first describe block pins the SDK facts the
// implementation is built on, so those claims cannot rot silently.
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
  getDocumentInventory,
  rejectProjectionStream,
  DocumentStructure,
  LiveEditor,
  TableFacts
} from '../syncfusionDocumentOps';
import {
  collectTableAppearance,
  detectTableBanding,
  inferHeaderRows,
  rowShadings
} from '../tableAppearance';

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

const revisions = (ed: DocumentEditor): any[] => {
  const collection = (ed as any).revisions;
  const out: any[] = [];
  for (let index = 0; index < (collection?.length ?? 0); index++) {
    const revision = collection.changes?.[index] ?? collection[index];
    if (revision) out.push(revision);
  }
  return out;
};

// --- Fixtures ---------------------------------------------------------------

const HEADER_FILL = '#1F3864';
const BAND_FILL = '#D9E2F3';
const TINY_BAND_FILL = '#E6E6E6';

const cell = (text: string, background?: string) => ({
  cellFormat: {
    preferredWidth: 100,
    ...(background ? { shading: { backgroundColor: background } } : {})
  },
  blocks: [{ inlines: [{ text }] }]
});

const row = (texts: string[], background?: string, isHeader?: boolean) => ({
  rowFormat: isHeader ? { isHeader: true } : {},
  cells: texts.map((text) => cell(text, background))
});

const styledCell = (
  text: string,
  characterFormat: Record<string, unknown>,
  paragraphFormat: Record<string, unknown>,
  background?: string
) => ({
  cellFormat: {
    preferredWidth: 100,
    ...(background ? { shading: { backgroundColor: background } } : {}),
    borders: {
      top: { lineStyle: 'Single', lineWidth: 0.5, color: '#7F7F7F' },
      left: { lineStyle: 'Single', lineWidth: 0.5, color: '#7F7F7F' },
      right: { lineStyle: 'Single', lineWidth: 0.5, color: '#7F7F7F' },
      bottom: { lineStyle: 'Single', lineWidth: 0.5, color: '#7F7F7F' }
    }
  },
  blocks: [{ paragraphFormat, inlines: [{ text, characterFormat }] }]
});

const inheritedTableFixture = () => {
  const header = (text: string, column: number) =>
    styledCell(
      text,
      {
        fontFamily: column === 0 ? 'Arial' : 'Courier New',
        fontSize: 12,
        bold: true,
        fontColor: '#FFFFFF'
      },
      { textAlignment: 'Center', afterSpacing: 4 },
      HEADER_FILL
    );
  const body = (text: string, rowIndex: number, column: number) =>
    styledCell(
      text,
      {
        fontFamily: column === 0 ? 'Georgia' : 'Times New Roman',
        fontSize: rowIndex === 3 ? 13 : 9.5,
        italic: rowIndex === 3
      },
      {
        textAlignment: rowIndex === 3 ? 'Right' : 'Left',
        afterSpacing: rowIndex === 3 ? 7 : 2
      },
      rowIndex % 2 === 0 ? BAND_FILL : undefined
    );
  return {
    sections: [
      {
        blocks: [
          {
            tableFormat: { preferredWidth: 300 },
            rows: [
              {
                rowFormat: { isHeader: true },
                cells: [header('Code', 0), header('Description', 1)]
              },
              ...[1, 2, 3, 4].map((rowIndex) => ({
                rowFormat: {},
                cells: [
                  body(String(rowIndex), rowIndex, 0),
                  body(`Row ${rowIndex}`, rowIndex, 1)
                ]
              }))
            ]
          },
          { inlines: [{ text: 'Sibling table spacer' }] },
          { inlines: [{ text: 'Insert here' }] }
        ]
      }
    ]
  };
};

const singleDataRowTableFixture = () => ({
  sections: [
    {
      blocks: [
        {
          tableFormat: { preferredWidth: 300 },
          rows: [
            {
              // The V2 document's visual header is not marked with Word's
              // isHeader flag; its dark fill and white text are the evidence.
              rowFormat: {},
              cells: ['Field', 'Value'].map((text) =>
                styledCell(
                  text,
                  { fontFamily: 'Arial', fontSize: 10, fontColor: '#FFFFFF' },
                  { textAlignment: 'Left', afterSpacing: 0 },
                  HEADER_FILL
                )
              )
            },
            {
              rowFormat: {},
              cells: ['Named Insured', 'Robert M Jamerson'].map((text) =>
                styledCell(
                  text,
                  { fontFamily: 'Arial', fontSize: 10, fontColor: '#1F1F1F' },
                  { textAlignment: 'Left', afterSpacing: 0 }
                )
              )
            }
          ]
        },
        {
          tableFormat: { preferredWidth: 300 },
          rows: [
            row(['Vehicle', 'Value'], HEADER_FILL, true),
            row(['One', 'A']),
            row(['Two', 'B'], TINY_BAND_FILL),
            row(['Three', 'C']),
            row(['Four', 'D'], TINY_BAND_FILL)
          ]
        }
      ]
    }
  ]
});

const shortStripedTableFixture = () => {
  const doc: any = singleDataRowTableFixture();
  doc.sections[0].blocks[0].rows.push({
    rowFormat: {},
    cells: ['Named Insured', 'Kristi L Jamerson'].map((text) =>
      styledCell(
        text,
        { fontFamily: 'Arial', fontSize: 10, fontColor: '#1F1F1F' },
        { textAlignment: 'Left', afterSpacing: 0 },
        TINY_BAND_FILL
      )
    )
  });
  return doc;
};

const uniformTinyTableFixture = () => {
  const doc: any = singleDataRowTableFixture();
  doc.sections[0].blocks[0].rows.push({
    rowFormat: {},
    cells: ['Named Insured', 'Kristi L Jamerson'].map((text) =>
      styledCell(
        text,
        { fontFamily: 'Arial', fontSize: 10, fontColor: '#1F1F1F' },
        { textAlignment: 'Left', afterSpacing: 0 }
      )
    )
  });
  return doc;
};

const fromScratchDocumentBandingFixture = () => {
  const doc: any = singleDataRowTableFixture();
  const [tinyTable, longerTable] = doc.sections[0].blocks;
  longerTable.rows.push(
    row(['Five', 'E']),
    row(['Six', 'F'], TINY_BAND_FILL)
  );
  const shorterTable = {
    tableFormat: { preferredWidth: 300 },
    rows: [
      row(['Location', 'Value'], HEADER_FILL, true),
      row(['One', 'A']),
      row(['Two', 'B'], BAND_FILL),
      row(['Three', 'C']),
      row(['Four', 'D'], BAND_FILL)
    ]
  };
  doc.sections[0].blocks = [
    longerTable,
    shorterTable,
    tinyTable,
    { inlines: [{ text: 'Table spacer' }] },
    { inlines: [{ text: 'Insert discounts here' }] }
  ];
  return doc;
};

/**
 * The captain's document: a sibling section whose Location Schedule is banded
 * (dark header row, then alternating rows starting UNFILLED), and a new section
 * whose table is bare.
 *
 * 0;0 heading, 0;1 banded table, 0;2 plain table, 0;3 trailing paragraph.
 */
const twoTables = () => ({
  sections: [
    {
      blocks: [
        { inlines: [{ text: 'Location Schedule' }] },
        {
          tableFormat: { preferredWidth: 300 },
          rows: [
            row(['Loc #', 'Address'], HEADER_FILL, true),
            row(['1', 'A St']),
            row(['2', 'B St'], BAND_FILL),
            row(['3', 'C St']),
            row(['4', 'D St'], BAND_FILL)
          ]
        },
        {
          tableFormat: { preferredWidth: 300 },
          rows: [
            row(['Loc #', 'Address']),
            row(['5', 'E St']),
            row(['6', 'F St']),
            row(['7', 'G St']),
            row(['8', 'H St'])
          ]
        },
        { inlines: [{ text: 'End' }] }
      ]
    }
  ]
});

// --- Helpers over the public read -------------------------------------------

const facts = (ed: DocumentEditor, tableAnchor: string): TableFacts => {
  const read = getDocumentInventory(ed as unknown as LiveEditor, {
    scope: 'table_facts',
    tableAnchor
  });
  expect('table' in read).toBe(true);
  return (read as { table: TableFacts }).table;
};

/** Every row's shared fill, as the model sees it. `null` is "no fill". */
const fills = (ed: DocumentEditor, tableAnchor: string) =>
  facts(ed, tableAnchor).rows.map((entry) => entry.appearance?.shading ?? null);

const structure = (ed: DocumentEditor): DocumentStructure => {
  const read = getDocumentInventory(ed as unknown as LiveEditor, {
    scope: 'structure'
  });
  return (read as { structure: DocumentStructure }).structure;
};

const apply = (ed: DocumentEditor, edits: any[], changeSetId = 'tf') =>
  applyDocumentEdits(ed as unknown as LiveEditor, { edits, changeSetId });

const resolvedTextFormat = (
  ed: DocumentEditor,
  anchor: string,
  text: string
) => {
  ed.selection.select(`${anchor};0`, `${anchor};${text.length}`);
  const character = {
    fontFamily: ed.selection.characterFormat.fontFamily,
    fontSize: ed.selection.characterFormat.fontSize,
    bold: ed.selection.characterFormat.bold,
    italic: ed.selection.characterFormat.italic,
    fontColor: ed.selection.characterFormat.fontColor
  };
  ed.selection.select(`${anchor};0`, `${anchor};${text.length + 1}`);
  return {
    character,
    paragraph: {
      textAlignment: ed.selection.paragraphFormat.textAlignment,
      afterSpacing: ed.selection.paragraphFormat.afterSpacing
    }
  };
};

// ---------------------------------------------------------------------------

describe('what SyncFusion 34.1.31 does with table appearance', () => {
  // The load-bearing fact behind the whole design. If a future SDK gains a
  // Formatting revision type, THIS is the test that should start failing and
  // send someone back to reconsider `formatTracking`.
  it('creates NO revision for a cell fill, and none for a border', () => {
    const ed = makeEditor(twoTables());
    try {
      ed.enableTrackChanges = true;
      (ed as any).currentUser = 'Robin';
      ed.selection.select('0;2;1;0;0;0', '0;2;1;0;0;0');
      ed.selection.cellFormat.background = '#FFFF00';
      expect(revisions(ed)).toHaveLength(0);
      ed.selection.select('0;2;1;0;0;0', '0;2;1;0;0;0');
      ed.selection.selectCell();
      ed.editor.applyBorders({
        type: 'AllBorders',
        borderColor: '#FF0000',
        lineWidth: 1,
        borderStyle: 'Single'
      });
      expect(revisions(ed)).toHaveLength(0);
      // ...while a row insert on the same table IS a rejectable card.
      ed.selection.select('0;2;1;0;0;0', '0;2;1;0;0;0');
      ed.editor.insertRow(false, 1);
      expect(revisions(ed).map((r) => r.revisionType)).toEqual(['Insertion']);
    } finally {
      destroyEditor(ed);
    }
  });

  it('spells "no fill" as the literal string "empty", both ways', () => {
    const ed = makeEditor(twoTables());
    try {
      ed.selection.select('0;1;1;0;0;0', '0;1;1;0;0;0');
      expect(ed.selection.cellFormat.background).toBe('empty');
      ed.selection.select('0;1;2;0;0;0', '0;1;2;0;0;0');
      expect(ed.selection.cellFormat.background).toBe(BAND_FILL);
      // Clearing writes the same sentinel back, and the read must call it "no
      // fill" either way - otherwise a copy of an unfilled cell is not idempotent.
      ed.selection.cellFormat.background = 'empty';
      expect(fills(ed, '0;1')[2]).toBeNull();
    } finally {
      destroyEditor(ed);
    }
  });

  it('clones the reference row fill into an inserted row, breaking the stripe', () => {
    // The captain's bug, with the bare SDK and no repo code in the path: the new
    // row repeats its neighbour AND everything below it flips parity.
    const ed = makeEditor(twoTables());
    try {
      ed.enableTrackChanges = true;
      ed.selection.select('0;1;2;0;0;0', '0;1;2;0;0;0');
      ed.editor.insertRow(false, 1);
      expect(fills(ed, '0;1')).toEqual([
        HEADER_FILL,
        null,
        BAND_FILL,
        BAND_FILL, // the new row, repeating its neighbour
        null,
        BAND_FILL
      ]);
    } finally {
      destroyEditor(ed);
    }
  });
});

describe('the read reports how a table is built', () => {
  it("reports a banded table's pattern, describing each row once", () => {
    const ed = makeEditor(twoTables());
    try {
      const table = facts(ed, '0;1');
      // The pattern IS the list of row fills.
      expect(table.rows.map((entry) => entry.appearance?.shading ?? null)).toEqual(
        [HEADER_FILL, null, BAND_FILL, null, BAND_FILL]
      );
      expect(table.rows[0].isHeader).toBe(true);
      expect(table.rows[1].isHeader).toBeUndefined();
      // A row whose cells agree is described ONCE - no per-cell repetition.
      for (const entry of table.rows)
        expect(entry.cells.map((c) => c.appearance)).toEqual(
          entry.cells.map(() => undefined)
        );
      // Nothing invented for the plain table.
      const plain = facts(ed, '0;2');
      expect(plain.rows.map((entry) => entry.appearance)).toEqual(
        plain.rows.map(() => undefined)
      );
      expect(plain.styleName).toBeUndefined();
    } finally {
      destroyEditor(ed);
    }
  });

  it('reports per-cell appearance only where a cell differs from its row', () => {
    const ed = makeEditor(twoTables());
    try {
      ed.selection.select('0;1;1;1;0;0', '0;1;1;1;0;0');
      ed.selection.cellFormat.background = '#FFF2CC';
      ed.selection.cellFormat.verticalAlignment = 'Center';
      const table = facts(ed, '0;1');
      expect(table.rows[1].appearance).toBeUndefined();
      expect(table.rows[1].cells[0].appearance).toBeUndefined();
      expect(table.rows[1].cells[1].appearance).toEqual({
        shading: '#FFF2CC',
        verticalAlignment: 'Center'
      });
    } finally {
      destroyEditor(ed);
    }
  });

  it('reports borders and the table style, and upper-cases a colour', () => {
    const doc: any = twoTables();
    doc.sections[0].blocks[1].tableFormat.styleName = 'TableGrid';
    const ed = makeEditor(doc);
    try {
      ed.selection.select('0;1;1;0;0;0', '0;1;1;0;0;0');
      ed.selection.cellFormat.background = '#aabbcc';
      ed.selection.select('0;1;1;0;0;0', '0;1;1;0;0;0');
      ed.selection.selectCell();
      ed.editor.applyBorders({
        type: 'AllBorders',
        borderColor: '#7f7f7f',
        lineWidth: 0.5,
        borderStyle: 'Single'
      });
      const table = facts(ed, '0;1');
      expect(table.styleName).toBe('TableGrid');
      expect(table.rows[1].cells[0].appearance).toEqual({
        shading: '#AABBCC',
        borders: { all: { style: 'Single', width: 0.5, color: '#7F7F7F' } }
      });
    } finally {
      destroyEditor(ed);
    }
  });

  it('flags a styled table in the cheap structure read, and leaves a plain one alone', () => {
    const ed = makeEditor(twoTables());
    try {
      const tables = structure(ed).tables;
      expect(tables.map((t) => [t.anchor, t.styled ?? false])).toEqual([
        ['0;1', true],
        ['0;2', false]
      ]);
    } finally {
      destroyEditor(ed);
    }
  });

  // Regression: cellFormat was read through `cf`, which is a PARAGRAPH's
  // characterFormat. The live editor always serializes optimized SFDT, so merge
  // spans were invisible in production while the long-key fixtures stayed green.
  it('sees merge spans in the optimized SFDT the live editor emits', () => {
    const doc: any = twoTables();
    doc.sections[0].blocks[1].rows[1].cells[0].cellFormat.columnSpan = 2;
    doc.sections[0].blocks[1].rows[1].cells.pop();
    const ed = makeEditor(doc);
    try {
      const table = facts(ed, '0;1');
      expect(table.mergedCells).toEqual([
        { row: 1, column: 0, anchor: '0;1;1;0;0', columnSpan: 2, rowSpan: 1 }
      ]);
      expect(table.rows[1].hasMergedCells).toBe(true);
    } finally {
      destroyEditor(ed);
    }
  });
});

describe('banding detection', () => {
  const bandingOf = (rowFills: Array<string | null>, headerFlag = false) => {
    const doc: any = {
      sections: [
        {
          blocks: [
            {
              tableFormat: {},
              rows: rowFills.map((fill, index) =>
                row(['a', 'b'], fill ?? undefined, headerFlag && index === 0)
              )
            }
          ]
        }
      ]
    };
    const appearance = collectTableAppearance(doc.sections[0].blocks[0])!;
    return {
      banding: detectTableBanding(appearance),
      headerRows: inferHeaderRows(appearance),
      shadings: rowShadings(appearance)
    };
  };

  it('infers a banner first row from its unrepeated fill, without an isHeader flag', () => {
    const { headerRows, banding } = bandingOf([
      HEADER_FILL,
      null,
      BAND_FILL,
      null,
      BAND_FILL
    ]);
    expect(headerRows).toBe(1);
    expect(banding).toEqual({
      headerRows: 1,
      period: 2,
      cycle: [null, BAND_FILL]
    });
  });

  it('does not invent a header when the stripe starts at row 0', () => {
    const { headerRows, banding } = bandingOf([
      BAND_FILL,
      null,
      BAND_FILL,
      null,
      BAND_FILL
    ]);
    expect(headerRows).toBe(0);
    expect(banding).toEqual({
      headerRows: 0,
      period: 2,
      cycle: [BAND_FILL, null]
    });
  });

  it('reads a doubled band as a damaged 2-cycle, not a perfect 3-cycle', () => {
    // [none, blue, blue, none, blue] fits a 3-cycle FLAWLESSLY and a 2-cycle only
    // 0.4 of the way. Going by fit would preserve the duplicated row; a
    // two-colour body seeded from an alternating top is a two-band stripe.
    const { banding } = bandingOf([
      HEADER_FILL,
      null,
      BAND_FILL,
      BAND_FILL,
      null,
      BAND_FILL
    ]);
    expect(banding).toEqual({
      headerRows: 1,
      period: 2,
      cycle: [null, BAND_FILL]
    });
  });

  it('detects a genuine three-colour cycle', () => {
    const { banding } = bandingOf([
      '#111111',
      '#222222',
      '#333333',
      '#111111',
      '#222222',
      '#333333'
    ]);
    expect(banding?.period).toBe(3);
  });

  it('finds no banding in an unstyled or uniformly filled table', () => {
    expect(bandingOf([null, null, null, null]).banding).toBeNull();
    expect(
      bandingOf([BAND_FILL, BAND_FILL, BAND_FILL, BAND_FILL]).banding
    ).toBeNull();
  });

  it('reports a row whose own cells disagree as having no single fill', () => {
    const doc: any = {
      sections: [
        {
          blocks: [
            {
              tableFormat: {},
              rows: [
                {
                  rowFormat: {},
                  cells: [cell('a', BAND_FILL), cell('b')]
                },
                row(['c', 'd'])
              ]
            }
          ]
        }
      ]
    };
    expect(
      rowShadings(collectTableAppearance(doc.sections[0].blocks[0])!)
    ).toEqual([undefined, null]);
  });
});

describe('copy_table_format', () => {
  it("reproduces a sibling table's appearance", () => {
    const ed = makeEditor(twoTables());
    try {
      const result = apply(ed, [
        { op: 'copy_table_format', anchor: '0;2;0;0;0', sourceTable: '0;1' }
      ]);
      expect(result.results[0].ok).toBe(true);
      expect(fills(ed, '0;2')).toEqual(fills(ed, '0;1'));
      expect(facts(ed, '0;2').rows[0].isHeader).toBe(true);
      // Content untouched: the copy is appearance only.
      expect(
        facts(ed, '0;2').rows.map((entry) =>
          entry.cells.map((c) => c.text).join('|')
        )
      ).toEqual([
        'Loc #|Address',
        '5|E St',
        '6|F St',
        '7|G St',
        '8|H St'
      ]);
    } finally {
      destroyEditor(ed);
    }
  });

  it('is idempotent: a second copy writes nothing at all', () => {
    const ed = makeEditor(twoTables());
    try {
      apply(ed, [
        { op: 'copy_table_format', anchor: '0;2;0;0;0', sourceTable: '0;1' }
      ]);
      const after = ed.serialize();
      const again = apply(ed, [
        { op: 'copy_table_format', anchor: '0;2;0;0;0', sourceTable: '0;1' }
      ]);
      expect(again.results[0].appearance).toMatchObject({ cellsWritten: 0 });
      expect(ed.serialize()).toBe(after);
    } finally {
      destroyEditor(ed);
    }
  });

  it('continues the stripe past the source when the target is longer', () => {
    const doc: any = twoTables();
    // Target grows to 8 rows against a 5-row source.
    for (let index = 9; index <= 11; index++)
      doc.sections[0].blocks[2].rows.push(row([String(index), 'X St']));
    const ed = makeEditor(doc);
    try {
      apply(ed, [
        { op: 'copy_table_format', anchor: '0;2;0;0;0', sourceTable: '0;1' }
      ]);
      expect(fills(ed, '0;2')).toEqual([
        HEADER_FILL,
        null,
        BAND_FILL,
        null,
        BAND_FILL,
        null,
        BAND_FILL,
        null
      ]);
    } finally {
      destroyEditor(ed);
    }
  });

  it('clamps to the source when the target is shorter or wider', () => {
    const doc: any = twoTables();
    doc.sections[0].blocks[2].rows = doc.sections[0].blocks[2].rows.slice(0, 3);
    for (const rowEntry of doc.sections[0].blocks[2].rows)
      rowEntry.cells.push(cell('extra'));
    const ed = makeEditor(doc);
    try {
      apply(ed, [
        { op: 'copy_table_format', anchor: '0;2;0;0;0', sourceTable: '0;1' }
      ]);
      // Three rows, and the third column inherits the source row's last cell.
      expect(fills(ed, '0;2')).toEqual([HEADER_FILL, null, BAND_FILL]);
      expect(facts(ed, '0;2').rows[2].cellCount).toBe(3);
    } finally {
      destroyEditor(ed);
    }
  });

  it('reports a source table style it cannot assign, rather than implying it did', () => {
    const doc: any = twoTables();
    doc.sections[0].blocks[1].tableFormat.styleName = 'TableGrid';
    const ed = makeEditor(doc);
    try {
      const result = apply(ed, [
        { op: 'copy_table_format', anchor: '0;2;0;0;0', sourceTable: '0;1' }
      ]);
      expect(result.results[0].appearance?.sourceStyleName).toBe('TableGrid');
      expect(facts(ed, '0;2').styleName).toBeUndefined();
    } finally {
      destroyEditor(ed);
    }
  });

  it('refuses a missing or self-referencing source without touching anything', () => {
    const ed = makeEditor(twoTables());
    try {
      const before = ed.serialize();
      expect(
        apply(ed, [
          { op: 'copy_table_format', anchor: '0;2;0;0;0', sourceTable: '0;9' }
        ]).results[0]
      ).toMatchObject({ ok: false, error: 'source_table_not_found' });
      expect(
        apply(ed, [
          { op: 'copy_table_format', anchor: '0;2;0;0;0', sourceTable: '0;2' }
        ]).results[0]
      ).toMatchObject({ ok: false, error: 'copy_source_is_target' });
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyEditor(ed);
    }
  });

  it('accepts the table anchor a structure read hands the model', () => {
    const ed = makeEditor(twoTables());
    try {
      // `0;2` is no block's anchor; the preflight retargets it to the table.
      const result = apply(ed, [
        { op: 'copy_table_format', anchor: '0;2', sourceTable: '0;1' }
      ]);
      expect(result.results[0].ok).toBe(true);
      expect(fills(ed, '0;2')).toEqual(fills(ed, '0;1'));
    } finally {
      destroyEditor(ed);
    }
  });
});

describe('restripe_table', () => {
  it('repairs a stripe someone broke', () => {
    const ed = makeEditor(twoTables());
    try {
      ed.selection.select('0;1;3;0;0;0', '0;1;3;0;0;0');
      ed.selection.selectRow();
      ed.selection.cellFormat.background = BAND_FILL;
      expect(fills(ed, '0;1')).toEqual([
        HEADER_FILL,
        null,
        BAND_FILL,
        BAND_FILL,
        BAND_FILL
      ]);
      const result = apply(ed, [
        { op: 'restripe_table', anchor: '0;1;0;0;0' }
      ]);
      expect(result.results[0].ok).toBe(true);
      expect(fills(ed, '0;1')).toEqual([
        HEADER_FILL,
        null,
        BAND_FILL,
        null,
        BAND_FILL
      ]);
    } finally {
      destroyEditor(ed);
    }
  });

  it('leaves an unstyled table exactly as it was, byte for byte', () => {
    const ed = makeEditor(twoTables());
    try {
      const before = ed.serialize();
      const result = apply(ed, [
        { op: 'restripe_table', anchor: '0;2;0;0;0' }
      ]);
      expect(result.results[0]).toMatchObject({ ok: true });
      expect(result.results[0].appearance).toMatchObject({
        noBandingDetected: true,
        cellsWritten: 0
      });
      expect(result.changeSet?.formatTracking).toBeUndefined();
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyEditor(ed);
    }
  });

  it('restripes only from `fromRow` down', () => {
    // A longer table, so damage below the seed rows is still detectable.
    const doc: any = twoTables();
    doc.sections[0].blocks[1].rows = [
      row(['Loc #', 'Address'], HEADER_FILL, true),
      row(['1', 'A St']),
      row(['2', 'B St'], BAND_FILL),
      row(['3', 'C St']),
      row(['4', 'D St'], BAND_FILL),
      row(['5', 'E St']),
      row(['6', 'F St'], BAND_FILL)
    ];
    const ed = makeEditor(doc);
    try {
      // Break rows 3 and 5 - both should be unfilled, both get the band fill.
      for (const rowIndex of [3, 5]) {
        ed.selection.select(`0;1;${rowIndex};0;0;0`, `0;1;${rowIndex};0;0;0`);
        ed.selection.selectRow();
        ed.selection.cellFormat.background = BAND_FILL;
      }
      apply(ed, [{ op: 'restripe_table', anchor: '0;1;0;0;0', fromRow: 5 }]);
      expect(fills(ed, '0;1')).toEqual([
        HEADER_FILL,
        null,
        BAND_FILL,
        BAND_FILL, // still broken: above fromRow, so untouched
        BAND_FILL,
        null, // repaired
        BAND_FILL
      ]);
    } finally {
      destroyEditor(ed);
    }
  });

  it('leaves a row whose own cells carry different fills alone, and says so', () => {
    const ed = makeEditor(twoTables());
    try {
      ed.selection.select('0;1;3;1;0;0', '0;1;3;1;0;0');
      ed.selection.cellFormat.background = '#FFF2CC';
      const result = apply(ed, [
        { op: 'restripe_table', anchor: '0;1;0;0;0' }
      ]);
      expect(result.results[0].appearance).toMatchObject({
        rowsSkippedMixed: 1,
        cellsWritten: 0
      });
      expect(facts(ed, '0;1').rows[3].cells[1].appearance?.shading).toBe(
        '#FFF2CC'
      );
    } finally {
      destroyEditor(ed);
    }
  });
});

describe('structural inserts inherit resolved table formatting by default', () => {
  it('inherits dark text from the only data row, never the unflagged visual header', () => {
    const ed = makeEditor(singleDataRowTableFixture());
    try {
      const result = apply(ed, [
        { op: 'insert_row', anchor: '0;0;1;1;0' },
        { op: 'set_cell_text', anchor: '0;0;2;0;0', text: 'Named Insured' },
        { op: 'set_cell_text', anchor: '0;0;2;1;0', text: 'Kristi L Jamerson' }
      ]);

      expect(result.results.filter((entry) => !entry.ok)).toEqual([]);
      expect(
        resolvedTextFormat(ed, '0;0;2;0;0', 'Named Insured').character.fontColor
      ).toBe('#1F1F1F');
      expect(
        resolvedTextFormat(ed, '0;0;2;1;0', 'Kristi L Jamerson').character
          .fontColor
      ).toBe('#1F1F1F');
      expect(
        resolvedTextFormat(ed, '0;0;0;0;0', 'Field').character.fontColor
      ).toBe('#FFFFFF');
      expect(facts(ed, '0;0').rows[0].appearance?.shading).toBe(HEADER_FILL);
    } finally {
      destroyEditor(ed);
    }
  });

  it('continues document-level striping when the target has one white data row', () => {
    const ed = makeEditor(singleDataRowTableFixture());
    try {
      const result = apply(ed, [
        { op: 'insert_row', anchor: '0;0;1;1;0' }
      ]);

      expect(result.results.filter((entry) => !entry.ok)).toEqual([]);
      expect(fills(ed, '0;0')).toEqual([
        HEADER_FILL,
        null,
        TINY_BAND_FILL
      ]);
      expect(facts(ed, '0;0').rows[0].appearance?.shading).toBe(HEADER_FILL);
    } finally {
      destroyEditor(ed);
    }
  });

  it('continues an alternating tiny-table stripe from its two data rows', () => {
    const ed = makeEditor(shortStripedTableFixture());
    try {
      const result = apply(ed, [
        { op: 'insert_row', anchor: '0;0;2;1;0' },
        { op: 'set_cell_text', anchor: '0;0;3;0;0', text: 'Named Insured' },
        { op: 'set_cell_text', anchor: '0;0;3;1;0', text: 'Jane Doe' }
      ]);

      expect(result.results.filter((entry) => !entry.ok)).toEqual([]);
      expect(fills(ed, '0;0')).toEqual([
        HEADER_FILL,
        null,
        TINY_BAND_FILL,
        null
      ]);
      expect(facts(ed, '0;0').rows[0].appearance?.shading).toBe(HEADER_FILL);
    } finally {
      destroyEditor(ed);
    }
  });

  it('continues a uniform tiny-table fill instead of importing document striping', () => {
    const ed = makeEditor(uniformTinyTableFixture());
    try {
      const result = apply(ed, [
        { op: 'insert_row', anchor: '0;0;2;1;0' }
      ]);

      expect(result.results.filter((entry) => !entry.ok)).toEqual([]);
      expect(fills(ed, '0;0')).toEqual([HEADER_FILL, null, null, null]);
      expect(facts(ed, '0;0').rows[0].appearance?.shading).toBe(HEADER_FILL);
    } finally {
      destroyEditor(ed);
    }
  });

  it('gives a new table its nearest sibling appearance and per-column header/body text formats', () => {
    const ed = makeEditor(inheritedTableFixture());
    try {
      const before = ed.serialize();
      const result = apply(
        ed,
        [
          { op: 'insert_table', anchor: '0;2', rows: 3, columns: 2 },
          { op: 'set_cell_text', anchor: '0;2;0;0;0', text: 'New code' },
          { op: 'set_cell_text', anchor: '0;2;0;1;0', text: 'New description' },
          { op: 'set_cell_text', anchor: '0;2;1;0;0', text: 'A5' },
          { op: 'set_cell_text', anchor: '0;2;1;1;0', text: 'Fifth row' },
          { op: 'set_cell_text', anchor: '0;2;2;0;0', text: 'A6' },
          { op: 'set_cell_text', anchor: '0;2;2;1;0', text: 'Sixth row' },
          // Explicit phase-3 formatting is the override act.
          {
            op: 'set_char_format',
            anchor: '0;2;2;1;0',
            fontName: 'Calibri',
            fontSize: 16
          },
          { op: 'set_cell_format', anchor: '0;2;1;1;0', shading: '#FFF2CC' }
        ],
        'inherit-new-table'
      );

      expect(result.results.every((entry) => entry.ok)).toBe(true);
      expect(fills(ed, '0;2')).toEqual([HEADER_FILL, null, BAND_FILL]);
      expect(facts(ed, '0;2').rows[0].isHeader).toBe(true);
      expect(facts(ed, '0;2').rows[0].appearance?.borders).toEqual({
        all: { style: 'Single', width: 0.5, color: '#7F7F7F' }
      });
      expect(resolvedTextFormat(ed, '0;2;0;0;0', 'New code')).toMatchObject({
        character: { fontFamily: 'Arial', fontSize: 12, bold: true },
        paragraph: { textAlignment: 'Center', afterSpacing: 4 }
      });
      expect(
        resolvedTextFormat(ed, '0;2;0;1;0', 'New description')
      ).toMatchObject({
        character: { fontFamily: 'Courier New', fontSize: 12, bold: true }
      });
      expect(resolvedTextFormat(ed, '0;2;1;0;0', 'A5')).toMatchObject({
        character: { fontFamily: 'Georgia', fontSize: 9.5 },
        paragraph: { textAlignment: 'Left', afterSpacing: 2 }
      });
      expect(resolvedTextFormat(ed, '0;2;2;1;0', 'Sixth row')).toMatchObject({
        character: { fontFamily: 'Calibri', fontSize: 16 }
      });
      expect(facts(ed, '0;2').rows[1].cells[1].appearance?.shading).toBe(
        '#FFF2CC'
      );
      expect(result.changeSet?.formatTracking).toBe(
        'grouped_with_revision_cards'
      );

      revisions(ed)[0].reject();
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyEditor(ed);
    }
  });

  it('keeps a from-scratch table header out of the data stripe cycle', () => {
    const ed = makeEditor(inheritedTableFixture());
    try {
      const result = apply(ed, [
        { op: 'insert_table', anchor: '0;2', rows: 5, columns: 2 },
        ...Array.from({ length: 5 }, (_, rowIndex) =>
          Array.from({ length: 2 }, (_, columnIndex) => ({
            op: 'set_cell_text',
            anchor: `0;2;${rowIndex};${columnIndex};0`,
            text: `${rowIndex}:${columnIndex}`
          }))
        ).flat()
      ]);

      expect(result.results.filter((entry) => !entry.ok)).toEqual([]);
      expect(fills(ed, '0;2')).toEqual([
        HEADER_FILL,
        null,
        BAND_FILL,
        null,
        BAND_FILL
      ]);
    } finally {
      destroyEditor(ed);
    }
  });

  it('derives a new table data cycle from longer sampled tables, excluding their headers', () => {
    const ed = makeEditor(fromScratchDocumentBandingFixture());
    try {
      const result = apply(ed, [
        { op: 'insert_table', anchor: '0;4', rows: 4, columns: 2 },
        ...Array.from({ length: 4 }, (_, rowIndex) =>
          Array.from({ length: 2 }, (_, columnIndex) => ({
            op: 'set_cell_text',
            anchor: `0;4;${rowIndex};${columnIndex};0`,
            text: `${rowIndex}:${columnIndex}`
          }))
        ).flat()
      ]);

      expect(result.results.filter((entry) => !entry.ok)).toEqual([]);
      expect(fills(ed, '0;4')).toEqual([
        HEADER_FILL,
        null,
        TINY_BAND_FILL,
        null
      ]);
      expect(
        resolvedTextFormat(ed, '0;4;2;0;0', '2:0').character.fontColor
      ).toBe('#1F1F1F');
    } finally {
      destroyEditor(ed);
    }
  });

  it('formats an inserted row from the row it displaces, not the anchor row SyncFusion clones', () => {
    const ed = makeEditor(inheritedTableFixture());
    try {
      const result = apply(ed, [
        { op: 'insert_row', anchor: '0;0;2;0;0' },
        { op: 'set_cell_text', anchor: '0;0;3;0;0', text: 'A3a' },
        { op: 'set_cell_text', anchor: '0;0;3;1;0', text: 'Inserted' }
      ]);

      expect(result.results.filter((entry) => !entry.ok)).toEqual([]);
      expect(fills(ed, '0;0')).toEqual([
        HEADER_FILL,
        null,
        BAND_FILL,
        null,
        BAND_FILL,
        null
      ]);
      expect(resolvedTextFormat(ed, '0;0;3;0;0', 'A3a')).toMatchObject({
        character: { fontFamily: 'Georgia', fontSize: 13, italic: true },
        paragraph: { textAlignment: 'Right', afterSpacing: 7 }
      });
      expect(resolvedTextFormat(ed, '0;0;3;1;0', 'Inserted')).toMatchObject({
        character: { fontFamily: 'Times New Roman', fontSize: 13, italic: true }
      });
    } finally {
      destroyEditor(ed);
    }
  });

  it('captures a following sibling before the table insert shifts its anchor', () => {
    const doc: any = inheritedTableFixture();
    doc.sections[0].blocks = [
      doc.sections[0].blocks[2],
      doc.sections[0].blocks[1],
      doc.sections[0].blocks[0]
    ];
    const ed = makeEditor(doc);
    try {
      const result = apply(ed, [
        { op: 'insert_table', anchor: '0;0', rows: 2, columns: 2 },
        { op: 'set_cell_text', anchor: '0;0;0;0;0', text: 'New code' },
        { op: 'set_cell_text', anchor: '0;0;0;1;0', text: 'New description' },
        { op: 'set_cell_text', anchor: '0;0;1;0;0', text: 'A5' },
        { op: 'set_cell_text', anchor: '0;0;1;1;0', text: 'Fifth row' }
      ]);

      expect(result.results.filter((entry) => !entry.ok)).toEqual([]);
      expect(fills(ed, '0;0')).toEqual([HEADER_FILL, null]);
      expect(
        resolvedTextFormat(ed, '0;0;0;1;0', 'New description')
      ).toMatchObject({
        character: { fontFamily: 'Courier New', fontSize: 12, bold: true }
      });
      // The source moved from 0;2 to 0;3 when the new grid landed; inheritance
      // still came from its pre-mutation snapshot.
      expect(facts(ed, '0;3').rows[0].cells[0].text).toBe('Code');
    } finally {
      destroyEditor(ed);
    }
  });

  it('formats an empty inserted row so a later-call cell write keeps the inherited look', () => {
    const ed = makeEditor(inheritedTableFixture());
    try {
      const inserted = apply(ed, [{ op: 'insert_row', anchor: '0;0;2;0;0' }]);
      expect(inserted.results.filter((entry) => !entry.ok)).toEqual([]);

      const filled = apply(
        ed,
        [{ op: 'set_cell_text', anchor: '0;0;3;0;0', text: 'A3a' }],
        'later-fill'
      );
      expect(filled.results.filter((entry) => !entry.ok)).toEqual([]);
      expect(resolvedTextFormat(ed, '0;0;3;0;0', 'A3a')).toMatchObject({
        character: { fontFamily: 'Georgia', fontSize: 13, italic: true },
        paragraph: { textAlignment: 'Right', afterSpacing: 7 }
      });
    } finally {
      destroyEditor(ed);
    }
  });

  it('uses the table body cycle when an appended row displaces no row', () => {
    const ed = makeEditor(inheritedTableFixture());
    try {
      const result = apply(ed, [
        { op: 'insert_row', anchor: '0;0;4;0;0' },
        { op: 'set_cell_text', anchor: '0;0;5;0;0', text: 'A5' }
      ]);

      expect(result.results.filter((entry) => !entry.ok)).toEqual([]);
      expect(resolvedTextFormat(ed, '0;0;5;0;0', 'A5')).toMatchObject({
        character: { fontFamily: 'Georgia', fontSize: 9.5, italic: false },
        paragraph: { textAlignment: 'Left', afterSpacing: 2 }
      });
    } finally {
      destroyEditor(ed);
    }
  });
});

describe('inserting and deleting rows keeps the banding correct', () => {
  it('inserts a row mid-table and leaves the stripe intact', () => {
    const ed = makeEditor(twoTables());
    try {
      const result = apply(
        ed,
        [{ op: 'insert_row', anchor: '0;1;2;0;0' }],
        'mid-insert'
      );
      expect(result.results[0].ok).toBe(true);
      expect(fills(ed, '0;1')).toEqual([
        HEADER_FILL,
        null,
        BAND_FILL,
        null, // the new row, correctly unfilled
        BAND_FILL, // and everything below it flipped back into phase
        null
      ]);
      expect(result.results[0].appearance).toMatchObject({
        banding: { headerRows: 1, period: 2, cycle: [null, BAND_FILL] }
      });
      // The row insert is still one rejectable card; the restripe adds none.
      expect(revisions(ed).map((r) => r.revisionType)).toEqual(['Insertion']);
    } finally {
      destroyEditor(ed);
    }
  });

  it('fills a row inserted above a banded row correctly too', () => {
    const ed = makeEditor(twoTables());
    try {
      apply(ed, [{ op: 'insert_row', anchor: '0;1;2;0;0', above: true }]);
      expect(fills(ed, '0;1')).toEqual([
        HEADER_FILL,
        null,
        BAND_FILL,
        null,
        BAND_FILL,
        null
      ]);
    } finally {
      destroyEditor(ed);
    }
  });

  // A TRACKED delete leaves the row in place until the revision is accepted, so
  // nothing below it has changed parity yet - restriping here would be wrong, and
  // the engine deliberately does not.
  it('leaves the stripe alone after a tracked delete, which shifts nothing yet', () => {
    const ed = makeEditor(twoTables());
    try {
      const result = apply(ed, [{ op: 'delete_row', anchor: '0;1;2;0;0' }]);
      expect(result.results[0].ok).toBe(true);
      expect(revisions(ed).map((r) => r.revisionType)).toEqual(['Deletion']);
      expect(facts(ed, '0;1').rowCount).toBe(5);
      expect(fills(ed, '0;1')).toEqual([
        HEADER_FILL,
        null,
        BAND_FILL,
        null,
        BAND_FILL
      ]);
      expect(result.results[0].appearance).toBeUndefined();
    } finally {
      destroyEditor(ed);
    }
  });

  it('honours `preserveBanding: false` and leaves SyncFusion behaviour raw', () => {
    const ed = makeEditor(twoTables());
    try {
      const result = apply(ed, [
        { op: 'insert_row', anchor: '0;1;2;0;0', preserveBanding: false }
      ]);
      expect(result.results[0].appearance).toBeUndefined();
      expect(fills(ed, '0;1')).toEqual([
        HEADER_FILL,
        null,
        BAND_FILL,
        BAND_FILL,
        null,
        BAND_FILL
      ]);
    } finally {
      destroyEditor(ed);
    }
  });

  it('touches nothing when the table has no stripe to preserve', () => {
    const ed = makeEditor(twoTables());
    try {
      const result = apply(ed, [{ op: 'insert_row', anchor: '0;2;2;0;0' }]);
      expect(result.results[0].ok).toBe(true);
      expect(result.results[0].appearance).toBeUndefined();
      expect(fills(ed, '0;2')).toEqual([null, null, null, null, null, null]);
    } finally {
      destroyEditor(ed);
    }
  });

  it('fills a new row AND its cell text as one card', () => {
    // The captain's real shape: add a row to a banded table and put data in it.
    const ed = makeEditor(twoTables());
    try {
      const result = apply(ed, [
        { op: 'insert_row', anchor: '0;1;2;0;0' },
        { op: 'set_cell_text', anchor: '0;1;3;0;0', text: '2a' },
        { op: 'set_cell_text', anchor: '0;1;3;1;0', text: 'B2 St' }
      ]);
      expect(result.results.map((entry) => entry.ok)).toEqual([
        true,
        true,
        true
      ]);
      expect(fills(ed, '0;1')).toEqual([
        HEADER_FILL,
        null,
        BAND_FILL,
        null,
        BAND_FILL,
        null
      ]);
      expect(
        facts(ed, '0;1').rows[3].cells.map((entry) => entry.text)
      ).toEqual(['2a', 'B2 St']);
    } finally {
      destroyEditor(ed);
    }
  });
});

describe('appearance writes stay reversible', () => {
  it('rejecting the change set restores the appearance AND the content', () => {
    const ed = makeEditor(twoTables());
    try {
      const originalFills = fills(ed, '0;1');
      const originalRejectStream = rejectProjectionStream(
        JSON.parse(ed.serialize())
      );
      const result = apply(
        ed,
        [
          { op: 'insert_row', anchor: '0;1;2;0;0' },
          { op: 'set_cell_text', anchor: '0;1;3;0;0', text: '2a' }
        ],
        'reject-me'
      );
      expect(result.changeSet?.formatTracking).toBe(
        'grouped_with_revision_cards'
      );
      // The stripe moved, so there IS something for the reject to undo.
      expect(fills(ed, '0;1')).not.toEqual(originalFills);

      // One decision, taken from any member of the group.
      revisions(ed)[0].reject();

      expect(fills(ed, '0;1')).toEqual(originalFills);
      expect(facts(ed, '0;1').rowCount).toBe(5);
      expect(rejectProjectionStream(JSON.parse(ed.serialize()))).toBe(
        originalRejectStream
      );
    } finally {
      destroyEditor(ed);
    }
  });

  it('binds appearance restores to the SAME card as the content, not extra ones', () => {
    const ed = makeEditor(twoTables());
    try {
      const result = apply(
        ed,
        [
          { op: 'insert_row', anchor: '0;1;2;0;0' },
          { op: 'set_cell_text', anchor: '0;1;3;0;0', text: '2a' },
          { op: 'restripe_table', anchor: '0;1;0;0;0' }
        ],
        'one-card'
      );
      expect(result.changeSet?.status).toBe('applied');
      expect(result.changeSet?.revisionGrouping).toBe(
        'bridge_bound_revision_cards'
      );
      expect(
        revisions(ed).every((r) => r.robinChangeSetId === 'one-card')
      ).toBe(true);
    } finally {
      destroyEditor(ed);
    }
  });

  // The precise claim, and its precise limit. Rejecting restores the APPEARANCE
  // exactly - every fill, border and alignment the read reports is back. It does
  // not restore the serialized cellFormat byte for byte, because SyncFusion has no
  // way to un-set a property: clearing a fill writes its own `"empty"` sentinel
  // and clearing a border writes lineStyle `Cleared`, where a never-touched cell
  // has neither key. Both render identically and both read as absent.
  it('restores every appearance fact, though not the cellFormat bytes', () => {
    const ed = makeEditor(twoTables());
    try {
      const appearanceOf = () =>
        facts(ed, '0;1').rows.map((entry) => [
          entry.isHeader ?? false,
          entry.appearance,
          entry.cells.map((c) => c.appearance)
        ]);
      const original = appearanceOf();
      const result = apply(
        ed,
        [
          { op: 'insert_row', anchor: '0;1;2;0;0' },
          { op: 'set_cell_text', anchor: '0;1;3;0;0', text: '2a' },
          {
            op: 'set_cell_format',
            anchor: '0;1;1;0;0',
            shading: '#FFF2CC',
            borders: 'AllBorders',
            borderStyle: 'Single',
            borderColor: '#FF0000'
          },
          // Keep this appearance write in its original cell container. A row
          // below the insertion would move to a different cell and is now
          // deliberately refused instead of guessed by matching text.
          { op: 'set_row_format', anchor: '0;1;2;0;0', isHeader: true }
        ],
        'restore-everything'
      );
      expect(result.results.every((entry) => entry.ok)).toBe(true);
      expect(appearanceOf()).not.toEqual(original);

      revisions(ed)[0].reject();

      expect(appearanceOf()).toEqual(original);
    } finally {
      destroyEditor(ed);
    }
  });

  it('rolls back only the failed group appearance and preserves a sibling group', () => {
    const ed = makeEditor(twoTables());
    try {
      const before = fills(ed, '0;1');
      const result = apply(
        ed,
        [
          {
            op: 'set_cell_text',
            group: 'survivor',
            anchor: '0;1;1;0;0',
            text: '1a'
          },
          {
            op: 'set_cell_format',
            group: 'survivor',
            anchor: '0;1;1;0;0',
            shading: '#FFF2CC'
          },
          {
            op: 'restripe_table',
            group: 'failed-appearance',
            anchor: '0;1;0;0;0',
            fromRow: 3
          },
          {
            op: 'set_cell_format',
            group: 'failed-appearance',
            anchor: '0;1;2;0;0'
          }
        ],
        'appearance-group-failure'
      );

      expect(result.results[0].ok).toBe(true);
      expect(result.results[1].ok).toBe(true);
      expect(result.results[2]).toMatchObject({
        ok: false,
        error: 'change_set_failed'
      });
      expect(result.results[3]).toMatchObject({
        ok: false,
        error: 'missing_format'
      });
      const after = fills(ed, '0;1');
      expect(facts(ed, '0;1').rows[1].cells[0].appearance?.shading).toBe(
        '#FFF2CC'
      );
      expect(after.filter((_, index) => index !== 1)).toEqual(
        before.filter((_, index) => index !== 1)
      );
      expect(
        revisions(ed).every((revision) => revision.robinGroupId === 'survivor')
      ).toBe(true);
    } finally {
      destroyEditor(ed);
    }
  });

  it('restores the exact previous fill of a single cell', () => {
    const ed = makeEditor(twoTables());
    try {
      const original = ed.serialize();
      const result = apply(
        ed,
        [
          { op: 'set_cell_text', anchor: '0;1;1;0;0', text: '1a' },
          { op: 'set_cell_format', anchor: '0;1;1;0;0', shading: '#FFF2CC' }
        ],
        'cell-format'
      );
      expect(result.changeSet?.formatTracking).toBe(
        'grouped_with_revision_cards'
      );
      expect(facts(ed, '0;1').rows[1].cells[0].appearance?.shading).toBe(
        '#FFF2CC'
      );
      revisions(ed)[0].reject();
      expect(
        facts(ed, '0;1').rows[1].cells[0].appearance?.shading
      ).toBeUndefined();
      expect(rejectProjectionStream(JSON.parse(ed.serialize()))).toBe(
        rejectProjectionStream(JSON.parse(original))
      );
    } finally {
      destroyEditor(ed);
    }
  });
});

describe('the appearance ops refuse an empty or malformed request', () => {
  it.each([
    [{ op: 'set_cell_format', anchor: '0;1;1;0;0' }, 'missing_format'],
    [
      { op: 'set_cell_format', anchor: '0;1;1;0;0', shading: 'lilac' },
      'invalid_color'
    ],
    [
      {
        op: 'set_cell_format',
        anchor: '0;1;1;0;0',
        borders: 'DiagonalBorder',
        borderStyle: 'Single'
      },
      'invalid_border_type'
    ],
    [
      { op: 'set_cell_format', anchor: '0;1;1;0;0', verticalAlignment: 'Middle' },
      'invalid_vertical_alignment'
    ],
    [{ op: 'set_cell_format', anchor: '0;0', shading: '#FFF2CC' }, 'not_a_cell_anchor'],
    [{ op: 'set_row_format', anchor: '0;1;1;0;0' }, 'missing_format']
  ])('%j -> %s', (edit, error) => {
    const ed = makeEditor(twoTables());
    try {
      const before = ed.serialize();
      const result = apply(ed, [edit]);
      expect(result.results[0]).toMatchObject({ ok: false, error });
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyEditor(ed);
    }
  });

  it('accepts `isHeader` on its own as a complete set_row_format request', () => {
    const ed = makeEditor(twoTables());
    try {
      const result = apply(ed, [
        { op: 'set_row_format', anchor: '0;2;0;0;0', isHeader: true }
      ]);
      expect(result.results[0].ok).toBe(true);
      expect(facts(ed, '0;2').rows[0].isHeader).toBe(true);
      expect(result.results[0].appearance).toMatchObject({ cellsWritten: 0 });
    } finally {
      destroyEditor(ed);
    }
  });
});
