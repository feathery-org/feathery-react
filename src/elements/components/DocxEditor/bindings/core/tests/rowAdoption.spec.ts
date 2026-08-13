// Ported from the POC's test/adoption.test.js. Adoption is what makes the
// editor's own "insert row" button work without the user knowing bindings exist:
// a row Syncfusion created as plain text gets its column bindings and formulas
// inferred from the row above. The conservative half matters as much as the
// clever half - a row that does not match the template shape is reported, never
// guessed at.
import { applyRules, hasBlockingErrors } from '../engine';
import { getAt, scanBindings } from '../sfdtAdapter';
import { SfdtDocument, SfdtRow } from '../sfdtTypes';
import { buildCostsFixture } from './fixtures/costsFixture';

/** A row the way Syncfusion creates it: same cell shape, plain runs, no controls. */
function nativeRow(texts: string[]): SfdtRow {
  return {
    cells: texts.map((text, i) => ({
      blocks: [
        {
          paragraphFormat: {
            leftIndent: 0,
            firstLineIndent: 0,
            textAlignment: i === 0 ? 'Left' : 'Right'
          },
          inlines: text === '' ? [] : [{ text }]
        }
      ],
      cellFormat: {
        preferredWidth: 100,
        preferredWidthType: 'Point',
        cellWidth: 100,
        columnSpan: 1,
        rowSpan: 1
      },
      columnIndex: i
    })),
    rowFormat: {
      height: 0,
      heightType: 'Auto',
      gridBefore: 0,
      gridAfter: 0,
      allowBreakAcrossPages: true,
      isHeader: false
    }
  };
}

/** Splice a native row in after r-2 and before the summary rows. */
function withNativeRow(texts: string[], at = 3): SfdtDocument {
  const doc = buildCostsFixture();
  const tablePath = scanBindings(doc).tables.get('costs')!.tablePath!;
  getAt(doc, tablePath).rows.splice(at, 0, nativeRow(texts));
  return doc;
}

describe('row adoption', () => {
  it('infers bindings and formulas from the row above', () => {
    const result = applyRules(
      withNativeRow(['QA testing', '4', '250', '']),
      {}
    );

    expect(
      result.diagnostics.some(
        (entry) => entry.code === 'row-adopted' && entry.severity === 'info'
      )
    ).toBe(true);
    expect(hasBlockingErrors(result.diagnostics)).toBe(false);
    expect(
      result.changed.some(
        (entry) => entry.type === 'row-adopted' && entry.tableId === 'costs'
      )
    ).toBe(true);
    // Adoption rewrites tags, so the document needs a full reload.
    expect(result.structural).toBe(true);

    const rows = result.index.tables.get('costs')!.rows;
    expect(rows).toHaveLength(3);
    const adopted = rows[2];
    expect(adopted.rowId).not.toBe('r-1');
    expect(adopted.rowId).not.toBe('r-2');
    expect(adopted.bindings.get('item')!.text).toBe('QA testing');
    expect(adopted.bindings.get('quantity')!.text).toBe('4');
    // "250" normalized on adoption.
    expect(adopted.bindings.get('unit_cost')!.text).toBe('$250.00');
    expect(adopted.bindings.get('line_total')!.text).toBe('$1,000.00');
    const lineTotal = adopted.bindings.get('line_total')!.def;
    expect(lineTotal.kind === 'formula' ? lineTotal.expression : null).toBe(
      'mul(quantity,unit_cost)'
    );
    for (const grand of result.index.formulas.get('grand_total')!) {
      expect(grand.text).toBe('$8,800.00');
    }
  });

  it('adopts an empty row with defaults and leaves the totals alone', () => {
    const result = applyRules(withNativeRow(['', '', '', '']), {});
    const rows = result.index.tables.get('costs')!.rows;
    expect(rows).toHaveLength(3);
    expect(rows[2].bindings.get('quantity')!.text).toBe('0');
    expect(rows[2].bindings.get('line_total')!.text).toBe('$0.00');
    for (const grand of result.index.formulas.get('grand_total')!) {
      expect(grand.text).toBe('$7,800.00');
    }
    expect(hasBlockingErrors(result.diagnostics)).toBe(false);
  });

  it('still adopts after every bound row has been deleted', () => {
    // Deleting the last bound row removes the document's only copy of the row
    // shape. Without a remembered template, every row inserted afterwards stayed
    // plain text - permanently, and with no diagnostic to explain it.
    const doc = buildCostsFixture();
    const tablePath = scanBindings(doc).tables.get('costs')!.tablePath!;
    const table = getAt(doc, tablePath) as { rows: SfdtRow[] };

    // A first pass while bound rows exist is what captures the template.
    const seen = applyRules(doc, {});
    expect(seen.rowTemplates.get('costs')).toBeDefined();

    // Now delete both data rows and add one of the user's own.
    const emptied = JSON.parse(JSON.stringify(seen.sfdt)) as SfdtDocument;
    const emptiedTable = getAt(emptied, tablePath) as { rows: SfdtRow[] };
    emptiedTable.rows.splice(1, 2, nativeRow(['QA testing', '4', '250', '']));
    expect(scanBindings(emptied).tables.get('costs')!.rows).toHaveLength(0);

    const result = applyRules(emptied, {
      rowTemplates: seen.rowTemplates
    });
    const rows = result.index.tables.get('costs')!.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].bindings.get('quantity')!.text).toBe('4');
    expect(rows[0].bindings.get('line_total')!.text).toBe('$1,000.00');
    expect(table.rows.length).toBeGreaterThan(0); // fixture untouched
  });

  it('reports rows it cannot adopt for want of any template', () => {
    // The silent case: no bound row left and nothing remembered either.
    const doc = buildCostsFixture();
    const tablePath = scanBindings(doc).tables.get('costs')!.tablePath!;
    const table = getAt(doc, tablePath) as { rows: SfdtRow[] };
    table.rows.splice(1, 2, nativeRow(['QA testing', '4', '250', '']));

    const result = applyRules(doc, {});
    expect(
      result.diagnostics.some((entry) => entry.code === 'row-not-adopted')
    ).toBe(true);
  });

  it('seeds a new row from default and never inherits value', () => {
    // value belongs to the row it was authored on - carrying it into a new row
    // would clone stale data.
    const doc: SfdtDocument = JSON.parse(
      JSON.stringify(withNativeRow(['', '', '', ''])).replace(
        '[[name=quantity|type=integer|row=r-2]]',
        '[[name=quantity|type=integer|value=99|default=5|row=r-2]]'
      )
    );
    const adopted = applyRules(doc, {}).index.tables.get('costs')!.rows[2];
    const quantity = adopted.bindings.get('quantity')!;
    expect(quantity.text).toBe('5');
    expect(quantity.def.options.value).toBeUndefined();
    expect(quantity.def.options.default).toBe('5');
  });

  it('is idempotent: a second reconcile leaves the adopted row untouched', () => {
    const first = applyRules(withNativeRow(['QA testing', '4', '250', '']), {});
    const second = applyRules(first.sfdt, { prevValues: first.values });
    expect(second.sfdt).toBe(first.sfdt); // identity: nothing rewritten
    expect(
      second.diagnostics.some((entry) => entry.code === 'row-adopted')
    ).toBe(false);
  });

  it('skips a row that does not match the template shape, with a warning', () => {
    const doc = buildCostsFixture();
    const tablePath = scanBindings(doc).tables.get('costs')!.tablePath!;
    getAt(doc, tablePath).rows.splice(3, 0, nativeRow(['stray', '1'])); // 2 vs 4
    const result = applyRules(doc, {});
    expect(
      result.diagnostics.some(
        (entry) =>
          entry.code === 'row-not-adopted' && entry.severity === 'warning'
      )
    ).toBe(true);
    expect(result.index.tables.get('costs')!.rows).toHaveLength(2);
    // A warning, not a save blocker.
    expect(hasBlockingErrors(result.diagnostics)).toBe(false);
  });

  it('never treats a row that already has content controls as a candidate', () => {
    const result = applyRules(buildCostsFixture(), {});
    expect(
      result.diagnostics.some(
        (entry) =>
          entry.code === 'row-adopted' || entry.code === 'row-not-adopted'
      )
    ).toBe(false);
    expect(result.index.tables.get('costs')!.rows).toHaveLength(2);
  });

  it('adopts invalid typed input, keeps it visible, and blocks with a diagnostic', () => {
    const result = applyRules(
      withNativeRow(['QA testing', 'four', '250', '']),
      {}
    );
    const adopted = result.index.tables.get('costs')!.rows[2];
    expect(adopted.bindings.get('quantity')!.text).toBe('four'); // kept visible
    expect(
      result.diagnostics.some(
        (entry) =>
          entry.code === 'invalid-input' && /quantity/.test(entry.message)
      )
    ).toBe(true);
    expect(
      result.diagnostics.some((entry) => entry.code === 'evaluation-failed')
    ).toBe(true);
    // Pending, not garbage.
    expect(adopted.bindings.get('line_total')!.text).toBe('…');
    expect(hasBlockingErrors(result.diagnostics)).toBe(true);
  });
});
