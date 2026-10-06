// create_binding used to gate expressions on syntax alone, so a whole-column
// reference like "costs.line_total" was accepted and then failed every
// reconcile with "formula produced a column". The gate now also rejects
// expressions that can never yield a value (PR #1876 review finding).
import { assertExpressionYieldsValue } from '../syncfusionDocumentOps';
import { scanBindings } from '../../../../elements/components/DocxEditor/bindings/core/sfdtAdapter';
import { buildCostsFixture } from '../../../../elements/components/DocxEditor/bindings/core/tests/fixtures/costsFixture';

describe('assertExpressionYieldsValue', () => {
  const index = scanBindings(buildCostsFixture());

  it('rejects a bare table.column reference with a clear op error', () => {
    expect(() => assertExpressionYieldsValue('costs.line_total', index)).toThrow(
      /whole table column/
    );
  });

  it('rejects a bare range', () => {
    expect(() => assertExpressionYieldsValue('B2:end', index)).toThrow(
      /whole range/
    );
  });

  it('rejects a whole column used as a mul/sub argument (not just at the top)', () => {
    expect(() =>
      assertExpressionYieldsValue('mul(costs.line_total,2)', index)
    ).toThrow(/whole table column/);
    expect(() =>
      assertExpressionYieldsValue('sub(subtotal,B2:end)', index)
    ).toThrow(/whole range/);
    // A column misused deeper in, under an allowed sum.
    expect(() =>
      assertExpressionYieldsValue('sum(mul(costs.line_total,2))', index)
    ).toThrow(/whole table column/);
  });

  it.each([
    'sum(costs.line_total)', // aggregated column
    'project.name', // dotted DOC FIELD name is a legitimate mirror
    'tax_rate', // bare doc field mirror
    'sum(B2:end)', // aggregated range
    'B3', // single cell yields a value
    'mul(quantity,unit_cost)', // ordinary row formula
    'sum(costs.line_total,B3,tax_rate)' // sum may mix a column, a cell, a field
  ])('allows %s', (expression) => {
    expect(() => assertExpressionYieldsValue(expression, index)).not.toThrow();
  });

  it('stays silent on parse failures (the caller surfaces those)', () => {
    expect(() => assertExpressionYieldsValue('not a formula ;;', index)).not.toThrow();
  });

  it('rejects unqualified cells and ranges for a body formula', () => {
    const bodyFormula = index.formulas.get('combined_total')![0];
    expect(() =>
      assertExpressionYieldsValue('sum(B2:end)', index, bodyFormula)
    ).toThrow(/outside a table/);
    expect(() => assertExpressionYieldsValue('B3', index, bodyFormula)).toThrow(
      /outside a table/
    );
  });

  it('allows qualified ranges outside tables and local ranges inside tables', () => {
    const bodyFormula = index.formulas.get('combined_total')![0];
    const tableFormula = index.formulas.get('grand_total')![0];
    expect(() =>
      assertExpressionYieldsValue('sum(costs!B2:end)', index, bodyFormula)
    ).not.toThrow();
    expect(() =>
      assertExpressionYieldsValue('sum(B2:end)', index, tableFormula)
    ).not.toThrow();
  });

  it('keeps an existing cell-shaped binding name valid outside tables', () => {
    const bodyFormula = index.formulas.get('combined_total')![0];
    const withNamedField = {
      ...index,
      fields: new Map(index.fields).set('B3', index.fields.get('tax_rate')!)
    };
    expect(() =>
      assertExpressionYieldsValue('sum(B3)', withNamedField, bodyFormula)
    ).not.toThrow();
  });
});
