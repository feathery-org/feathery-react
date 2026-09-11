import { HeadlessSession, readFixture, startHeadless } from './headlessSession';

describe('splitting a table that contains a pending inserted row', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  it('moves accepted and pending rows atomically, then one family reject restores the original', async () => {
    await session.call('open', readFixture('flagship-v4.browser.sfdt.json'));
    const original = await session.call<string>('serialize');
    const source = await session.call<string>(
      'tableAnchor',
      'property_premium'
    );

    const added = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'insert_row',
          group: 'g01-add-equipment',
          anchor: `${source};3;0;0`,
          expect: 'Stock'
        },
        {
          op: 'set_cell_text',
          group: 'g01-add-equipment',
          anchor: `${source};4;0;0`,
          expect: '',
          text: 'Equipment'
        },
        {
          op: 'set_cell_text',
          group: 'g01-add-equipment',
          anchor: `${source};4;1;0`,
          expect: '',
          text: '10',
          literal: true
        },
        {
          op: 'set_cell_text',
          group: 'g01-add-equipment',
          anchor: `${source};4;2;0`,
          expect: '',
          text: '1000',
          literal: true
        }
      ],
      'add-equipment'
    );
    expect(added.outcomes).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(await session.call<any[]>('groups')).toHaveLength(1);
    expect(await session.call<number>('contentControlCount')).toBe(86);

    const split = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'duplicate_table',
          group: 'g02-split-selected',
          anchor: source,
          rows: 'copy',
          resultRef: '@copy'
        },
        {
          op: 'delete_row',
          group: 'g02-split-selected',
          anchor: '@copy',
          rows: [2, 5, 6]
        },
        {
          op: 'delete_row',
          group: 'g02-split-selected',
          anchor: `${source};1;0;0`,
          rows: [1, 3, 4]
        }
      ],
      'split-with-pending-equipment'
    );

    expect(split.outcomes).toEqual(['ok', 'ok', 'ok']);
    const groups = await session.call<any[]>('groups');
    expect(groups).toHaveLength(1);
    expect(groups[0].changeSetIds.sort()).toEqual([
      'add-equipment',
      'split-with-pending-equipment'
    ]);
    expect(await session.call<number>('contentControlCount')).toBe(100);
    expect(
      await session.call<string[]>('tableRowIds', 'property_premium')
    ).toEqual(['property-r2', 'property-r4', 'property-r5']);
    expect(
      await session.call<string[]>('tableRowIds', 'property_premium_copy')
    ).toEqual([
      'property_premium_copy_r1',
      'property_premium_copy_r3',
      'property_premium_copy_r4'
    ]);
    expect(
      await session.call<string[]>('tableRowTexts', 'property_premium_copy')
    ).toEqual([
      'ItemUnitsRateLine total',
      'Buildings12$640.50$7,686.00',
      'Stock15$288.40$4,326.00',
      'Equipment10$1,000.00$10,000.00',
      'Subsection subtotal$22,012.00'
    ]);
    expect(
      await session.call<Array<string | null>>('rowShading', 'property_premium')
    ).toEqual([
      '#001B49FF',
      null,
      null,
      null,
      '#E6E6E6FF',
      '#E6E6E6FF',
      null,
      '#E6E6E6FF'
    ]);
    expect(
      await session.call<Array<string | null>>(
        'rowShading',
        'property_premium_copy'
      )
    ).toEqual(['#001B49FF', null, '#E6E6E6FF', null, '#E6E6E6FF']);
    expect(
      await session.call<Record<string, string>>('formulaValues')
    ).toMatchObject({
      property_premium_subtotal: '$10,042.40',
      property_premium_copy_subtotal: '$22,012.00',
      summary_property: '$32,054.40',
      summary_subtotal: '$85,667.35',
      summary_tax: '$7,281.72',
      grand_total: '$92,949.07'
    });

    await session.call(
      'resolveGroupsOf',
      'split-with-pending-equipment',
      false
    );
    expect(await session.call<number>('contentControlCount')).toBe(82);
    expect(await session.call<string>('serialize')).toBe(original);
  }, 120000);
});
