import { buildCostsFixture } from '../../../../../elements/components/DocxEditor/bindings/core/tests/fixtures/costsFixture';
import { HeadlessSession, startHeadless } from './headlessSession';

describe('create_binding on a cell that already holds a value', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  it('adopts the written cell text as the input value and feeds the total', async () => {
    await session.call('open', JSON.stringify(buildCostsFixture()));
    const expenses = await session.call<string>('tableAnchor', 'expenses');
    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'create_binding',
          group: 'g01-add-premium',
          anchor: `${expenses};3;1;0`,
          name: 'expenses_subtotal',
          kind: 'formula',
          valueType: 'currency:USD:2',
          expression: 'sum(expenses.amount,collectible_premium)'
        },
        {
          op: 'insert_row',
          group: 'g01-add-premium',
          anchor: `${expenses};2;0;0`,
          shape: 'blank',
          resultRef: '@collectible'
        },
        {
          op: 'set_cell_text',
          group: 'g01-add-premium',
          anchor: '@collectible;0;0',
          text: 'Collectibles'
        },
        {
          op: 'set_cell_text',
          group: 'g01-add-premium',
          anchor: '@collectible;1;0',
          text: '$700',
          literal: true
        },
        {
          op: 'create_binding',
          group: 'g01-add-premium',
          anchor: '@collectible;1;0',
          name: 'collectible_premium',
          kind: 'input',
          valueType: 'currency:USD:2'
        }
      ],
      'add-collectible-premium'
    );

    expect(result.outcomes).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    const rows = await session.call<string[]>(
      'tableRowTextsAt',
      await session.call<string>('tableAnchor', 'expenses')
    );
    expect(rows).toContain('Collectibles$700.00');
    const after = await session.call<Record<string, string>>('formulaValues');
    // The bound input holds 700, so the subtotal it feeds rises by 700.
    expect(after.expenses_subtotal).toBe('$2,400.00');
    expect(after.expenses_total).toBe('$2,400.00');

    // Saved and reopened, the adopted value is the document's, not runtime state.
    await session.call('resolveGroups', true);
    await session.call(
      'open',
      await session.call<string>('serialize'),
      1,
      true
    );
    await session.call('reconcileBindings');
    expect(
      await session.call<string[]>(
        'tableRowTextsAt',
        await session.call<string>('tableAnchor', 'expenses')
      )
    ).toContain('Collectibles$700.00');
    const reopened = await session.call<Record<string, string>>(
      'formulaValues'
    );
    expect(reopened.expenses_subtotal).toBe('$2,400.00');
  }, 120000);

  it('refuses, untouched, when the cell text is not a value of that type', async () => {
    await session.call('open', JSON.stringify(buildCostsFixture()));
    const baseline = await session.call<string>('serialize');
    const expenses = await session.call<string>('tableAnchor', 'expenses');
    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'insert_row',
          group: 'g01-add-premium',
          anchor: `${expenses};2;0;0`,
          shape: 'blank',
          resultRef: '@pending'
        },
        {
          op: 'set_cell_text',
          group: 'g01-add-premium',
          anchor: '@pending;1;0',
          text: 'To be confirmed'
        },
        {
          op: 'create_binding',
          group: 'g01-add-premium',
          anchor: '@pending;1;0',
          name: 'pending_premium',
          kind: 'input',
          valueType: 'currency:USD:2'
        }
      ],
      'unparsed-premium'
    );

    expect(result.outcomes).toContain('binding_cell_text_unparsed');
    expect(result.messages.join(' ')).toMatch(/Pass `initial`/);
    expect(await session.call<string>('serialize')).toBe(baseline);
  }, 120000);

  it('adopts the written value over a tracked-deleted placeholder', async () => {
    // The Alternative 2 shape: an unbound cell's text overwritten with a
    // tracked write, then bound in the same change set. The deleted text is
    // not part of the value an accept would leave.
    await session.call('open', JSON.stringify(buildCostsFixture()));
    const expenses = await session.call<string>('tableAnchor', 'expenses');
    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'set_cell_text',
          group: 'g01-fill',
          anchor: `${expenses};3;0;0`,
          text: '$700',
          literal: true
        },
        {
          op: 'create_binding',
          group: 'g01-fill',
          anchor: `${expenses};3;0;0`,
          name: 'collectible_premium',
          kind: 'input',
          valueType: 'currency:USD:2'
        }
      ],
      'fill-placeholder'
    );

    expect(result.outcomes).toEqual(['ok', 'ok']);
    await session.call('resolveGroups', true);
    expect(
      await session.call<string[]>(
        'tableRowTextsAt',
        await session.call<string>('tableAnchor', 'expenses')
      )
    ).toContain('$700.00$1,700.00');
  }, 120000);

  it('binds two blocks that read the same in one change set, each in place', async () => {
    // Wrapping text in a binding moves no block, so the second write must stay
    // at its own anchor rather than be relocated by the text two blocks share.
    await session.call(
      'open',
      JSON.stringify({
        optimizeSfdt: false,
        sections: [
          {
            sectionFormat: { pageWidth: 612, pageHeight: 792 },
            blocks: [
              'Options',
              '$11,250.00',
              'Summary',
              '$11,250.00',
              'End'
            ].map((text) => ({ inlines: [{ text }] }))
          }
        ]
      })
    );
    const result = await session.call<any>(
      'applyEdits',
      ['0;3', '0;1'].map((anchor) => ({
        op: 'create_binding',
        group: 'g01-bind',
        anchor,
        expect: '$11,250.00',
        kind: 'input',
        name: 'HomeownersPremium',
        global: true,
        valueType: 'currency:USD:2'
      })),
      'bind-twice'
    );

    expect(result.outcomes).toEqual(['ok', 'ok']);
    expect(
      (await session.call<string[]>('serializedTags')).filter((tag) =>
        tag.startsWith('[[name=HomeownersPremium|')
      )
    ).toHaveLength(2);
  }, 120000);
});
