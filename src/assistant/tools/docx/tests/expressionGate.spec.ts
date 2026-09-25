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

  it.each([
    'sum(costs.line_total)', // aggregated column
    'project.name', // dotted DOC FIELD name is a legitimate mirror
    'tax_rate', // bare doc field mirror
    'sum(B2:end)', // aggregated range
    'B3', // single cell yields a value
    'mul(quantity,unit_cost)' // ordinary row formula
  ])('allows %s', (expression) => {
    expect(() => assertExpressionYieldsValue(expression, index)).not.toThrow();
  });

  it('stays silent on parse failures (the caller surfaces those)', () => {
    expect(() => assertExpressionYieldsValue('not a formula ;;', index)).not.toThrow();
  });
});
