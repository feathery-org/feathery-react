import { buildCostsFixture } from '../../../../../elements/components/DocxEditor/bindings/core/tests/fixtures/costsFixture';
import { HeadlessSession, startHeadless } from './headlessSession';

function plainCostsFixture(): any {
  const sfdt = JSON.parse(JSON.stringify(buildCostsFixture()));
  const blocks = sfdt.sections[0].blocks;
  const markerIndex = blocks.findIndex((block: any) =>
    String(block?.contentControlProperties?.tag ?? '').includes('table=costs')
  );
  const table = blocks[markerIndex].blocks.find((block: any) =>
    Array.isArray(block?.rows)
  );
  const textOf = (node: any): string => {
    if (Array.isArray(node)) return node.map(textOf).join('');
    if (!node || typeof node !== 'object') return '';
    if (typeof node.text === 'string') return node.text;
    return textOf(node.inlines) + textOf(node.blocks);
  };
  for (const row of table.rows)
    for (const cell of row.cells) {
      const text = textOf(cell);
      delete cell.contentControlProperties;
      cell.blocks = [{ inlines: [{ text }] }];
    }
  blocks.splice(markerIndex, 1, table);
  return sfdt;
}

const edits = (anchor: string) => [
  {
    op: 'insert_column',
    group: 'g01-add-value-column',
    anchor: `${anchor};0;2;0`,
    position: 'after',
    resultRef: '@value_col'
  },
  {
    op: 'set_column_layout',
    group: 'g01-add-value-column',
    anchor: '@value_col;0;0',
    width: 144
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
    expect(
      (await session.call<number[]>('columnWidths', replacement))[3]
    ).toBeCloseTo(144, 0);
    expect(await session.call<string[]>('tableRowTexts', replacement)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Value'),
        expect.stringContaining('$1,800.00'),
        expect.stringContaining('$6,000.00'),
        expect.stringContaining('$7,800.00')
      ])
    );
    expect(result.warnings).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining('Table appearance not finalized')
      ])
    );
    for (const row of [0, 1, 2])
      expect(await session.call<string>('cellShading', 'costs', row, 3)).toBe(
        await session.call<string>('cellShading', 'costs', row, 2)
      );
    expect(await session.call<any[]>('traces')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          applied: expect.arrayContaining([
            expect.objectContaining({
              op: 'insert_column',
              route: 'engine',
              mechanism: 'sfdt',
              tracking: 'tracked_change'
            }),
            expect.objectContaining({
              op: 'set_column_layout',
              route: 'editor',
              mechanism: 'syncfusion_editor',
              tracking: 'untracked_formatting'
            })
          ])
        })
      ])
    );

    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(baseline);
  }, 120000);

  it('promotes a plain table through the same primitives and rejects exactly', async () => {
    await session.call('open', JSON.stringify(plainCostsFixture()));
    const baseline = await session.call<string>('serialize');
    const source = await session.call<string>('tableAnchorContaining', 'Item');
    expect(await session.call<string[]>('tableRowTextsAt', source)).toEqual([
      'ItemQtyUnit priceLine total — tax 0%',
      'Design work12$150.00$1,800.00',
      'Development30$200.00$6,000.00',
      'Subtotal$7,800.00',
      'Tax$0.00',
      'Total$7,800.00'
    ]);
    const operations = [
      ...[1, 2].flatMap((row) => [
        {
          op: 'create_binding',
          group: 'g01-live-value-from-plain',
          anchor: `${source};${row};1;0`,
          kind: 'input',
          name: 'quantity',
          valueType: 'decimal:0'
        },
        {
          op: 'create_binding',
          group: 'g01-live-value-from-plain',
          anchor: `${source};${row};2;0`,
          kind: 'input',
          name: 'unit_cost',
          valueType: 'currency:USD:2'
        }
      ]),
      ...edits(source)
    ];

    const result = await session.call<any>(
      'applyEdits',
      operations,
      'live-value-from-plain'
    );

    if (result.outcomes.some((outcome: string) => outcome !== 'ok'))
      throw new Error(JSON.stringify(result));
    expect(result.groups).toBe(1);
    const promoted = (await session.call<string[]>('tableIds')).find((id) =>
      id.startsWith('table_')
    );
    expect(promoted).toBeDefined();
    expect(await session.call<number>('tableColumnCount', promoted)).toBe(5);
    expect(await session.call<string[]>('tableRowTexts', promoted)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Value'),
        expect.stringContaining('$1,800.00'),
        expect.stringContaining('$6,000.00'),
        expect.stringContaining('$7,800.00')
      ])
    );
    expect(await session.call<any[]>('traces')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          applied: expect.arrayContaining([
            expect.objectContaining({
              op: 'create_binding',
              route: 'engine',
              mechanism: 'sfdt_via_syncfusion_editor',
              tracking: 'tracked_change'
            }),
            expect.objectContaining({
              op: 'insert_column',
              route: 'engine',
              mechanism: 'sfdt_via_syncfusion_editor',
              tracking: 'tracked_change'
            })
          ])
        })
      ])
    );
    for (const row of [0, 1, 2])
      expect(await session.call<string>('cellShading', promoted, row, 3)).toBe(
        await session.call<string>('cellShading', promoted, row, 2)
      );

    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(baseline);

    const acceptedResult = await session.call<any>(
      'applyEdits',
      operations,
      'live-value-from-plain-accept'
    );
    expect(acceptedResult.outcomes).toEqual(operations.map(() => 'ok'));
    await session.call('resolveGroups', true);
    const accepted = await session.call<string>('serialize');
    const acceptedAnchor = await session.call<string>('tableAnchor', promoted);
    const update = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'set_cell_text',
          group: 'g02-change-quantity',
          anchor: `${acceptedAnchor};1;1;0`,
          expect: '12',
          text: '20',
          literal: true
        }
      ],
      'change-promoted-quantity'
    );
    expect(update.outcomes).toEqual(['ok']);
    const updatedRows = await session.call<string[]>('tableRowTexts', promoted);
    expect(updatedRows[1]).toEqual(expect.stringContaining('20'));
    expect(updatedRows[1]).toEqual(expect.stringContaining('$3,000.00'));
    expect(updatedRows[3]).toEqual(expect.stringContaining('$9,000.00'));
    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(accepted);
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

  it('rolls the structural transaction back when deferred native layout fails', async () => {
    await session.call('open', JSON.stringify(buildCostsFixture()));
    const baseline = await session.call<string>('serialize');
    const source = await session.call<string>('tableAnchor', 'costs');

    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'insert_column',
          group: 'g01-invalid-column-layout',
          anchor: `${source};0;2;0`,
          position: 'after',
          resultRef: '@value_col'
        },
        {
          op: 'set_column_layout',
          group: 'g01-invalid-column-layout',
          anchor: '@value_col;0;0',
          width: -1
        }
      ],
      'invalid-live-value-column'
    );

    expect(result.outcomes).toEqual([
      'change_set_failed',
      'invalid_column_width'
    ]);
    expect(await session.call<string>('serialize')).toBe(baseline);
  }, 120000);
});
