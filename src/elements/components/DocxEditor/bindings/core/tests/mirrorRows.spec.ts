// Mirrors and positional ranges working together (the PR #1876 rework).
//
// A mirror is a formula cell that references values outside its own row
// ([[name=amount|expr=alpha|row=m-1]]). Nothing ever converts between kinds:
// duplicating a mirror yields a mirror, duplicating a formula keeps the
// formula. A row the user types joins a total through a POSITIONAL range
// (sum(B2:end)) that reads raw cell values - the typed row needs no binding
// at all. Tables whose only bound columns are formulas/mirrors are never
// adopted; tables with input field columns adopt as before, mirrors riding
// along as copies.
import { applyRules, hasBlockingErrors } from '../engine';
import {
  addLineItem,
  BindingIndex,
  getAt,
  Occurrence,
  scanBindings,
  setOccurrenceText
} from '../sfdtAdapter';
import { formatTag, FieldType } from '../tagDsl';
import { SfdtDocument, SfdtInline, SfdtRow } from '../sfdtTypes';

const CURRENCY: FieldType = { kind: 'currency', currency: 'USD', scale: 2 };

function cc(tag: string, title: string, locked: boolean, text: string) {
  return {
    contentControlProperties: {
      lockContentControl: true,
      lockContents: locked,
      tag,
      title,
      type: 'Text',
      hasPlaceHolderText: false,
      multiline: false,
      isTemporary: false,
      color: '#00000000',
      appearance: 'BoundingBox'
    },
    inlines: [{ text }]
  };
}

function fieldTag(
  name: string,
  fieldType: FieldType = CURRENCY,
  rowId: string | null = null
): string {
  return formatTag({
    version: 2,
    kind: 'field',
    name,
    fieldType,
    isEditable: true,
    isDeletable: true,
    isGlobal: false,
    options: rowId ? { row: rowId } : {}
  });
}

function formulaTag(
  name: string,
  expression: string,
  rowId: string | null = null
): string {
  return formatTag({
    version: 2,
    kind: 'formula',
    name,
    fieldType: CURRENCY,
    expression,
    isEditable: false,
    isDeletable: false,
    isGlobal: false,
    options: rowId ? { row: rowId } : {}
  });
}

function row(cells: Array<string | SfdtInline>, isHeader = false): SfdtRow {
  return {
    cells: cells.map((content) => ({
      blocks: [
        {
          inlines:
            typeof content === 'string'
              ? content === ''
                ? []
                : [{ text: content }]
              : [content]
        }
      ]
    })),
    rowFormat: { isHeader }
  } as SfdtRow;
}

function tableCc(tableId: string, tableBlock: any) {
  return {
    contentControlProperties: {
      lockContentControl: true,
      lockContents: false,
      tag: formatTag({ version: 2, kind: 'table', tableId }),
      title: tableId,
      type: 'RichText',
      hasPlaceHolderText: false,
      multiline: false,
      isTemporary: false,
      color: '#00000000',
      appearance: 'BoundingBox'
    },
    blocks: [tableBlock]
  };
}

/**
 * The flagship scenario. Doc fields alpha/beta are the source values; the
 * summary table mirrors both into column B and totals the column by RANGE:
 *
 *   row 1  Item  | Amount                    (header)
 *   row 2  Alpha | [[amount|expr=alpha|row=m-1]]
 *   row 3  Beta  | [[amount|expr=sum(beta)|row=m-2]]   (call spelling)
 *   row 4  Total | [[summary_total|expr=sum(B2:end)]]  (self-excluding)
 */
function buildMirrorFixture(): SfdtDocument {
  const summaryTable = {
    rows: [
      row(['Item', 'Amount'], true),
      row(['Alpha', cc(formulaTag('amount', 'alpha', 'm-1'), 'Amount', true, '…')]),
      row(['Beta', cc(formulaTag('amount', 'sum(beta)', 'm-2'), 'Amount', true, '…')]),
      row(['Total', cc(formulaTag('summary_total', 'sum(B2:end)'), 'Total', true, '…')])
    ]
  };
  return {
    optimizeSfdt: false,
    sections: [
      {
        blocks: [
          {
            inlines: [
              { text: 'Alpha: ' },
              cc(fieldTag('alpha'), 'Alpha', false, '$1,800.00'),
              { text: '  Beta: ' },
              cc(fieldTag('beta'), 'Beta', false, '$6,000.00')
            ]
          },
          tableCc('summary', summaryTable)
        ]
      }
    ]
  } as unknown as SfdtDocument;
}

/** A row the way Syncfusion creates it: plain runs, no controls. */
function nativeRow(label: string, amount: string): SfdtRow {
  return row([label, amount]);
}

/** Splice a native row in between the beta mirror and the totals row. */
function withNativeRow(label: string, amount: string): SfdtDocument {
  const doc = buildMirrorFixture();
  const tablePath = scanBindings(doc).tables.get('summary')!.tablePath!;
  getAt(doc, tablePath).rows.splice(3, 0, nativeRow(label, amount));
  return doc;
}

function occ(
  index: BindingIndex,
  pick: (occurrence: Occurrence) => boolean
): Occurrence {
  const found = index.occurrences.find(pick);
  if (!found) throw new Error('occurrence not found');
  return found;
}

const amountText = (index: BindingIndex, rowId: string) =>
  index.tables.get('summary')!.rows.find((entry) => entry.rowId === rowId)!
    .bindings.get('amount')!.text;
const totalText = (index: BindingIndex) =>
  index.formulas.get('summary_total')![0].text;

describe('mirrors + positional range totals', () => {
  it('evaluates mirrors from document fields and range-sums the column', () => {
    const result = applyRules(buildMirrorFixture(), {});
    expect(hasBlockingErrors(result.diagnostics)).toBe(false);
    expect(amountText(result.index, 'm-1')).toBe('$1,800.00');
    expect(amountText(result.index, 'm-2')).toBe('$6,000.00');
    // sum(B2:end) covers the totals cell itself; self-exclusion drops it.
    expect(totalText(result.index)).toBe('$7,800.00');
  });

  it('recomputes the mirror and the total when the source field changes', () => {
    const base = applyRules(buildMirrorFixture(), {});
    const alpha = occ(base.index, (entry) => entry.name === 'alpha');
    const edited = setOccurrenceText(base.sfdt, alpha, '$2,000.00');

    const result = applyRules(edited, { prevValues: base.values });
    expect(hasBlockingErrors(result.diagnostics)).toBe(false);
    expect(amountText(result.index, 'm-1')).toBe('$2,000.00');
    expect(totalText(result.index)).toBe('$8,000.00');
  });

  it('a typed row stays unbound and joins the range total', () => {
    const result = applyRules(withNativeRow('New item', '1000'), {});
    expect(hasBlockingErrors(result.diagnostics)).toBe(false);
    // Mirror-only table: never adopted, the typed row carries no bindings.
    expect(result.index.tables.get('summary')!.rows).toHaveLength(2);
    expect(result.changed.some((entry) => entry.type === 'row-adopted')).toBe(
      false
    );
    expect(totalText(result.index)).toBe('$8,800.00');
  });

  it('an empty inserted row stays unbound and the total is unchanged', () => {
    const result = applyRules(withNativeRow('', ''), {});
    expect(hasBlockingErrors(result.diagnostics)).toBe(false);
    expect(result.index.tables.get('summary')!.rows).toHaveLength(2);
    expect(totalText(result.index)).toBe('$7,800.00');
  });

  it('leaves an unflagged header row alone', () => {
    const doc = buildMirrorFixture();
    const tablePath = scanBindings(doc).tables.get('summary')!.tablePath!;
    getAt(doc, tablePath).rows[0].rowFormat = { isHeader: false };
    const result = applyRules(doc, {});
    expect(hasBlockingErrors(result.diagnostics)).toBe(false);
    expect(result.index.tables.get('summary')!.rows).toHaveLength(2);
    expect(totalText(result.index)).toBe('$7,800.00');
  });

  it('never adopts a totals row that lost its content control', () => {
    const doc = buildMirrorFixture();
    const tablePath = scanBindings(doc).tables.get('summary')!.tablePath!;
    // Damage: the Total cell's control is gone, its cached value is plain text.
    getAt(doc, tablePath).rows[3] = nativeRow('Total', '$7,800.00');
    const result = applyRules(doc, {});
    expect(hasBlockingErrors(result.diagnostics)).toBe(false);
    expect(result.index.tables.get('summary')!.rows).toHaveLength(2);
    expect(
      result.changed.some((entry) => entry.type === 'row-adopted')
    ).toBe(false);
  });

  it('addLineItem duplicates a mirror as a mirror, and the range counts it', () => {
    const base = applyRules(buildMirrorFixture(), {});
    const added = addLineItem(base.sfdt, 'summary', 'm-2', base.index);

    const result = applyRules(added.sfdt, { prevValues: base.values });
    expect(hasBlockingErrors(result.diagnostics)).toBe(false);
    const amount = result.index.tables
      .get('summary')!
      .rows.find((entry) => entry.rowId === added.rowId)!
      .bindings.get('amount')!;
    expect(amount.def.kind).toBe('formula');
    expect(
      amount.def.kind === 'formula' ? amount.def.expression : null
    ).toBe('sum(beta)');
    expect(amount.text).toBe('$6,000.00');
    expect(totalText(result.index)).toBe('$13,800.00');
  });

  it('resolves a qualified range from outside the table', () => {
    const doc = buildMirrorFixture() as any;
    doc.sections[0].blocks.push({
      inlines: [
        { text: 'Subtotal (rows 2-3): ' },
        cc(
          formulaTag('summary_copy', 'sum(summary!B2:B3)'),
          'Subtotal copy',
          true,
          '…'
        )
      ]
    });
    const result = applyRules(doc, {});
    expect(hasBlockingErrors(result.diagnostics)).toBe(false);
    expect(result.index.formulas.get('summary_copy')![0].text).toBe(
      '$7,800.00'
    );
  });
});

describe('mirrors inside line-item tables (adoption keeps working)', () => {
  /**
   * Q1's rate card: a real line-item table where one column mirrors a shared
   * document value. Inserted rows are adopted (the table has input fields),
   * and the mirror duplicates as a mirror - the rate propagates out of the box.
   *
   *   Item | Qty | Rate (mirror of standard_rate) | Line total mul(qty,rate)
   */
  function buildRateCard(): SfdtDocument {
    const ratesTable = {
      rows: [
        row(['Item', 'Qty', 'Rate', 'Line total'], true),
        row([
          cc(fieldTag('item', { kind: 'text' }, 'r-1'), 'Item', false, 'Design'),
          cc(fieldTag('qty', { kind: 'integer' }, 'r-1'), 'Qty', false, '2'),
          cc(formulaTag('rate', 'standard_rate', 'r-1'), 'Rate', true, '…'),
          cc(formulaTag('line_total', 'mul(qty,rate)', 'r-1'), 'Line total', true, '…')
        ])
      ]
    };
    return {
      optimizeSfdt: false,
      sections: [
        {
          blocks: [
            {
              inlines: [
                { text: 'Standard rate: ' },
                cc(fieldTag('standard_rate'), 'Standard rate', false, '$150.00')
              ]
            },
            tableCc('rates', ratesTable)
          ]
        }
      ]
    } as unknown as SfdtDocument;
  }

  it('an inserted row is adopted and the mirrored rate propagates', () => {
    const doc = buildRateCard();
    const tablePath = scanBindings(doc).tables.get('rates')!.tablePath!;
    getAt(doc, tablePath).rows.push(row(['Dev', '3', '', '']));

    const result = applyRules(doc, {});
    expect(hasBlockingErrors(result.diagnostics)).toBe(false);
    const rows = result.index.tables.get('rates')!.rows;
    expect(rows).toHaveLength(2);
    const adopted = rows.find((entry) => entry.rowId !== 'r-1')!;
    const rate = adopted.bindings.get('rate')!;
    expect(rate.def.kind).toBe('formula');
    expect(rate.text).toBe('$150.00');
    expect(adopted.bindings.get('line_total')!.text).toBe('$450.00');
  });

  it('editing the shared rate updates every row', () => {
    const base = applyRules(buildRateCard(), {});
    const rate = occ(base.index, (entry) => entry.name === 'standard_rate');
    const edited = setOccurrenceText(base.sfdt, rate, '$200.00');

    const result = applyRules(edited, { prevValues: base.values });
    expect(hasBlockingErrors(result.diagnostics)).toBe(false);
    const first = result.index.tables.get('rates')!.rows[0];
    expect(first.bindings.get('rate')!.text).toBe('$200.00');
    expect(first.bindings.get('line_total')!.text).toBe('$400.00');
  });
});
