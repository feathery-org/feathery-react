import { deriveTableStructure } from '../tableStructure';
import { formatTag } from '../../../../elements/components/DocxEditor/bindings/core/tagDsl';

const CURRENCY = { kind: 'currency' as const, currency: 'USD', scale: 2 };
const bound = (tag: string) => ({
  contentControlProperties: { tag },
  inlines: [{ text: '' }]
});
const field = (name: string) =>
  bound(
    formatTag({
      version: 2,
      kind: 'field',
      name,
      fieldType: CURRENCY,
      isEditable: true,
      isDeletable: true,
      isGlobal: false,
      options: {}
    })
  );
const formula = (name: string, expression: string) =>
  bound(
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
    })
  );
const row = (...inlines: any[]) => ({
  cells: inlines.map((inline) => ({ blocks: [{ inlines: [inline] }] }))
});

describe('deriveTableStructure on a table of named document fields', () => {
  it('reads a formula over two other rows as a total, and a one-row rate as an item', () => {
    const tableBlock = {
      rows: [
        row({ text: 'Coverage' }, { text: 'Premium' }),
        row({ text: 'Home' }, field('home_premium')),
        row({ text: 'Auto' }, field('auto_premium')),
        row({ text: 'Tax' }, formula('tax', 'mul(home_premium,0.05)')),
        row(
          { text: 'Total' },
          formula('total', 'sum(home_premium,auto_premium)')
        )
      ]
    };
    const roles = deriveTableStructure({
      tableBlock,
      headerRows: 1,
      tableId: null
    }).rows.map((entry) => entry.role);

    expect(roles[3]).not.toBe('aggregate');
    expect(roles[4]).toBe('aggregate');
  });
});
