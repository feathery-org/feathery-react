// Mirror rows inside an aggregated column: a formula cell that carries the
// column's name but references only values OUTSIDE its own row (a document
// field, another table) - e.g. [[amount|expr=alpha|row=m-1]]. Mirrors
// evaluate and aggregate like any other row, but they must never fill down:
// a row the user inserts next to them becomes a plain editable field of the
// same name and type, so typed line items and mirrored values interleave in
// one summed column.
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

function fieldTag(name: string): string {
  return formatTag({
    version: 2,
    kind: 'field',
    name,
    fieldType: CURRENCY,
    isEditable: true,
    isDeletable: true,
    isGlobal: false,
    options: {}
  });
}

function mirrorTag(expression: string, rowId: string): string {
  return formatTag({
    version: 2,
    kind: 'formula',
    name: 'amount',
    fieldType: CURRENCY,
    expression,
    isEditable: false,
    isDeletable: false,
    isGlobal: false,
    options: { row: rowId }
  });
}

function row(label: string, valueInline: SfdtInline): SfdtRow {
  return {
    cells: [
      { blocks: [{ inlines: [{ text: label }] }] },
      { blocks: [{ inlines: [valueInline] }] }
    ],
    rowFormat: { isHeader: false }
  };
}

/**
 * The user's scenario. A source table defines document fields alpha and beta;
 * the summary table mirrors both into its "amount" column and totals it:
 *
 *   Alpha | [[amount|expr=alpha|row=m-1]]
 *   Beta  | [[amount|expr=sum(beta)|row=m-2]]
 *   Total | [[summary_total|expr=sum(summary.amount)]]
 */
function buildMirrorFixture(): SfdtDocument {
  const sourceTable = {
    rows: [
      row('Alpha', cc(fieldTag('alpha'), 'Alpha', false, '$1,800.00')),
      row('Beta', cc(fieldTag('beta'), 'Beta', false, '$6,000.00'))
    ]
  };
  const summaryTable = {
    rows: [
      {
        cells: [
          { blocks: [{ inlines: [{ text: 'Item' }] }] },
          { blocks: [{ inlines: [{ text: 'Amount' }] }] }
        ],
        rowFormat: { isHeader: true }
      },
      // One bare-ref mirror and one call-form mirror: both spellings must work.
      row('Alpha', cc(mirrorTag('alpha', 'm-1'), 'Amount', true, '…')),
      row('Beta', cc(mirrorTag('sum(beta)', 'm-2'), 'Amount', true, '…')),
      row(
        'Total',
        cc(
          formatTag({
            version: 2,
            kind: 'formula',
            name: 'summary_total',
            fieldType: CURRENCY,
            expression: 'sum(summary.amount)',
            isEditable: false,
            isDeletable: false,
            isGlobal: false,
            options: {}
          }),
          'Summary total',
          true,
          '…'
        )
      )
    ]
  };
  return {
    optimizeSfdt: false,
    sections: [
      {
        blocks: [
          sourceTable,
          {
            contentControlProperties: {
              lockContentControl: true,
              lockContents: false,
              tag: formatTag({ version: 2, kind: 'table', tableId: 'summary' }),
              title: 'Summary table',
              type: 'RichText',
              hasPlaceHolderText: false,
              multiline: false,
              isTemporary: false,
              color: '#00000000',
              appearance: 'BoundingBox'
            },
            blocks: [summaryTable]
          }
        ]
      }
    ]
  } as unknown as SfdtDocument;
}

/** A row the way Syncfusion creates it: same cell shape, plain runs, no controls. */
function nativeRow(label: string, amount: string): SfdtRow {
  return {
    cells: [
      { blocks: [{ inlines: label === '' ? [] : [{ text: label }] }] },
      { blocks: [{ inlines: amount === '' ? [] : [{ text: amount }] }] }
    ],
    rowFormat: { isHeader: false }
  };
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

describe('mirror rows in an aggregated column', () => {
  it('evaluates mirrors from document fields and sums them', () => {
    const result = applyRules(buildMirrorFixture(), {});
    expect(hasBlockingErrors(result.diagnostics)).toBe(false);
    expect(amountText(result.index, 'm-1')).toBe('$1,800.00');
    expect(amountText(result.index, 'm-2')).toBe('$6,000.00');
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

  it('adopts a typed row between the mirrors and the total as a plain field', () => {
    const result = applyRules(withNativeRow('New item', '1000'), {});
    expect(hasBlockingErrors(result.diagnostics)).toBe(false);
    const rows = result.index.tables.get('summary')!.rows;
    expect(rows).toHaveLength(3);

    const adopted = rows.find(
      (entry) => entry.rowId !== 'm-1' && entry.rowId !== 'm-2'
    )!;
    const amount = adopted.bindings.get('amount')!;
    // A field, not another copy of the mirror - editable and unlockable.
    expect(amount.def.kind).toBe('field');
    expect(amount.lockContents).toBe(false);
    expect(amount.text).toBe('$1,000.00');
    // Mirrors untouched, total includes all three rows.
    expect(amountText(result.index, 'm-1')).toBe('$1,800.00');
    expect(amountText(result.index, 'm-2')).toBe('$6,000.00');
    expect(totalText(result.index)).toBe('$8,800.00');
  });

  it('adopts an empty inserted row with the default, not a duplicate mirror', () => {
    const result = applyRules(withNativeRow('', ''), {});
    expect(hasBlockingErrors(result.diagnostics)).toBe(false);
    const adopted = result.index.tables
      .get('summary')!
      .rows.find((entry) => entry.rowId !== 'm-1' && entry.rowId !== 'm-2')!;
    expect(adopted.bindings.get('amount')!.def.kind).toBe('field');
    expect(adopted.bindings.get('amount')!.text).toBe('$0.00');
    expect(totalText(result.index)).toBe('$7,800.00');
  });

  it('addLineItem clones a mirror row into a field row, not a second mirror', () => {
    const base = applyRules(buildMirrorFixture(), {});
    const added = addLineItem(base.sfdt, 'summary', 'm-2', base.index);

    const result = applyRules(added.sfdt, { prevValues: base.values });
    expect(hasBlockingErrors(result.diagnostics)).toBe(false);
    const amount = result.index.tables
      .get('summary')!
      .rows.find((entry) => entry.rowId === added.rowId)!
      .bindings.get('amount')!;
    expect(amount.def.kind).toBe('field');
    expect(amount.text).toBe('$0.00');
    expect(totalText(result.index)).toBe('$7,800.00');
  });

});
