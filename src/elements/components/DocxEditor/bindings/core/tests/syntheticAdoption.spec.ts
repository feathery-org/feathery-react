// A table with no bound row adopts inserted rows when a formula consumes its
// columns positionally (sum(B2:end)): the consumed column mints a fresh
// row-scoped input field. Name-based sums never trigger it.
import { applyRules } from '../engine';
import { getAt } from '../sfdtAdapter';
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
const formulaTag = (name: string, expression: string): string =>
  formatTag({
    version: 2,
    kind: 'formula',
    name,
    fieldType: CURRENCY,
    expression,
    isEditable: false,
    isDeletable: false,
    isGlobal: false,
    options: {}
  });
const fieldTag = (name: string): string =>
  formatTag({
    version: 2,
    kind: 'field',
    name,
    fieldType: CURRENCY,
    isEditable: true,
    isDeletable: true,
    isGlobal: false,
    options: {}
  });

function doc(blocks: any[]): SfdtDocument {
  return {
    optimizeSfdt: false,
    sections: [{ blocks }]
  } as unknown as SfdtDocument;
}

const positionalTable = (extraRows: SfdtRow[]) =>
  tableCc('summary', {
    rows: [
      row(['Item', 'Amount'], true),
      ...extraRows,
      row(['Total', cc(formulaTag('total', 'sum(B2:end)'), 'Total', true, '…')])
    ]
  });

describe('synthetic column template from positional consumption', () => {
  it('adopts a typed row: fresh field control, value kept, total updates', () => {
    const result = applyRules(
      doc([positionalTable([row(['Widget', '$50.00'])])]),
      {}
    );
    expect(
      result.diagnostics.filter((d) => d.code === 'row-not-adopted')
    ).toEqual([]);
    const adoptedRow = result.index.tables.get('summary')!.rows[0];
    const binding = adoptedRow.bindings.get('colB')!;
    expect(binding.def.kind).toBe('field');
    expect(binding.text).toBe('$50.00');
    expect((result.index.formulas.get('total') as any[])[0].text).toBe(
      '$50.00'
    );
  });

  it('adopts an empty inserted row with the type default', () => {
    const result = applyRules(doc([positionalTable([row(['', ''])])]), {});
    const adoptedRow = result.index.tables.get('summary')!.rows[0];
    expect(adoptedRow.bindings.get('colB')!.text).toBe('$0.00');
    expect((result.index.formulas.get('total') as any[])[0].text).toBe('$0.00');
  });

  it('avoids a doc-level name collision when synthesizing', () => {
    const result = applyRules(
      doc([
        {
          inlines: [cc(fieldTag('colB'), 'colB', false, '$1.00')]
        },
        positionalTable([row(['Widget', '$50.00'])])
      ]),
      {}
    );
    const adoptedRow = result.index.tables.get('summary')!.rows[0];
    expect(adoptedRow.bindings.has('colB_')).toBe(true);
    expect(adoptedRow.bindings.has('colB')).toBe(false);
  });

  it('a name-based sum alone still refuses to adopt (unchanged behavior)', () => {
    const nameSumTable = tableCc('summary', {
      rows: [
        row(['Item', 'Amount'], true),
        row(['Widget', '$50.00']),
        row(['Total', cc(formulaTag('total', 'sum(X,Y)'), 'Total', true, '…')])
      ]
    });
    const result = applyRules(
      doc([
        { inlines: [cc(fieldTag('X'), 'X', false, '$1.00')] },
        { inlines: [cc(fieldTag('Y'), 'Y', false, '$2.00')] },
        nameSumTable
      ]),
      {}
    );
    expect(result.diagnostics.some((d) => d.code === 'row-not-adopted')).toBe(
      true
    );
  });

  it('skips label rows whose consumed cell does not parse, like the sum does', () => {
    const result = applyRules(
      doc([
        positionalTable([
          row(['Widget', '$50.00']),
          row(['Shipping', 'included']),
          row(['Tax', 'N/A'])
        ])
      ]),
      {}
    );
    // Labels stay plain text: a warning each, never a save-blocking error.
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual(
      []
    );
    expect(
      result.diagnostics.filter((d) => d.code === 'row-not-adopted')
    ).toHaveLength(2);
    const table = result.index.tables.get('summary')!;
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].bindings.get('colB')!.text).toBe('$50.00');
    expect((result.index.formulas.get('total') as any[])[0].text).toBe(
      '$50.00'
    );
  });

  it('keeps skipping label rows once a bound row exists as the template', () => {
    const first = applyRules(
      doc([
        positionalTable([
          row(['Widget', '$50.00']),
          row(['Shipping', 'included'])
        ])
      ]),
      {}
    );
    // Second pass: the adopted Widget row is now the normal template.
    const second = applyRules(first.sfdt, {});
    expect(second.diagnostics.filter((d) => d.severity === 'error')).toEqual(
      []
    );
    expect(second.index.tables.get('summary')!.rows).toHaveLength(1);
  });

  it('an explicit table-qualified range from outside the table consumes it', () => {
    const result = applyRules(
      doc([
        positionalTable([row(['Widget', '$50.00'])]),
        {
          inlines: [
            cc(formulaTag('grand', 'sum(summary!B2:end)'), 'Grand', true, '…')
          ]
        }
      ]),
      {}
    );
    const adoptedRow = result.index.tables.get('summary')!.rows[0];
    expect(adoptedRow.bindings.has('colB')).toBe(true);
  });
});

it.each([true, false])(
  'excludes deleted rows without changing physical positions or revision markers (adoptRows: %s)',
  (adoptRows) => {
    const deleted = row(['Deleted', '$50.00']);
    deleted.rowFormat = {
      ...deleted.rowFormat,
      revisionIds: ['inserted-row', 'deleted-row']
    };
    const sfdt = doc([
      positionalTable([
        row(['Kept', '$10.00']),
        deleted,
        row(['After', '$20.00'])
      ]),
      { inlines: [cc(formulaTag('after', 'summary!B4'), 'After', true, '…')] }
    ]);
    sfdt.revisions = [
      { revisionId: 'deleted-row', revisionType: 'Deletion' },
      { revisionId: 'inserted-row', revisionType: 'Insertion' }
    ];
    const result = applyRules(sfdt, {}, { adoptRows });
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual(
      []
    );
    expect(result.index.formulas.get('total')?.[0].text).toBe('$30.00');
    expect(result.index.formulas.get('after')?.[0].text).toBe('$20.00');
    const table = result.index.tables.get('summary')!;
    expect(getAt(result.sfdt, [...table.tablePath!, 'rows', 2])).toEqual(
      deleted
    );
    // A second pass uses the newly bound template; it must still skip deletion.
    const again = applyRules(result.sfdt, {}, { adoptRows });
    expect(again.index.formulas.get('total')?.[0].text).toBe('$30.00');
    expect(getAt(again.sfdt, [...table.tablePath!, 'rows', 2])).toEqual(
      deleted
    );
  }
);

it('preserves existing references to a field named end', () => {
  const result = applyRules(
    doc([
      { inlines: [cc(fieldTag('end'), 'end', false, '$10.00')] },
      { inlines: [cc(formulaTag('total', 'sum(end)'), 'Total', true, '…')] }
    ]),
    {}
  );
  expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  expect((result.index.formulas.get('total') as any[])[0].text).toBe('$10.00');
});
