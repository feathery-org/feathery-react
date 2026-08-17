// Ported from the POC's test/multi-table.test.js. Two configured tables, one
// shared document-level number living in BOTH tables' header cells, and a formula
// spanning both - the case that proves fan-out and the dependency graph are not
// quietly scoped to a single table.
import { applyRules, hasBlockingErrors } from '../engine';
import {
  getAt,
  removeLineItem,
  scanBindings,
  setAt,
  setOccurrenceText
} from '../sfdtAdapter';
import { buildCostsFixture } from './fixtures/costsFixture';

const formulaText = (index: any, name: string): string =>
  index.formulas.get(name)[0].text;

describe('two tables sharing one field', () => {
  it('scans both tables, the shared header field and the cross-table formula', () => {
    const index = scanBindings(buildCostsFixture());
    expect(index.diagnostics).toEqual([]);
    expect([...index.tables.keys()].sort()).toEqual(['costs', 'expenses']);
    expect(index.tables.get('expenses')!.rows.map((row) => row.rowId)).toEqual([
      'e-1',
      'e-2'
    ]);

    // tax_rate is ONE document-level number with an occurrence in each header.
    const tax = index.fields.get('tax_rate')!;
    expect(tax).toHaveLength(2);
    for (const occurrence of tax) {
      expect(occurrence.text).toBe('0%');
      // Header controls carry no row=, so they are document scope.
      expect(occurrence.tableId).toBeNull();
      expect(occurrence.def.isDeletable).toBe(false);
      expect(occurrence.def.fieldType.kind).toBe('percent');
    }
    const combined = index.formulas.get('combined_total')![0].def;
    expect(combined.kind === 'formula' ? combined.expression : null).toBe(
      'sum(grand_total,expenses_total)'
    );
  });

  it('diagnoses mixed global scope under one binding id', () => {
    const sfdt = buildCostsFixture({ globalTaxRate: true });
    const second = scanBindings(sfdt).fields.get('tax_rate')![1];
    const control = getAt(sfdt, second.path);
    const mixed = setAt(sfdt, second.path, {
      ...control,
      contentControlProperties: {
        ...control.contentControlProperties,
        tag: second.tag.replace('|global=true', '')
      }
    });

    expect(scanBindings(mixed).diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'conflicting-definition',
          message: expect.stringContaining('global scope')
        })
      ])
    );
  });

  it('propagates a tax rate edit from either header to the other', () => {
    const base = applyRules(buildCostsFixture(), {});

    // Edit the EXPENSES header occurrence (second in document order).
    const second = base.index.fields.get('tax_rate')![1];
    const result = applyRules(setOccurrenceText(base.sfdt, second, '8%'), {
      prevValues: base.values
    });
    expect(result.diagnostics).toEqual([]);
    for (const occurrence of result.index.fields.get('tax_rate')!) {
      expect(occurrence.text).toBe('8%');
    }
    expect(
      result.changed.some(
        (entry) => entry.type === 'field' && entry.name === 'tax_rate'
      )
    ).toBe(true);

    // And back the other way: edit the COSTS header occurrence.
    const first = result.index.fields.get('tax_rate')![0];
    const back = applyRules(setOccurrenceText(result.sfdt, first, '10%'), {
      prevValues: result.values
    });
    for (const occurrence of back.index.fields.get('tax_rate')!) {
      expect(occurrence.text).toBe('10%');
    }
  });

  it('recomputes subtotal/tax/total in BOTH tables from one rate edit', () => {
    const base = applyRules(buildCostsFixture(), {});
    // Baseline at 0%: tax rows visible but zero.
    expect(formulaText(base.index, 'costs_tax')).toBe('$0.00');
    expect(formulaText(base.index, 'expenses_tax')).toBe('$0.00');

    const first = base.index.fields.get('tax_rate')![0];
    const result = applyRules(setOccurrenceText(base.sfdt, first, '8%'), {
      prevValues: base.values
    });
    expect(result.diagnostics).toEqual([]);

    // Line items stay net.
    const rows = result.index.tables.get('costs')!.rows;
    expect(rows[0].bindings.get('line_total')!.text).toBe('$1,800.00');
    expect(rows[1].bindings.get('line_total')!.text).toBe('$6,000.00');

    // costs: subtotal -> tax -> total
    expect(formulaText(result.index, 'costs_subtotal')).toBe('$7,800.00');
    expect(formulaText(result.index, 'costs_tax')).toBe('$624.00'); // 7800 x 8%
    for (const grand of result.index.formulas.get('grand_total')!) {
      expect(grand.text).toBe('$8,424.00');
    }

    // Expenses now incorporate the tax too.
    expect(formulaText(result.index, 'expenses_subtotal')).toBe('$1,700.00');
    expect(formulaText(result.index, 'expenses_tax')).toBe('$136.00'); // 1700 x 8%
    expect(formulaText(result.index, 'expenses_total')).toBe('$1,836.00');
    expect(formulaText(result.index, 'combined_total')).toBe('$10,260.00');

    // Typed without the % sign works too, and display normalizes on fan-out.
    const again = applyRules(
      setOccurrenceText(
        result.sfdt,
        result.index.fields.get('tax_rate')![1],
        '8.5'
      ),
      { prevValues: result.values }
    );
    for (const occurrence of again.index.fields.get('tax_rate')!) {
      expect(occurrence.text).toBe('8.5%');
    }
    expect(formulaText(again.index, 'costs_tax')).toBe('$663.00'); // 7800 x 8.5%
    expect(formulaText(again.index, 'expenses_tax')).toBe('$144.50');
    expect(formulaText(again.index, 'combined_total')).toBe('$10,307.50');
  });

  it('keeps header run formatting through propagation', () => {
    const base = applyRules(buildCostsFixture(), {});
    const first = base.index.fields.get('tax_rate')![0];
    const result = applyRules(setOccurrenceText(base.sfdt, first, '8%'), {
      prevValues: base.values
    });
    for (const occurrence of result.index.fields.get('tax_rate')!) {
      const node = getAt(result.sfdt, occurrence.path);
      expect(node.inlines[0].characterFormat.fontColor).toBe('#FFFFFF');
      expect(node.inlines[0].characterFormat.bold).toBe(true);
    }
  });

  it('blocks conflicting header edits made in one snapshot', () => {
    const base = applyRules(buildCostsFixture(), {});
    const [a, b] = base.index.fields.get('tax_rate')!;
    let edited = setOccurrenceText(base.sfdt, a, '8%');
    edited = setOccurrenceText(edited, b, '10%');
    const result = applyRules(edited, { prevValues: base.values });
    expect(
      result.diagnostics.some(
        (entry) =>
          entry.code === 'ambiguous-edit' && /tax_rate/.test(entry.message)
      )
    ).toBe(true);
    expect(hasBlockingErrors(result.diagnostics)).toBe(true);
  });

  it('blocks every dependent formula on an invalid rate, without garbage', () => {
    const base = applyRules(buildCostsFixture(), {});
    const first = base.index.fields.get('tax_rate')![0];
    const result = applyRules(setOccurrenceText(base.sfdt, first, 'lots'), {
      prevValues: base.values
    });
    expect(
      result.diagnostics.some(
        (entry) =>
          entry.code === 'invalid-input' && /tax_rate/.test(entry.message)
      )
    ).toBe(true);
    expect(hasBlockingErrors(result.diagnostics)).toBe(true);
    // Stale totals stay visible instead of NaN.
    expect(
      result.index.tables.get('costs')!.rows[0].bindings.get('line_total')!.text
    ).toBe('$1,800.00');
  });

  it('routes an expenses edit to expenses_total and combined_total only', () => {
    const base = applyRules(buildCostsFixture(), {});
    const amount = base.index.tables
      .get('expenses')!
      .rows[0].bindings.get('amount')!;
    const result = applyRules(setOccurrenceText(base.sfdt, amount, '900'), {
      prevValues: base.values
    });
    expect(result.diagnostics).toEqual([]);
    expect(formulaText(result.index, 'expenses_total')).toBe('$2,100.00');
    expect(formulaText(result.index, 'combined_total')).toBe('$9,900.00');
    for (const grand of result.index.formulas.get('grand_total')!) {
      expect(grand.text).toBe('$7,800.00');
    }
  });

  it('flows a costs edit through grand_total into combined_total', () => {
    const base = applyRules(buildCostsFixture(), {});
    const quantity = base.index.tables
      .get('costs')!
      .rows[0].bindings.get('quantity')!;
    const result = applyRules(setOccurrenceText(base.sfdt, quantity, '13'), {
      prevValues: base.values
    });
    expect(formulaText(result.index, 'grand_total')).toBe('$7,950.00');
    expect(formulaText(result.index, 'combined_total')).toBe('$9,650.00');
  });

  it('adopts a native row in the second table too', () => {
    const doc = buildCostsFixture();
    const tablePath = scanBindings(doc).tables.get('expenses')!.tablePath!;
    getAt(doc, tablePath).rows.splice(3, 0, {
      cells: ['Conference tickets', '350'].map((text, i) => ({
        blocks: [
          {
            paragraphFormat: { leftIndent: 0, firstLineIndent: 0 },
            inlines: [{ text }]
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
    });

    const result = applyRules(doc, {});
    expect(
      result.diagnostics.some(
        (entry) =>
          entry.code === 'row-adopted' && /expenses/.test(entry.message)
      )
    ).toBe(true);
    const rows = result.index.tables.get('expenses')!.rows;
    expect(rows).toHaveLength(3);
    expect(rows[2].bindings.get('expense')!.text).toBe('Conference tickets');
    expect(rows[2].bindings.get('amount')!.text).toBe('$350.00');
    expect(formulaText(result.index, 'expenses_total')).toBe('$2,050.00');
    expect(formulaText(result.index, 'combined_total')).toBe('$9,850.00');
  });

  it('shrinks both dependent totals when an expenses row is removed', () => {
    const base = applyRules(buildCostsFixture(), {});
    const removed = removeLineItem(base.sfdt, 'expenses', 'e-2', base.index);
    const result = applyRules(removed, { prevValues: base.values });
    expect(formulaText(result.index, 'expenses_total')).toBe('$500.00');
    expect(formulaText(result.index, 'combined_total')).toBe('$8,300.00');
  });
});
