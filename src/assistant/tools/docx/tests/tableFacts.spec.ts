// `table_facts`: the structure-read-first half of the design.
//
// The engine reports FACTS, the model INTERPRETS, then the engine COMPUTES over
// the ranges the model chose. These tests hold the engine to the first part -
// and, just as important, hold it to NOT doing the second: there is no
// `headerRow`, no `dataRows` and no subtotal detection anywhere in the result,
// because a guessed header row is how a schedule gets summed from the wrong row
// and an inferred subtotal is how a subtotal gets counted twice.
//
// The fixture is deliberately nasty - a merged title banner, two stacked header
// rows, blank separator rows, a mid-table section label, bold regional
// subtotals, a grand total, and a short row - because a layout-agnostic design
// is only demonstrated on a table that defeats every layout assumption.
import {
  buildInventoryFromBlocks,
  collectTableFacts,
  flattenSfdt,
  getDocumentInventory,
  LiveEditor,
  TableFacts,
  TABLE_FACTS_CELL_TEXT_CHARS
} from '../syncfusionDocumentOps';
import { runFormula } from './formulaHarness';

const cell = (
  text: string,
  options: { bold?: boolean; columnSpan?: number; rowSpan?: number } = {}
) => ({
  cellFormat: {
    ...(options.columnSpan ? { columnSpan: options.columnSpan } : {}),
    ...(options.rowSpan ? { rowSpan: options.rowSpan } : {})
  },
  blocks: [
    {
      inlines: [
        { text, ...(options.bold ? { characterFormat: { bold: true } } : {}) }
      ]
    }
  ]
});

const row = (cells: any[]) => ({ rowFormat: {}, cells });
const bold = (text: string) => cell(text, { bold: true });
const para = (text: string) => ({ inlines: [{ text }] });

// A realistic irregular schedule. Row indices matter to every assertion:
//   0  merged title banner spanning all four columns
//   1  header row A (bold)
//   2  header row B - stacked units row (bold)
//   3  blank separator
//   4  section label row ("Region A"), only the first cell filled
//   5  data
//   6  data
//   7  regional subtotal (bold)
//   8  blank separator
//   9  section label row ("Region B")
//  10  data
//  11  grand total (bold)
//  12  short row: two cells only (a footnote spanning the rest)
const irregularSfdt = () => ({
  sections: [
    {
      blocks: [
        para('Property Schedule'),
        {
          tableFormat: {},
          rows: [
            row([
              cell('2026 Property Schedule', { bold: true, columnSpan: 4 }),
              cell(''),
              cell(''),
              cell('')
            ]),
            row([
              bold('Location'),
              bold('Address'),
              bold('Premium'),
              bold('Tax')
            ]),
            row([bold(''), bold(''), bold('(USD)'), bold('(USD)')]),
            row([cell(''), cell(''), cell(''), cell('')]),
            row([cell('Region A'), cell(''), cell(''), cell('')]),
            row([
              cell('0093'),
              cell('1 King St W'),
              cell('$36,803.00'),
              cell('$4,784.39')
            ]),
            row([
              cell('0094'),
              cell('94 Main St'),
              cell('$12,450.00'),
              cell('$1,618.50')
            ]),
            row([
              bold('Region A subtotal'),
              bold(''),
              bold('$49,253.00'),
              bold('$6,402.89')
            ]),
            row([cell(''), cell(''), cell(''), cell('')]),
            row([cell('Region B'), cell(''), cell(''), cell('')]),
            row([
              cell('0101'),
              cell('7 Bay St'),
              cell('$4,000.00'),
              cell('$520.00')
            ]),
            row([
              bold('Total'),
              bold(''),
              bold('$53,253.00'),
              bold('$6,922.89')
            ]),
            row([cell('Premiums exclude surplus lines tax.'), cell('')])
          ]
        },
        para('End')
      ]
    }
  ]
});

const facts = (): TableFacts => {
  const sfdt = irregularSfdt();
  const result = collectTableFacts(flattenSfdt(sfdt), sfdt, '0;1');
  if (!result) throw new Error('table not found');
  return result;
};

describe('table_facts reports layout facts', () => {
  it('reports dimensions and flags the table as non-uniform when a row is short', () => {
    const table = facts();
    expect(table).toMatchObject({
      tableAnchor: '0;1',
      rowCount: 13,
      columnCount: 4,
      uniformRows: false,
      truncated: false
    });
    // The short footnote row is reported as short, not padded and not dropped.
    expect(table.rows[12].cellCount).toBe(2);
    expect(table.rows.map((entry) => entry.row)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
    ]);
  });

  it('names every merged cell with its spans', () => {
    expect(facts().mergedCells).toEqual([
      { row: 0, column: 0, anchor: '0;1;0;0;0', columnSpan: 4, rowSpan: 1 }
    ]);
    expect(facts().rows[0].hasMergedCells).toBe(true);
    expect(facts().rows[1].hasMergedCells).toBeUndefined();
  });

  it('reports bold as a fact per row without calling any row a header', () => {
    const table = facts();
    // Bold rows: the banner, both stacked header rows, the subtotal, the total.
    expect(
      table.rows.filter((entry) => entry.allBold).map((entry) => entry.row)
    ).toEqual([0, 1, 2, 7, 11]);
    // ...and the result never names one of them as THE header. The field set is
    // pinned so an "interpretation" field cannot be added without this failing.
    expect(Object.keys(table).sort()).toEqual([
      'columnCount',
      'columns',
      'mergedCells',
      'rowCount',
      'rows',
      'tableAnchor',
      'truncated',
      'uniformRows'
    ]);
    const rowFields = new Set<string>();
    for (const entry of table.rows) {
      for (const key of Object.keys(entry)) rowFields.add(key);
    }
    expect([...rowFields].sort()).toEqual([
      'allBold',
      'blankRow',
      'cellCount',
      'cells',
      'filledCells',
      'hasMergedCells',
      'row'
    ]);
  });

  it('reports blank rows and per-row fill counts', () => {
    const table = facts();
    expect(
      table.rows.filter((entry) => entry.blankRow).map((entry) => entry.row)
    ).toEqual([3, 8]);
    // A section label row is NOT blank - it has one filled cell. The engine
    // says "1 of 4 filled"; deciding it is a section label is interpretation.
    expect(table.rows[4]).toMatchObject({
      row: 4,
      cellCount: 4,
      filledCells: 1
    });
    expect(table.rows[4].blankRow).toBeUndefined();
  });

  it('reports which cells parse as numbers and which are formatted amounts', () => {
    const table = facts();
    const premium = table.columns[2];
    expect(premium).toMatchObject({
      column: 2,
      // 12, not 13: the short footnote row has no cell at this column, and the
      // facts say so rather than padding the column out to the row count.
      presentCells: 12,
      filledCells: 7,
      // Two data amounts per region plus the subtotal and the grand total; the
      // "(USD)" header cell is prose, not a number.
      numericCells: 5,
      quantityCells: 5,
      units: ['$'],
      decimals: [2]
    });
    // A zero-padded location id parses as a number but is NOT a quantity, so a
    // model cannot mistake the id column for a money column.
    const location = table.columns[0];
    expect(location).toMatchObject({ numericCells: 3, quantityCells: 0 });
    expect(table.rows[5].cells[0]).toMatchObject({
      text: '0093',
      numeric: true,
      quantity: false
    });
    // An ADDRESS is not a number, even though `parseNumericCell` would read a
    // leading "1" out of it: prose decoration disqualifies the cell, so an
    // address column never advertises itself as numeric.
    expect(table.columns[1]).toMatchObject({
      numericCells: 0,
      quantityCells: 0,
      units: []
    });
    expect(table.rows[5].cells[1]).toMatchObject({
      text: '1 King St W',
      numeric: false,
      quantity: false
    });
    expect(table.rows[5].cells[1].unit).toBeUndefined();
  });

  it('gives every cell the anchor a formula would reference, plus its verbatim text', () => {
    const table = facts();
    expect(table.rows[5].cells[2]).toMatchObject({
      row: 5,
      column: 2,
      anchor: '0;1;5;2;0',
      text: '$36,803.00',
      blank: false,
      numeric: true,
      quantity: true,
      unit: '$',
      decimals: 2,
      paragraphs: 1
    });
  });

  it('clips an over-long cell text explicitly rather than silently', () => {
    const sfdt = irregularSfdt();
    const long = `x${'y'.repeat(TABLE_FACTS_CELL_TEXT_CHARS + 40)}`;
    sfdt.sections[0].blocks[1].rows[12].cells[0].blocks[0].inlines[0].text =
      long;
    const table = collectTableFacts(flattenSfdt(sfdt), sfdt, '0;1')!;
    const clipped = table.rows[12].cells[0];
    expect(clipped.textTruncated).toBe(true);
    expect(clipped.text).toHaveLength(TABLE_FACTS_CELL_TEXT_CHARS + 3);
    expect(clipped.text.endsWith('...')).toBe(true);
    // A cell that fits carries no truncation flag at all.
    expect(table.rows[5].cells[2].textTruncated).toBeUndefined();
  });

  it('joins a multi-paragraph cell and says how many paragraphs it had', () => {
    const sfdt = irregularSfdt();
    sfdt.sections[0].blocks[1].rows[5].cells[1].blocks.push({
      inlines: [{ text: 'Suite 400' }]
    });
    const table = collectTableFacts(flattenSfdt(sfdt), sfdt, '0;1')!;
    expect(table.rows[5].cells[1]).toMatchObject({
      text: '1 King St W\nSuite 400',
      paragraphs: 2
    });
  });
});

describe('table_facts is never silently partial', () => {
  it('ignores maxEntries: a facts read is complete or it is a refusal', () => {
    const sfdt = irregularSfdt();
    const capped = buildInventoryFromBlocks(
      flattenSfdt(sfdt),
      { scope: 'table_facts', tableAnchor: '0;1', maxEntries: 2 },
      sfdt
    ) as any;
    expect(capped.table.rows).toHaveLength(13);
    expect(capped.table.truncated).toBe(false);
    expect(capped.truncation).toBeUndefined();
  });

  it('accepts a cell anchor as the tableAnchor and refuses honest limits', () => {
    const sfdt = irregularSfdt();
    const blocks = flattenSfdt(sfdt);
    expect(
      (
        buildInventoryFromBlocks(
          blocks,
          { scope: 'table_facts', tableAnchor: '0;1;5;2;0' },
          sfdt
        ) as any
      ).table.tableAnchor
    ).toBe('0;1');
    expect(
      buildInventoryFromBlocks(blocks, { scope: 'table_facts' }, sfdt)
    ).toMatchObject({ error: 'missing_table_anchor', retry: 'modified_input' });
    expect(
      buildInventoryFromBlocks(
        blocks,
        { scope: 'table_facts', tableAnchor: '0;9' },
        sfdt
      )
    ).toMatchObject({ error: 'table_not_found', retry: 'after_remedy' });
    // Anchoring a paragraph rather than a table is a table_not_found, not a crash.
    expect(
      buildInventoryFromBlocks(
        blocks,
        { scope: 'table_facts', tableAnchor: '0;0' },
        sfdt
      )
    ).toMatchObject({ error: 'table_not_found' });
  });

  it('is reachable through the live getDocumentInventory read', () => {
    const stub = { serialize: () => JSON.stringify(irregularSfdt()) };
    const result = getDocumentInventory(stub as unknown as LiveEditor, {
      scope: 'table_facts',
      tableAnchor: '0;1'
    }) as any;
    expect(result.table.rowCount).toBe(13);
    expect(result.table.columns[2].quantityCells).toBe(5);
  });
});

describe('facts in, ranges out: the model interprets, the engine computes', () => {
  // The point of the split. From the facts above a model can see that rows 0-2
  // are banner+headers, 3 and 8 are separators, 4 and 9 are section labels, 7 is
  // a bold subtotal and 11 is the grand total - so the DATA is rows 5, 6 and 10.
  // It then names exactly those rows, and the engine computes over them. No
  // layout assumption is baked into the engine at any point.
  const premiums = [
    null, // 0 banner
    'Premium', // 1
    '(USD)', // 2
    '', // 3
    '', // 4
    '$36,803.00', // 5
    '$12,450.00', // 6
    '$49,253.00', // 7 subtotal - must NOT be counted
    '', // 8
    '', // 9
    '$4,000.00', // 10
    '$53,253.00' // 11 total (the write target)
  ];

  it('sums only the interpreted data rows, skipping the subtotal entirely', () => {
    const result = runFormula(
      premiums,
      'sum([0;7;5..6;1]) + sum([0;7;10..10;1])',
      '$53,253.00'
    );
    expect(result).toMatchObject({
      ok: true,
      renderedValue: '$53,253.00',
      counted: 3
    });
  });

  it('a range that naively starts at row 1 double-counts the subtotal - and the receipt is what exposes it', () => {
    // Exactly the failure the resolved-range receipt exists to make visible:
    // arithmetically flawless, and wrong.
    const naive = runFormula(premiums, 'sum([0;7;1..10;1])', '$53,253.00');
    expect(naive).toMatchObject({ ok: true, renderedValue: '$102,506.00' });
    expect(naive.renderedValue).not.toBe('$53,253.00');
  });
});
