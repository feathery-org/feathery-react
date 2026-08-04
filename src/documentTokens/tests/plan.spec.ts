
import {
  affected,
  buildPlan,
  recalc,
  TokenSpec,
  validationErrors
} from '../plan';

/** The invoice from the prototype: two line items, subtotal, tax, total. */
const invoice = (): TokenSpec[] => [
  { id: 'qty_1', source: 'qty' },
  { id: 'unit_cost_1', source: 'unit_cost' },
  { id: 'qty_2', source: 'qty' },
  { id: 'unit_cost_2', source: 'unit_cost' },
  { id: 'tax_percent_1', source: 'tax_percent' },
  { id: 'item_total_1', formula: 'qty_1 * unit_cost_1' },
  { id: 'item_total_2', formula: 'qty_2 * unit_cost_2' },
  { id: 'subtotal_1', formula: 'SUM(item_total_*)' },
  { id: 'tax_amount_1', formula: 'ROUND(subtotal_1 * tax_percent_1 / 100, 2)' },
  { id: 'total_1', formula: 'subtotal_1 + tax_amount_1' }
];

const inputs = (): Map<string, number> =>
  new Map([
    ['qty_1', 10],
    ['unit_cost_1', 150],
    ['qty_2', 2],
    ['unit_cost_2', 400],
    ['tax_percent_1', 8.25]
  ]);

describe('buildPlan', () => {
  it('orders every dependency before its dependents', () => {
    const { order } = buildPlan(invoice());
    const at = (id: string) => order.indexOf(id);

    expect(at('item_total_1')).toBeLessThan(at('subtotal_1'));
    expect(at('item_total_2')).toBeLessThan(at('subtotal_1'));
    expect(at('subtotal_1')).toBeLessThan(at('tax_amount_1'));
    expect(at('tax_amount_1')).toBeLessThan(at('total_1'));
  });

  it('treats a wildcard as an edge from every matching token', () => {
    const { dependents } = buildPlan(invoice());
    expect(dependents.get('item_total_1')).toContain('subtotal_1');
    expect(dependents.get('item_total_2')).toContain('subtotal_1');
  });

  it('only plans computed tokens', () => {
    const { order } = buildPlan(invoice());
    expect(order).not.toContain('qty_1');
    expect(order).toHaveLength(5);
  });
});

describe('recalc', () => {
  it('computes the whole document on open', () => {
    const plan = buildPlan(invoice());
    const values = inputs();
    recalc(plan, values);

    expect(values.get('item_total_1')).toBe(1500);
    expect(values.get('item_total_2')).toBe(800);
    expect(values.get('subtotal_1')).toBe(2300);
    expect(values.get('tax_amount_1')).toBe(189.75);
    expect(values.get('total_1')).toBe(2489.75);
  });

  it('propagates a single input change through the whole chain', () => {
    const plan = buildPlan(invoice());
    const values = inputs();
    recalc(plan, values);

    values.set('qty_1', 20);
    const { changed } = recalc(plan, values, 'qty_1');

    expect(changed.get('item_total_1')).toBe(3000);
    expect(changed.get('subtotal_1')).toBe(3800);
    expect(changed.get('total_1')).toBe(4113.5);
    // The untouched line item is not re-reported.
    expect(changed.has('item_total_2')).toBe(false);
  });

  it('reports only tokens whose value actually moved', () => {
    const plan = buildPlan(invoice());
    const values = inputs();
    recalc(plan, values);

    values.set('qty_1', 10); // same value as before
    const { changed } = recalc(plan, values, 'qty_1');
    expect(changed.size).toBe(0);
  });

  it('picks up a new line item through the wildcard with no formula edit', () => {
    const specs = [
      ...invoice(),
      { id: 'qty_3', source: 'qty' },
      { id: 'unit_cost_3', source: 'unit_cost' },
      { id: 'item_total_3', formula: 'qty_3 * unit_cost_3' }
    ];
    const plan = buildPlan(specs);
    const values = inputs();
    values.set('qty_3', 1);
    values.set('unit_cost_3', 50);
    recalc(plan, values);

    expect(values.get('subtotal_1')).toBe(2350);
  });
});

describe('affected', () => {
  it('returns descendants in evaluation order', () => {
    const plan = buildPlan(invoice());
    expect(affected(plan, 'qty_1')).toEqual([
      'item_total_1',
      'subtotal_1',
      'tax_amount_1',
      'total_1'
    ]);
  });

  it('returns nothing for a token nobody depends on', () => {
    const plan = buildPlan(invoice());
    expect(affected(plan, 'total_1')).toEqual([]);
  });
});

describe('failure containment', () => {
  it('attributes a cycle without hanging, and resolves everything else', () => {
    const plan = buildPlan([
      { id: 'a', formula: 'b + 1' },
      { id: 'b', formula: 'a + 1' },
      { id: 'x', source: 'x' },
      { id: 'y', formula: 'x * 2' }
    ]);

    expect([...plan.errors.keys()]).toContain('a');
    expect(plan.order).toContain('y');

    const values = new Map([['x', 21]]);
    recalc(plan, values);
    expect(values.get('y')).toBe(42);
  });

  it('attributes a bad formula to its own token only', () => {
    const plan = buildPlan([
      { id: 'broken', formula: 'this is not (valid' },
      { id: 'x', source: 'x' },
      { id: 'fine', formula: 'x + 1' }
    ]);

    expect(plan.errors.has('broken')).toBe(true);
    expect(plan.errors.has('fine')).toBe(false);

    const values = new Map([['x', 1]]);
    recalc(plan, values);
    expect(values.get('fine')).toBe(2);
  });

  it('marks tokens that depend on a broken token', () => {
    const plan = buildPlan([
      { id: 'broken', formula: '(((' },
      { id: 'downstream', formula: 'broken + 1' }
    ]);

    expect(plan.errors.has('downstream')).toBe(true);
    expect(plan.order).not.toContain('downstream');
  });

  it('reports an unknown reference rather than silently using zero', () => {
    const plan = buildPlan([{ id: 'a', formula: 'ghost + 1' }]);
    const { errors } = recalc(plan, new Map());
    expect(errors.get('a')).toMatch(/unknown/i);
  });
});

describe('validationErrors', () => {
  const specs: TokenSpec[] = [
    { id: 'qty_1', validate: { min: 1, max: 999 } },
    { id: 'name_1', validate: { required: true } }
  ];

  it('flags a value below min', () => {
    const plan = buildPlan(specs);
    const failures = validationErrors(
      plan,
      new Map([
        ['qty_1', 0],
        ['name_1', 1]
      ])
    );
    expect(failures.get('qty_1')).toMatch(/at least 1/);
  });

  it('flags a value above max', () => {
    const plan = buildPlan(specs);
    const failures = validationErrors(
      plan,
      new Map([
        ['qty_1', 1000],
        ['name_1', 1]
      ])
    );
    expect(failures.get('qty_1')).toMatch(/at most 999/);
  });

  it('flags a missing required value', () => {
    const plan = buildPlan(specs);
    const failures = validationErrors(plan, new Map([['qty_1', 5]]));
    expect(failures.get('name_1')).toBe('required');
  });

  it('passes a valid document', () => {
    const plan = buildPlan(specs);
    const failures = validationErrors(
      plan,
      new Map([
        ['qty_1', 5],
        ['name_1', 1]
      ])
    );
    expect(failures.size).toBe(0);
  });
});
