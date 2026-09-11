import { buildCostsFixture } from '../../../../../elements/components/DocxEditor/bindings/core/tests/fixtures/costsFixture';
import { HeadlessSession, startHeadless } from './headlessSession';

const edits = (anchor: string) => [
  {
    op: 'insert_column',
    group: 'g01-add-value-column',
    anchor: `${anchor};0;2;0`,
    position: 'after',
    resultRef: '@value_col'
  },
  {
    op: 'set_cell_text',
    group: 'g01-add-value-column',
    anchor: '@value_col;0;0',
    text: 'Value'
  },
  ...[1, 2].map((row) => ({
    op: 'create_binding',
    group: 'g01-add-value-column',
    anchor: `@value_col;${row};0`,
    kind: 'formula',
    name: 'value',
    valueType: 'currency:USD:2',
    expression: 'mul(quantity,unit_cost)'
  })),
  {
    op: 'create_binding',
    group: 'g01-add-value-column',
    anchor: '@value_col;3;0',
    kind: 'formula',
    name: 'value_subtotal',
    valueType: 'currency:USD:2',
    expression: 'sum(table.value)'
  }
];

describe('live value-column primitives', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  it('adds a tracked column with persistent row formulas and a subtotal', async () => {
    await session.call('open', JSON.stringify(buildCostsFixture()));
    const baseline = await session.call<string>('serialize');
    const source = await session.call<string>('tableAnchor', 'costs');

    const result = await session.call<any>(
      'applyEdits',
      edits(source),
      'live-value-column'
    );

    if (result.outcomes.some((outcome: string) => outcome !== 'ok'))
      throw new Error(JSON.stringify(result));
    expect(result.groups).toBe(1);
    const replacement = (await session.call<string[]>('tableIds')).find(
      (id) => id === 'costs'
    );
    expect(replacement).toBe('costs');
    expect(await session.call<number>('tableColumnCount', replacement)).toBe(5);
    expect(await session.call<string[]>('tableRowTexts', replacement)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Value'),
        expect.stringContaining('$1,800.00'),
        expect.stringContaining('$6,000.00'),
        expect.stringContaining('$7,800.00')
      ])
    );

    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(baseline);
  }, 120000);

  it('creates and targets a new blank subtotal row in the same primitive chain', async () => {
    await session.call('open', JSON.stringify(buildCostsFixture()));
    const baseline = await session.call<string>('serialize');
    const source = await session.call<string>('tableAnchor', 'costs');
    const operations = [
      ...edits(source).slice(0, -1),
      {
        op: 'insert_row',
        group: 'g01-add-value-column',
        anchor: '@value_col;2;0',
        shape: 'blank',
        resultRef: '@subtotal'
      },
      {
        op: 'set_cell_text',
        group: 'g01-add-value-column',
        anchor: '@subtotal;0;0',
        text: 'Value subtotal'
      },
      {
        op: 'create_binding',
        group: 'g01-add-value-column',
        anchor: '@subtotal;3;0',
        kind: 'formula',
        name: 'value_subtotal_new',
        valueType: 'currency:USD:2',
        expression: 'sum(table.value)'
      }
    ];

    const result = await session.call<any>(
      'applyEdits',
      operations,
      'live-value-subtotal-row'
    );

    if (result.outcomes.some((outcome: string) => outcome !== 'ok'))
      throw new Error(JSON.stringify(result));
    expect(result.groups).toBe(1);
    expect(await session.call<string[]>('tableRowTexts', 'costs')).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Value subtotal$7,800.00')
      ])
    );

    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(baseline);
  }, 120000);
});
