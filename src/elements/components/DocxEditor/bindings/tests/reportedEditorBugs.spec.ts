// Two bugs reported from a real form, both against the shape of
// cost-estimate-template.docx (5 rows x 4 cells, labels in cell 2, cells 0-1
// empty, every row carrying a token):
//
//   1. clicking a cell with a content control half-erased the page. The border
//      renderer reads contentControlProperties.color unguarded, and a .docx round
//      trip drops it - Syncfusion's own docx writer emits w:tag and no colour, so
//      colour cannot survive a save. See contentControlSafety.
//   2. editing a quantity cell fabricated duplicate rows. Row adoption replaces
//      any unbound row with a clone of the bound data row, and it was scanning
//      the whole table - so a totals row that had lost its content control was
//      overwritten with a fabricated line item.
import {
  destroyRealDocumentEditor,
  makeRealDocumentEditor
} from './realEditorHarness';
import {
  DEFAULT_CONTENT_CONTROL_COLOR,
  stampMissingContentControlColors
} from '../../contentControlSafety';
import { convertTemplateTokens } from '../core/templateImport';
import { applyRules } from '../core/engine';
import { adoptUnboundRows, getAt, scanBindings } from '../core/sfdtAdapter';
import { SfdtDocument } from '../core/sfdtTypes';

type AnyEditor = any;

const para = (text: string) => ({
  inlines: text ? [{ characterFormat: {}, text }] : [],
  paragraphFormat: {}
});
const cell = (text: string) => ({ cellFormat: {}, blocks: [para(text)] });
const row = (...texts: string[]) => ({
  rowFormat: {},
  cells: texts.map(cell)
});

/** The real template's costs table, token for token. */
function templateDoc(): SfdtDocument {
  return {
    sections: [
      {
        blocks: [
          para('Project: [[name=project.name|default=Website relaunch]]'),
          para('[[table=costs]]'),
          {
            tableFormat: {},
            rows: [
              row(
                'Item',
                'Qty',
                'Unit price',
                'Line total — tax [[name=tax_rate|type=percent|del=keep|default=0%]]'
              ),
              row(
                '[[name=item|default=Design work|row=auto]]',
                '[[name=quantity|type=integer|default=12|row=auto]]',
                '[[name=unit_cost|type=currency|default=150|row=auto]]',
                '[[name=line_total|expr=mul(quantity,unit_cost)|row=auto]]'
              ),
              row(
                '',
                '',
                'Subtotal',
                '[[name=costs_subtotal|expr=sum(costs.line_total)]]'
              ),
              row(
                '',
                '',
                'Tax',
                '[[name=costs_tax|expr=mul(costs_subtotal,tax_rate)]]'
              ),
              row(
                '',
                '',
                'Total',
                '[[name=grand_total|expr=sum(costs_subtotal,costs_tax)]]'
              )
            ]
          }
        ],
        headersFooters: {}
      }
    ]
  } as SfdtDocument;
}

function boundDoc(): SfdtDocument {
  return applyRules(convertTemplateTokens(templateDoc()).sfdt, {}).sfdt;
}

/** First table in the document, whatever wraps it. */
function firstTable(sfdt: unknown): any {
  let hit: any = null;
  const walk = (node: any): void => {
    if (!node || typeof node !== 'object' || hit) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (Array.isArray(node.rows)) {
      hit = node;
      return;
    }
    Object.values(node).forEach(walk);
  };
  walk(sfdt);
  return hit;
}

const cellText = (node: any): string => {
  if (!node || typeof node !== 'object') return '';
  if (Array.isArray(node)) return node.map(cellText).join('');
  let out = typeof node.text === 'string' ? node.text : '';
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'text') out += cellText(value);
  }
  return out;
};

const rowTexts = (sfdt: unknown): string[][] =>
  (firstTable(sfdt)?.rows ?? []).map((r: any) =>
    (r.cells ?? []).map((c: any) => cellText(c))
  );

describe('a content control with no colour does not break rendering', () => {
  it('stamps a colour onto controls that arrive without one', () => {
    // What the docx round trip produces: tags intact, colour gone.
    const stripped = boundDoc();
    let removed = 0;
    const strip = (node: any): void => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(strip);
      if (node.contentControlProperties) {
        delete node.contentControlProperties.color;
        removed += 1;
      }
      Object.values(node).forEach(strip);
    };
    strip(stripped);
    expect(removed).toBeGreaterThan(0);

    const editor: AnyEditor = makeRealDocumentEditor(stripped);
    try {
      const collection = editor.documentHelper.contentControlCollection;
      const withoutColor = () =>
        collection.filter((c: any) => c.contentControlProperties?.color == null)
          .length;
      // The precondition: the editor really did read them without a colour.
      expect(withoutColor()).toBeGreaterThan(0);

      const fixed = stampMissingContentControlColors(editor);

      expect(fixed).toBeGreaterThan(0);
      expect(withoutColor()).toBe(0);
      expect(collection[0].contentControlProperties.color).toBe(
        DEFAULT_CONTENT_CONTROL_COLOR
      );
    } finally {
      destroyRealDocumentEditor(editor);
    }
  });

  it('leaves an existing colour alone and never throws', () => {
    const editor: AnyEditor = makeRealDocumentEditor(boundDoc());
    try {
      expect(stampMissingContentControlColors(editor)).toBe(0);
    } finally {
      destroyRealDocumentEditor(editor);
    }
    // Anything that is not an editor must be survivable - this runs on the
    // ordinary open path, and must never stop a document from opening.
    expect(stampMissingContentControlColors(null)).toBe(0);
    expect(stampMissingContentControlColors({})).toBe(0);
    expect(stampMissingContentControlColors({ documentHelper: {} })).toBe(0);
  });
});

describe('row adoption stays inside the data block', () => {
  it('adopts nothing in an untouched template', () => {
    const doc = boundDoc();
    const result = adoptUnboundRows(doc, 'costs');
    expect(result.adopted).toEqual([]);
    expect(result.sfdt).toBe(doc);
  });

  it('refuses a totals row that has lost its content control', () => {
    // The reported bug. Strip the control from the Subtotal row, leaving its
    // computed text behind, exactly as a damaged round trip would.
    const doc = boundDoc();
    const table = firstTable(doc);
    const subtotalCell = table.rows[2].cells[3];
    subtotalCell.blocks[0].inlines = [
      { characterFormat: {}, text: '$1,800.00' }
    ];

    const result = adoptUnboundRows(doc, 'costs');

    expect(result.adopted).toEqual([]);
    // And it says why, rather than going quiet.
    expect(result.skipped.map((s) => s.reason)).toEqual([
      expect.stringContaining('formula')
    ]);
    // The row still reads as a totals row, not a fabricated line item.
    expect(rowTexts(result.sfdt)[2]).toEqual(['', '', 'Subtotal', '$1,800.00']);
  });

  it('still adopts a row inserted below the data row', () => {
    // The feature this guard must not break: the user adds a row and types.
    const doc = boundDoc();
    const table = firstTable(doc);
    table.rows.splice(2, 0, {
      rowFormat: {},
      cells: [cell('Extra work'), cell('3'), cell('50'), cell('')]
    });

    const result = adoptUnboundRows(doc, 'costs');

    expect(result.adopted).toHaveLength(1);
    const adoptedRow = rowTexts(result.sfdt)[2];
    expect(adoptedRow[0]).toBe('Extra work');
    expect(adoptedRow[1]).toBe('3');
    expect(adoptedRow[2]).toBe('$50.00');
    // The formula cell is left pending for the engine in the same transaction.
    expect(adoptedRow[3]).toBe('…');
  });

  // Every position a user can actually add a row from. An earlier version of the
  // guard bounded the scan to the data block, which silently stopped adoption
  // working from two of these - inserting a row appeared to do nothing at all.
  it('adopts an empty row inserted ABOVE the data row', () => {
    const doc = boundDoc();
    firstTable(doc).rows.splice(1, 0, {
      rowFormat: {},
      cells: [cell(''), cell(''), cell(''), cell('')]
    });

    const result = adoptUnboundRows(doc, 'costs');

    expect(result.adopted).toHaveLength(1);
    // Defaults from the template's own tags.
    expect(rowTexts(result.sfdt)[1]).toEqual([
      'Design work',
      '12',
      '$150.00',
      '…'
    ]);
  });

  it('adopts an empty row appended at the very BOTTOM, below the totals', () => {
    // Tab out of the last cell, or "insert row below" on the Total row.
    const doc = boundDoc();
    firstTable(doc).rows.push({
      rowFormat: {},
      cells: [cell(''), cell(''), cell(''), cell('')]
    });

    const result = adoptUnboundRows(doc, 'costs');

    expect(result.adopted).toHaveLength(1);
    expect(rowTexts(result.sfdt)[5][3]).toBe('…');
  });

  it('counts a bottom-appended row in the totals', () => {
    const doc = boundDoc();
    firstTable(doc).rows.push({
      rowFormat: {},
      cells: [cell(''), cell('2'), cell('100'), cell('')]
    });

    const rows = rowTexts(applyRules(doc, {}).sfdt);

    expect(rows[5][3]).toBe('$200.00'); // 2 x 100
    expect(rows[2][3]).toBe('$2,000.00'); // subtotal now includes it
  });

  it('computes the appended row through the engine, totals included', () => {
    const doc = boundDoc();
    const table = firstTable(doc);
    table.rows.splice(2, 0, {
      rowFormat: {},
      cells: [cell('Extra work'), cell('3'), cell('50'), cell('')]
    });

    const result = applyRules(doc, {});

    const rows = rowTexts(result.sfdt);
    expect(rows[1][3]).toBe('$1,800.00'); // 12 x 150
    expect(rows[2][3]).toBe('$150.00'); // 3 x 50
    expect(rows[3][3]).toBe('$1,950.00'); // subtotal
    expect(result.diagnostics.some((d) => d.code === 'row-adopted')).toBe(true);
  });

  it('leaves a trailing prose row alone, because its formula cell has text', () => {
    // Not positional: this row is refused because something already occupies the
    // cell the engine would own, which is what tells a note row from a new one.
    const doc = boundDoc();
    firstTable(doc).rows.push({
      rowFormat: {},
      cells: [cell(''), cell(''), cell('Notes'), cell('anything')]
    });

    const result = adoptUnboundRows(doc, 'costs');

    expect(result.adopted).toEqual([]);
    expect(rowTexts(result.sfdt)[5]).toEqual(['', '', 'Notes', 'anything']);
  });

  it('keeps the whole table intact when nothing is adopted', () => {
    const doc = boundDoc();
    const index = scanBindings(doc);
    const before = rowTexts(doc);
    const result = adoptUnboundRows(doc, 'costs', index);
    expect(rowTexts(result.sfdt)).toEqual(before);
    // Row count must never grow: adoption binds rows, it never adds them.
    expect(
      getAt(result.sfdt, index.tables.get('costs')!.tablePath as any).rows
    ).toHaveLength(5);
  });
});
