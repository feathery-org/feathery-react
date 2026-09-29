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

describe('cell-shaped binding names are not stolen by cell parsing', () => {
  it('sum(Q1,Q2) sums the fields named Q1/Q2, not cells', () => {
    const doc = {
      optimizeSfdt: false,
      sections: [
        {
          blocks: [
            {
              inlines: [
                { text: 'Q1 ' },
                cc(fieldTag('Q1'), 'Q1', false, '$100.00'),
                { text: ' Q2 ' },
                cc(fieldTag('Q2'), 'Q2', false, '$200.00'),
                { text: ' Total ' },
                cc(formulaTag('grand', 'sum(Q1,Q2)'), 'Total', true, '…')
              ]
            }
          ]
        }
      ]
    } as unknown as SfdtDocument;
    const result = applyRules(doc, {});
    expect(hasBlockingErrors(result.diagnostics)).toBe(false);
    expect(result.index.formulas.get('grand')![0].text).toBe('$300.00');
  });
});

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

  it('skips a non-numeric bound field inside a summed range (counts as 0)', () => {
    const doc = buildMirrorFixture();
    const tablePath = scanBindings(doc).tables.get('summary')!.tablePath!;
    // A text-typed bound cell in column B must not poison sum(B2:end).
    getAt(doc, tablePath).rows.splice(3, 0, {
      cells: [
        { blocks: [{ inlines: [{ text: 'Note' }] }] },
        {
          blocks: [
            {
              inlines: [
                cc(
                  fieldTag('note', { kind: 'text' }, 't-1'),
                  'Note',
                  false,
                  'see appendix'
                )
              ]
            }
          ]
        }
      ],
      rowFormat: { isHeader: false }
    });
    const result = applyRules(doc, {});
    expect(hasBlockingErrors(result.diagnostics)).toBe(false);
    expect(totalText(result.index)).toBe('$7,800.00'); // text row contributes 0
  });

  it('adopts a typed row into an editable field and range-sums it', () => {
    const result = applyRules(withNativeRow('New item', '1000'), {});
    expect(hasBlockingErrors(result.diagnostics)).toBe(false);
    const rows = result.index.tables.get('summary')!.rows;
    expect(rows).toHaveLength(3);
    const adopted = rows.find(
      (entry) => entry.rowId !== 'm-1' && entry.rowId !== 'm-2'
    )!;
    const amount = adopted.bindings.get('amount')!;
    // A field, not a mirror: the typed value is the user's, an editable control.
    expect(amount.def.kind).toBe('field');
    expect(amount.lockContents).toBe(false);
    expect(amount.text).toBe('$1,000.00');
    expect(totalText(result.index)).toBe('$8,800.00');
  });

  it('gives an empty inserted row its field control immediately (row=auto style)', () => {
    const result = applyRules(withNativeRow('', ''), {});
    expect(hasBlockingErrors(result.diagnostics)).toBe(false);
    // Mirror-only table: the new row's amount cell is an editable field with the
    // default right away - not a duplicate mirror, not plain text - so the
    // control is there the moment the row is inserted.
    const rows = result.index.tables.get('summary')!.rows;
    expect(rows).toHaveLength(3);
    const adopted = rows.find(
      (entry) => entry.rowId !== 'm-1' && entry.rowId !== 'm-2'
    )!;
    const amount = adopted.bindings.get('amount')!;
    expect(amount.def.kind).toBe('field');
    expect(amount.text).toBe('$0.00');
    expect(totalText(result.index)).toBe('$7,800.00');
  });

  it('leaves an unflagged header row alone (text does not parse as currency)', () => {
    const doc = buildMirrorFixture();
    const tablePath = scanBindings(doc).tables.get('summary')!.tablePath!;
    getAt(doc, tablePath).rows[0].rowFormat = { isHeader: false };
    const result = applyRules(doc, {});
    expect(hasBlockingErrors(result.diagnostics)).toBe(false);
    expect(result.index.tables.get('summary')!.rows).toHaveLength(2);
    expect(totalText(result.index)).toBe('$7,800.00');
  });

  it('re-adopts a row whose control was copied by native insert (duplicate id)', () => {
    // Syncfusion's insert-row copies an editable control into the new row, so it
    // arrives carrying a field control with the SAME row id as the row above.
    // Left alone the two collapse to one binding (a duplicate-column ghost that
    // edits both). The copy must be re-adopted with a fresh id and reset to its
    // default - a genuine new, independently editable row.
    const doc = buildMirrorFixture();
    const tablePath = scanBindings(doc).tables.get('summary')!.tablePath!;
    // An earlier insert already produced a field row (One, $100)...
    const fieldOne = row([
      'One',
      cc(fieldTag('amount', CURRENCY, 'r-1'), 'Amount', false, '$100.00')
    ]);
    // ...and a fresh insert below it copied that control verbatim (row=r-1).
    const copied = row([
      'Two',
      cc(fieldTag('amount', CURRENCY, 'r-1'), 'Amount', false, '$100.00')
    ]);
    getAt(doc, tablePath).rows.splice(3, 0, fieldOne, copied);

    const result = applyRules(doc, {});
    expect(hasBlockingErrors(result.diagnostics)).toBe(false);
    expect(
      result.diagnostics.some((entry) => entry.code === 'duplicate-column')
    ).toBe(false);
    const rows = result.index.tables.get('summary')!.rows;
    const ids = rows.map((entry) => entry.rowId);
    expect(new Set(ids).size).toBe(ids.length); // every row id distinct
    expect(rows).toHaveLength(4); // m-1, m-2, One, and the re-adopted copy
    const copyRow = rows.find((entry) => entry.rowId !== 'r-1' && ![
      'm-1',
      'm-2'
    ].includes(entry.rowId as string))!;
    expect(copyRow.bindings.get('amount')!.def.kind).toBe('field');
    expect(copyRow.bindings.get('amount')!.text).toBe('$0.00'); // reset, not $100
    // 1800 (A) + 6000 (B) + 100 (One) + 0 (copy) - self-excluded total.
    expect(totalText(result.index)).toBe('$7,900.00');
  });

  it('an insert-above copy re-adopts the copy, not the original', () => {
    // The copy is placed BEFORE the original (insert-above): physical row 1 is
    // the copy, row 2 is the real one, both row=r-1 with $100.
    const build = () => {
      const table = {
        rows: [
          row(['Item', 'Amount'], true),
          row(['Copy', cc(fieldTag('amount', CURRENCY, 'r-1'), 'Amount', false, '$100.00')]),
          row(['Orig', cc(fieldTag('amount', CURRENCY, 'r-1'), 'Amount', false, '$100.00')])
        ]
      };
      return {
        optimizeSfdt: false,
        sections: [{ blocks: [tableCc('t', table)] }]
      } as unknown as SfdtDocument;
    };
    const amountAtPhysicalRow = (result: ReturnType<typeof applyRules>, phys: number) =>
      result.index.tables
        .get('t')!
        .rows.find((entry) => Number(entry.path![entry.path!.length - 1]) === phys)!
        .bindings.get('amount')!.text;

    // Without the hint, the LATER occurrence (the original at row 2) is reset.
    const noHint = applyRules(build(), {});
    expect(amountAtPhysicalRow(noHint, 2)).toBe('$0.00'); // the bug

    // With the hint that row 1 is the freshly inserted copy, the original keeps
    // its value and the copy is the one reset.
    const withHint = applyRules(build(), {
      insertedRow: { tableId: 't', rowIndex: 1 }
    });
    expect(amountAtPhysicalRow(withHint, 2)).toBe('$100.00'); // original kept
    expect(amountAtPhysicalRow(withHint, 1)).toBe('$0.00'); // copy reset
  });

  it('protects an intact totals row (it still has its content control)', () => {
    const result = applyRules(buildMirrorFixture(), {});
    // The Total row keeps its formula; only the two mirrors are bound rows.
    expect(result.index.tables.get('summary')!.rows).toHaveLength(2);
    expect(totalText(result.index)).toBe('$7,800.00');
  });

  it('treats a row-scoped self-table aggregate as structural, not a mirror', () => {
    // A row=auto self-total (sum(costs.amount) in a row-scoped cell) references
    // its own table's column, so it is structural: a typed row in that column
    // must block adoption, not be converted to an editable field.
    const table = {
      rows: [
        row(['Item', 'Amount'], true),
        row([
          'Seed',
          cc(formulaTag('amount', 'sum(costs.amount)', 'r-1'), 'Amount', true, '…')
        ])
      ]
    };
    const doc = {
      optimizeSfdt: false,
      sections: [{ blocks: [tableCc('costs', table)] }]
    } as unknown as SfdtDocument;
    const tablePath = scanBindings(doc).tables.get('costs')!.tablePath!;
    getAt(doc, tablePath).rows.splice(2, 0, nativeRow('New', '500'));

    const result = applyRules(doc, {});
    // Not adopted: only the seed row is bound, and a diagnostic explains why.
    expect(result.index.tables.get('costs')!.rows).toHaveLength(1);
    expect(
      result.diagnostics.some((entry) => entry.code === 'row-not-adopted')
    ).toBe(true);
  });

  it('adopts a row between mirrors when the total row is row-scoped', () => {
    // A row-scoped total (row=t-1) is a bound row and would be picked as the
    // adoption template - but it is a structural aggregate, not a data row.
    // Template selection must skip it and use a mirror row, so the inserted
    // cell in the summed column still becomes an editable field control.
    const table = {
      rows: [
        row(['Item', 'Amount'], true),
        row(['Alpha', cc(formulaTag('amount', 'alpha', 'm-1'), 'Amount', true, '…')]),
        row(['Beta', cc(formulaTag('amount', 'beta', 'm-2'), 'Amount', true, '…')]),
        row([
          'Total',
          cc(formulaTag('total', 'sum(summary.amount)', 't-1'), 'Total', true, '…')
        ])
      ]
    };
    const doc = {
      optimizeSfdt: false,
      sections: [
        {
          blocks: [
            {
              inlines: [
                { text: 'A ' },
                cc(fieldTag('alpha'), 'Alpha', false, '$1,800.00'),
                { text: ' B ' },
                cc(fieldTag('beta'), 'Beta', false, '$6,000.00')
              ]
            },
            tableCc('summary', table)
          ]
        }
      ]
    } as unknown as SfdtDocument;
    const tablePath = scanBindings(doc).tables.get('summary')!.tablePath!;
    getAt(doc, tablePath).rows.splice(2, 0, nativeRow('New', '1000')); // between mirrors

    const result = applyRules(doc, {});
    expect(hasBlockingErrors(result.diagnostics)).toBe(false);
    const adopted = result.index.tables
      .get('summary')!
      .rows.find(
        (entry) => !['m-1', 'm-2', 't-1'].includes(entry.rowId as string)
      )!;
    // An editable field control - the summed column is an input column.
    expect(adopted.bindings.get('amount')!.def.kind).toBe('field');
    expect(adopted.bindings.get('amount')!.lockContents).toBe(false);
    expect(adopted.bindings.get('amount')!.text).toBe('$1,000.00');
    // The row-scoped total sums all three inputs.
    const totalRow = result.index.tables
      .get('summary')!
      .rows.find((entry) => entry.rowId === 't-1')!;
    expect(totalRow.bindings.get('total')!.text).toBe('$8,800.00');
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

  it('classifies a row-local formula correctly when its input is wrapped', () => {
    // A value field wrapped in a foreign RichText control is invisible to a
    // flat cell scan, so a row-local self-sum reading it would look like a
    // mirror and, on an empty inserted row, get converted to an editable field.
    // Column-name collection descends into the wrapper, so it stays structural.
    const wrapped = {
      contentControlProperties: {
        lockContentControl: false,
        lockContents: false,
        tag: 'foreign',
        title: 'x',
        type: 'RichText',
        hasPlaceHolderText: false,
        multiline: false,
        isTemporary: false,
        color: '#00000000',
        appearance: 'BoundingBox'
      },
      inlines: [cc(fieldTag('value', CURRENCY, 'r-1'), 'Value', false, '$5.00')]
    } as unknown as SfdtInline;
    const table = {
      rows: [
        row(['Item', 'Value', 'Total'], true),
        {
          cells: [
            { blocks: [{ inlines: [{ text: 'Seed' }] }] },
            { blocks: [{ inlines: [wrapped] }] },
            {
              blocks: [
                { inlines: [cc(formulaTag('total', 'sum(value)', 'r-1'), 'Total', true, '…')] }
              ]
            }
          ],
          rowFormat: { isHeader: false }
        }
      ]
    };
    const doc = {
      optimizeSfdt: false,
      sections: [{ blocks: [tableCc('wrap', table)] }]
    } as unknown as SfdtDocument;
    const tablePath = scanBindings(doc).tables.get('wrap')!.tablePath!;
    getAt(doc, tablePath).rows.push(row(['New', '', '']));

    const result = applyRules(doc, {});
    const adopted = result.index.tables
      .get('wrap')!
      .rows.find((entry) => entry.rowId !== 'r-1')!;
    // Structural self-sum stays a formula, not a converted editable field.
    expect(adopted.bindings.get('total')!.def.kind).toBe('formula');
  });
});
