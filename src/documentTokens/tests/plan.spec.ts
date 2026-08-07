import { buildPlan, recalc, TokenSpec, validationErrors } from '../plan';

/** The invoice from the prototype: two line items, subtotal, tax, total. */
const invoice = (): TokenSpec[] => [
  { id: 'qty', index: 0, source: 'qty' },
  { id: 'unit_cost', index: 0, source: 'unit_cost' },
  { id: 'qty', index: 1, source: 'qty' },
  { id: 'unit_cost', index: 1, source: 'unit_cost' },
  { id: 'tax_percent', source: 'tax_percent' },
  { id: 'item_total', index: 0, formula: 'qty * unit_cost' },
  { id: 'item_total', index: 1, formula: 'qty * unit_cost' },
  { id: 'subtotal', formula: 'SUM(item_total)' },
  { id: 'tax_amount', formula: 'ROUND(subtotal * tax_percent / 100, 2)' },
  { id: 'total', formula: 'subtotal + tax_amount' }
];

const inputs = (): Map<string, number> =>
  new Map([
    ['qty__0', 10],
    ['unit_cost__0', 150],
    ['qty__1', 2],
    ['unit_cost__1', 400],
    ['tax_percent', 8.25]
  ]);

describe('buildPlan', () => {
  it('orders every dependency before its dependents', () => {
    const { order } = buildPlan(invoice());
    const at = (id: string) => order.indexOf(id);

    expect(at('item_total__0')).toBeLessThan(at('subtotal'));
    expect(at('item_total__1')).toBeLessThan(at('subtotal'));
    expect(at('subtotal')).toBeLessThan(at('tax_amount'));
    expect(at('tax_amount')).toBeLessThan(at('total'));
  });

  it('only plans computed tokens', () => {
    const { order } = buildPlan(invoice());
    expect(order).not.toContain('qty__0');
    expect(order).toHaveLength(5);
  });
});

describe('recalc', () => {
  it('computes the whole document on open', () => {
    const plan = buildPlan(invoice());
    const values = inputs();
    recalc(plan, values);

    expect(values.get('item_total__0')).toBe(1500);
    expect(values.get('item_total__1')).toBe(800);
    expect(values.get('subtotal')).toBe(2300);
    expect(values.get('tax_amount')).toBe(189.75);
    expect(values.get('total')).toBe(2489.75);
  });

  it('propagates a single input change through the whole chain', () => {
    const plan = buildPlan(invoice());
    const values = inputs();
    recalc(plan, values);

    values.set('qty__0', 20);
    const { changed } = recalc(plan, values);

    expect(changed.get('item_total__0')).toBe(3000);
    expect(changed.get('subtotal')).toBe(3800);
    expect(changed.get('total')).toBe(4113.5);
    // The untouched line item is not re-reported.
    expect(changed.has('item_total__1')).toBe(false);
  });

  it('reports only tokens whose value actually moved', () => {
    const plan = buildPlan(invoice());
    const values = inputs();
    recalc(plan, values);

    values.set('qty__0', 10); // same value as before
    const { changed } = recalc(plan, values);
    expect(changed.size).toBe(0);
  });

  it('picks up a new row in the aggregate with no formula edit', () => {
    const specs = [
      ...invoice(),
      { id: 'qty', index: 2, source: 'qty' },
      { id: 'unit_cost', index: 2, source: 'unit_cost' },
      { id: 'item_total', index: 2, formula: 'qty * unit_cost' }
    ];
    const plan = buildPlan(specs);
    const values = inputs();
    values.set('qty__2', 1);
    values.set('unit_cost__2', 50);
    recalc(plan, values);

    expect(values.get('subtotal')).toBe(2350);
  });
});

describe('a computed name that is also a field', () => {
  // The invoice's `item_total` is a per-row formula AND a real form field, so
  // `subtotal = SUM(item_total)` lists `item_total` in its `reads`. The formula
  // column must always win: seeding a phantom scalar `item_total` field input
  // would collide with the computed `item_total__0..n` column and, once the
  // field held a value, overwrite the summed array so SUM collapsed to that one
  // scalar — zeroing subtotal/tax/total the moment anything touched the field.
  const linkedInvoice = (): TokenSpec[] => [
    { id: 'qty', index: 0, source: 'qty' },
    { id: 'cost', index: 0, source: 'cost' },
    { id: 'qty', index: 1, source: 'qty' },
    { id: 'cost', index: 1, source: 'cost' },
    { id: 'item_total', index: 0, formula: 'qty * cost' },
    { id: 'item_total', index: 1, formula: 'qty * cost' },
    { id: 'subtotal', formula: 'SUM(item_total)', reads: ['item_total'] }
  ];

  const linkedInputs = (): Map<string, number> =>
    new Map([
      ['qty__0', 10],
      ['cost__0', 3.99],
      ['qty__1', 5],
      ['cost__1', 2]
    ]);

  it('seeds no phantom input for a name that is a computed column', () => {
    const plan = buildPlan(linkedInvoice());
    // The scalar phantom would live under the bare name `item_total`; only the
    // per-row computed nodes may exist.
    expect(plan.specs.has('item_total')).toBe(false);
    expect(plan.specs.has('item_total__0')).toBe(true);
  });

  it('keeps SUM reading the computed column after the field holds a value', () => {
    const plan = buildPlan(linkedInvoice());
    const values = linkedInputs();
    recalc(plan, values);
    expect(values.get('item_total__0')).toBeCloseTo(39.9);
    expect(values.get('subtotal')).toBeCloseTo(49.9);

    // The user edits a value; the `item_total` FIELD now holds data. A phantom
    // scalar node would let that value overwrite the summed column here.
    values.set('item_total', 39.9);
    recalc(plan, values);

    expect(values.get('item_total__0')).toBeCloseTo(39.9);
    expect(values.get('subtotal')).toBeCloseTo(49.9);
  });
});

describe('wildcard dependencies', () => {
  it('evaluates a wildcard consumer after every token it sums', () => {
    // The consumer is declared FIRST, so document order alone would evaluate
    // it before the fees exist and silently produce 0.
    const specs: TokenSpec[] = [
      { id: 'total', formula: 'SUM(fee_*)' },
      { id: 'fee_shipping', formula: '2 + 3' },
      { id: 'fee_handling', formula: '1 + 1' }
    ];
    const plan = buildPlan(specs);
    const values = new Map<string, number>();
    recalc(plan, values);

    expect(values.get('total')).toBe(7);
  });

  it('re-evaluates the wildcard consumer when a summed token changes', () => {
    const specs: TokenSpec[] = [
      { id: 'total', formula: 'SUM(fee_*)' },
      { id: 'fee_shipping', source: 'fee_shipping' },
      { id: 'fee_handling', source: 'fee_handling' }
    ];
    const plan = buildPlan(specs);
    const values = new Map<string, number>([
      ['fee_shipping', 5],
      ['fee_handling', 2]
    ]);
    recalc(plan, values);
    expect(values.get('total')).toBe(7);

    values.set('fee_shipping', 8);
    const { changed } = recalc(plan, values);
    expect(changed.get('total')).toBe(10);
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
    { id: 'qty__0', validate: { min: 1, max: 999 } },
    { id: 'name', validate: { required: true } }
  ];

  it('flags a value below min', () => {
    const plan = buildPlan(specs);
    const failures = validationErrors(
      plan,
      new Map([
        ['qty__0', 0],
        ['name', 1]
      ])
    );
    expect(failures.get('qty__0')).toMatch(/at least 1/);
  });

  it('flags a value above max', () => {
    const plan = buildPlan(specs);
    const failures = validationErrors(
      plan,
      new Map([
        ['qty__0', 1000],
        ['name', 1]
      ])
    );
    expect(failures.get('qty__0')).toMatch(/at most 999/);
  });

  it('flags a missing required value', () => {
    const plan = buildPlan(specs);
    const failures = validationErrors(plan, new Map([['qty__0', 5]]));
    expect(failures.get('name')).toBe('required');
  });

  it('passes a valid document', () => {
    const plan = buildPlan(specs);
    const failures = validationErrors(
      plan,
      new Map([
        ['qty__0', 5],
        ['name', 1]
      ])
    );
    expect(failures.size).toBe(0);
  });
});
