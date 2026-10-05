import { HeadlessSession, startHeadless } from './headlessSession';

const NAVY = '#001B49FF';
const WHITE = '#FFFFFFFF';
const GREY = '#F5F5F5FF';
const TOTAL = '#F2F2F2FF';

const cell = (text: string, fill: string, span = 1) => ({
  blocks: [{ inlines: [{ text }] }],
  cellFormat: {
    columnSpan: span,
    preferredWidth: 120 * span,
    preferredWidthType: 'Point',
    shading: {
      texture: 'TextureNone',
      backgroundColor: fill,
      foregroundColor: 'empty'
    }
  }
});

// A premium summary: two striped premium rows above a total row with its own
// fill, the premiums and the total written as binding tokens.
function premiumSummary(withBoat = false): string {
  const premium = (
    coverage: string,
    name: string,
    value: number,
    fill: string
  ) => ({
    rowFormat: { isHeader: false },
    cells: [
      cell(coverage, fill),
      cell('Carrier', fill),
      cell(`[[name=${name}|type=currency|value=${value}]]`, fill)
    ]
  });
  return JSON.stringify({
    optimizeSfdt: false,
    sections: [
      {
        sectionFormat: { pageWidth: 612, pageHeight: 792 },
        blocks: [
          { inlines: [{ text: 'Premium Summary' }] },
          {
            rows: [
              {
                rowFormat: { isHeader: true },
                cells: ['Coverage', 'Carrier', 'Premium'].map((text) =>
                  cell(text, NAVY)
                )
              },
              premium('Homeowners', 'HomePremium', 966, WHITE),
              premium('Automobile', 'AutoPremium', 7417, GREY),
              ...(withBoat ? [premium('Boat', 'BoatPremium', 150, WHITE)] : []),
              {
                rowFormat: { isHeader: false },
                cells: [
                  cell('TOTAL ANNUAL PREMIUM:', TOTAL, 2),
                  cell(
                    `[[name=TotalPremium|type=currency|expr=sum(HomePremium,AutoPremium${
                      withBoat ? ',BoatPremium' : ''
                    })]]`,
                    TOTAL
                  )
                ]
              }
            ],
            grid: [120, 120, 120],
            tableFormat: { preferredWidthType: 'Auto' },
            columnCount: 3
          },
          { inlines: [{ text: 'End' }] }
        ]
      }
    ]
  });
}

describe('a row inserted into a banded table above its total', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  it('takes the next band and leaves the total row as it was', async () => {
    await session.call('open', premiumSummary(), 1, true);
    const table = await session.call<string>(
      'tableAnchorContaining',
      'Coverage'
    );
    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'insert_row',
          group: 'g01-add-row',
          anchor: `${table};2;0;0`,
          shape: 'blank',
          resultRef: '@added'
        },
        {
          op: 'set_cell_text',
          group: 'g01-add-row',
          anchor: '@added;0;0',
          text: 'Collectibles'
        }
      ],
      'add-banded-row'
    );

    expect(result.outcomes).toEqual(['ok', 'ok']);
    await session.call('resolveGroups', true);
    expect(
      await session.call<Array<string | null>>(
        'rowShadingAt',
        await session.call<string>('tableAnchorContaining', 'Coverage')
      )
    ).toEqual([NAVY, WHITE, GREY, WHITE, TOTAL]);
  }, 120000);

  it('reads the stripe from the item rows while a row deletion is pending', async () => {
    await session.call('open', premiumSummary(true), 1, true);
    const table = await session.call<string>(
      'tableAnchorContaining',
      'Coverage'
    );
    const removed = await session.call<any>(
      'applyEdits',
      [{ op: 'delete_row', group: 'g01-remove', anchor: `${table};1;0;0` }],
      'remove-home'
    );
    expect(removed.outcomes).toEqual(['ok']);
    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'insert_row',
          group: 'g01-add-row',
          anchor: `${table};3;0;0`,
          shape: 'blank',
          resultRef: '@added'
        },
        {
          op: 'set_cell_text',
          group: 'g01-add-row',
          anchor: '@added;0;0',
          text: 'Collectibles'
        }
      ],
      'add-banded-row'
    );

    expect(result.outcomes).toEqual(['ok', 'ok']);
    await session.call('resolveGroups', true);
    expect(
      await session.call<Array<string | null>>(
        'rowShadingAt',
        await session.call<string>('tableAnchorContaining', 'Coverage')
      )
    ).toEqual([NAVY, GREY, WHITE, GREY, TOTAL]);
  }, 120000);

  it('updates the total formula at its own cell in a marker-less summary', async () => {
    await session.call('open', premiumSummary(), 1, true);
    const table = await session.call<string>(
      'tableAnchorContaining',
      'Coverage'
    );
    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'create_binding',
          group: 'g01-widen-total',
          anchor: `${table};3;1;0`,
          kind: 'formula',
          name: 'TotalPremium',
          valueType: 'currency:USD:2',
          expression: 'sum(HomePremium,AutoPremium)'
        }
      ],
      'widen-total'
    );

    expect(result.outcomes).toEqual(['ok']);
    await session.call('resolveGroups', true);
    const tags = (await session.call<string[]>('serializedTags')).filter(
      (tag) => tag.includes('name=TotalPremium')
    );
    expect(tags).toHaveLength(1);
  }, 120000);

  it('re-stating a value in a marker-less table changes nothing', async () => {
    await session.call('open', premiumSummary(), 1, true);
    const before = await session.call<string>('serialize');
    const table = await session.call<string>(
      'tableAnchorContaining',
      'Coverage'
    );
    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'create_binding',
          group: 'g01-restate',
          anchor: `${table};1;2;0`,
          kind: 'input',
          name: 'HomePremium',
          valueType: 'currency:USD:2'
        }
      ],
      'restate-home'
    );

    expect(result.outcomes).toEqual(['ok']);
    expect(result.revisions).toBe(0);
    expect(await session.call<string>('serialize')).toBe(before);
  }, 120000);
});
