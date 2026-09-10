import {
  HeadlessSession,
  readFixture,
  shoot,
  startHeadless
} from './headlessSession';

const SOURCE = 'property_premium';
const COPY = 'property_premium_copy';

const addSignage = (source: string) => [
  {
    op: 'insert_row',
    group: 'g02-add-signage',
    anchor: `${source};5;0;0`,
    expect: ''
  },
  {
    op: 'set_cell_text',
    group: 'g02-add-signage',
    anchor: `${source};6;0;0`,
    expect: '',
    text: 'Signage'
  },
  {
    op: 'set_cell_text',
    group: 'g02-add-signage',
    anchor: `${source};6;1;0`,
    expect: '',
    text: '3',
    literal: true
  },
  {
    op: 'set_cell_text',
    group: 'g02-add-signage',
    anchor: `${source};6;2;0`,
    expect: '',
    text: '210.00',
    literal: true
  }
];

describe('bound row operations while a source split is still pending', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  const openWithPendingSplit = async (): Promise<string> => {
    await session.call('open', readFixture('flagship-v4.browser.sfdt.json'));
    const source = await session.call<string>('tableAnchor', SOURCE);
    const split = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'duplicate_table',
          group: 'g01-split-tail',
          anchor: source,
          rows: 'copy',
          keepRows: [3, 4, 5]
        },
        {
          op: 'delete_row',
          group: 'g01-split-tail',
          anchor: `${source};3;0;0`,
          rows: [3, 4, 5]
        }
      ],
      'pending-source-split'
    );
    expect(split.outcomes).toEqual(['ok', 'ok']);
    expect(await session.call<any[]>('groups')).toHaveLength(1);
    return source;
  };

  it('creates a new green row instead of writing into a struck-through row', async () => {
    const source = await openWithPendingSplit();
    const inserted = await session.call<any>(
      'applyEdits',
      addSignage(source),
      'pending-source-insert'
    );
    expect(inserted.outcomes).toEqual(['ok', 'ok', 'ok', 'ok']);

    const groups = await session.call<any[]>('groups');
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.changeSetId).sort()).toEqual([
      'pending-source-insert',
      'pending-source-split'
    ]);

    const pendingFormulas = await session.call<Record<string, string>>(
      'formulaValues'
    );
    expect(pendingFormulas.property_premium_subtotal).toBe('$11,638.00');
    expect(pendingFormulas.property_premium_copy_subtotal).toBe('$11,046.40');
    expect(pendingFormulas.summary_subtotal).toBe('$76,297.35');
    expect(pendingFormulas.summary_tax).toBe('$6,485.27');
    expect(pendingFormulas.grand_total).toBe('$82,782.62');

    const pendingRows = await session.call<string[]>('tableRowTexts', SOURCE);
    expect(pendingRows[3]).toBe('Signage3$210.00$630.00');
    expect(pendingRows[4]).toContain('Stock');
    expect(pendingRows[5]).toContain('Business interruption');
    expect(pendingRows[6]).toContain('Machinery breakdown');
    const pendingRowIds = await session.call<string[]>('tableRowIds', SOURCE);
    expect(new Set(pendingRowIds).size).toBe(3);
    expect(pendingRowIds).toEqual(
      expect.arrayContaining(['property-r1', 'property-r2'])
    );
    await shoot(session, 'pending-source-insert', 'Signage');

    await session.call('resolveGroups', true);
    expect(await session.call<any[]>('groups')).toHaveLength(0);
    const rows = await session.call<string[]>('tableRowTexts', SOURCE);
    expect(rows).toHaveLength(5);
    expect(rows[1]).toContain('Buildings');
    expect(rows[2]).toContain('Contents');
    expect(rows[3]).toContain('Signage');
    expect(rows.join('|')).not.toMatch(/Stock|Business interruption|Machinery/);
    expect(await session.call<string[]>('tableRowIds', SOURCE)).toHaveLength(3);
    expect(await session.call<string[]>('tableRowIds', COPY)).toHaveLength(3);
    expect(
      await session.call<Array<string | null>>('rowShading', SOURCE)
    ).toEqual(['#001B49FF', null, '#E6E6E6FF', null, '#E6E6E6FF']);
    expect(
      await session.call<Array<string | null>>('rowShading', COPY)
    ).toEqual(['#001B49FF', null, '#E6E6E6FF', null, null]);

    const formulas = await session.call<Record<string, string>>(
      'formulaValues'
    );
    expect(formulas.property_premium_subtotal).toBe('$11,638.00');
    expect(formulas.property_premium_copy_subtotal).toBe('$11,046.40');
    expect(formulas.summary_subtotal).toBe('$76,297.35');
    expect(formulas.summary_tax).toBe('$6,485.27');
    expect(formulas.grand_total).toBe('$82,782.62');
  }, 120000);

  it('rejects only the added row back to the exact pending split', async () => {
    const source = await openWithPendingSplit();
    const beforeInsert = await session.call<string>('serialize');

    const inserted = await session.call<any>(
      'applyEdits',
      addSignage(source),
      'pending-source-insert'
    );
    expect(inserted.outcomes).toEqual(['ok', 'ok', 'ok', 'ok']);

    await session.call('resolveGroupsOf', 'pending-source-insert', false);
    expect(await session.call<string>('serialize')).toBe(beforeInsert);
    const groups = await session.call<any[]>('groups');
    expect(groups).toHaveLength(1);
    expect(groups[0].changeSetId).toBe('pending-source-split');
  }, 120000);

  it('can accept an added row and then delete it while the split stays pending', async () => {
    const source = await openWithPendingSplit();
    expect(
      (
        await session.call<any>(
          'applyEdits',
          addSignage(source),
          'pending-source-insert'
        )
      ).outcomes
    ).toEqual(['ok', 'ok', 'ok', 'ok']);

    await session.call('resolveGroupsOf', 'pending-source-insert', true);
    let groups = await session.call<any[]>('groups');
    expect(groups).toHaveLength(1);
    expect(groups[0].changeSetId).toBe('pending-source-split');

    const signage = (await session.call<any[]>('inventory')).find(
      (entry) => entry.text === 'Signage'
    );
    expect(signage?.anchor).toMatch(new RegExp(`^${source};\\d+;0;0$`));
    const signageRow = Number(signage.anchor.split(';')[2]);
    const deleted = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'delete_row',
          group: 'g03-delete-signage',
          anchor: signage.anchor,
          expect: 'Signage',
          rows: [signageRow]
        }
      ],
      'pending-source-delete'
    );
    expect(deleted.outcomes).toEqual(['ok']);

    groups = await session.call<any[]>('groups');
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.changeSetId).sort()).toEqual([
      'pending-source-delete',
      'pending-source-split'
    ]);

    const pendingDeleteFormulas = await session.call<Record<string, string>>(
      'formulaValues'
    );
    expect(pendingDeleteFormulas.property_premium_subtotal).toBe('$11,008.00');
    expect(pendingDeleteFormulas.summary_subtotal).toBe('$75,667.35');
    expect(pendingDeleteFormulas.summary_tax).toBe('$6,431.72');
    expect(pendingDeleteFormulas.grand_total).toBe('$82,099.07');

    await session.call('resolveGroupsOf', 'pending-source-delete', true);
    groups = await session.call<any[]>('groups');
    expect(groups).toHaveLength(1);
    expect(groups[0].changeSetId).toBe('pending-source-split');
    expect(await session.call<string[]>('tableRowIds', SOURCE)).toHaveLength(2);

    await session.call('resolveGroupsOf', 'pending-source-split', true);
    expect(await session.call<any[]>('groups')).toHaveLength(0);
    expect(
      (await session.call<string[]>('tableRowTexts', SOURCE)).join('|')
    ).not.toContain('Signage');
    expect(
      await session.call<Array<string | null>>('rowShading', SOURCE)
    ).toEqual(['#001B49FF', null, '#E6E6E6FF', null]);

    const formulas = await session.call<Record<string, string>>(
      'formulaValues'
    );
    expect(formulas.property_premium_subtotal).toBe('$11,008.00');
    expect(formulas.property_premium_copy_subtotal).toBe('$11,046.40');
    expect(formulas.summary_subtotal).toBe('$75,667.35');
    expect(formulas.summary_tax).toBe('$6,431.72');
    expect(formulas.grand_total).toBe('$82,099.07');
  }, 120000);

  it('moves non-contiguous rows and restripes both resulting tables', async () => {
    await session.call('open', readFixture('flagship-v4.browser.sfdt.json'));
    const source = await session.call<string>('tableAnchor', SOURCE);
    expect(await session.call<number>('contentControlCount')).toBe(82);

    const split = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'duplicate_table',
          group: 'g01-split-alternating',
          anchor: source,
          rows: 'copy',
          keepRows: [2, 4]
        },
        {
          op: 'delete_row',
          group: 'g01-split-alternating',
          anchor: `${source};2;0;0`,
          rows: [2, 4]
        }
      ],
      'split-non-contiguous-rows'
    );
    expect(split.outcomes).toEqual(['ok', 'ok']);
    const pendingGroups = await session.call<any[]>('groups');
    expect(pendingGroups).toHaveLength(1);
    expect(pendingGroups[0].changeSetId).toBe('split-non-contiguous-rows');

    const pendingFormulas = await session.call<Record<string, string>>(
      'formulaValues'
    );
    expect(pendingFormulas.property_premium_subtotal).toBe('$14,249.40');
    expect(pendingFormulas.property_premium_copy_subtotal).toBe('$7,805.00');

    await session.call('resolveGroups', true);
    expect(await session.call<any[]>('groups')).toHaveLength(0);
    expect(await session.call<number>('contentControlCount')).toBe(84);

    const sourceRows = await session.call<string[]>('tableRowTexts', SOURCE);
    const copyRows = await session.call<string[]>('tableRowTexts', COPY);
    expect(sourceRows).toHaveLength(5);
    expect(sourceRows[1]).toContain('Buildings');
    expect(sourceRows[2]).toContain('Stock');
    expect(sourceRows[3]).toContain('Machinery breakdown');
    expect(sourceRows.join('|')).not.toMatch(/Contents|Business interruption/);
    expect(copyRows).toHaveLength(4);
    expect(copyRows[1]).toContain('Contents');
    expect(copyRows[2]).toContain('Business interruption');

    const sourceIds = await session.call<string[]>('tableRowIds', SOURCE);
    const copyIds = await session.call<string[]>('tableRowIds', COPY);
    expect(sourceIds).toHaveLength(3);
    expect(copyIds).toHaveLength(2);
    expect(new Set([...sourceIds, ...copyIds]).size).toBe(5);
    expect(
      await session.call<Array<string | null>>('rowShading', SOURCE)
    ).toEqual(['#001B49FF', null, '#E6E6E6FF', null, null]);
    expect(
      await session.call<Array<string | null>>('rowShading', COPY)
    ).toEqual(['#001B49FF', null, '#E6E6E6FF', null]);

    const formulas = await session.call<Record<string, string>>(
      'formulaValues'
    );
    expect(formulas.property_premium_subtotal).toBe('$14,249.40');
    expect(formulas.property_premium_copy_subtotal).toBe('$7,805.00');
    expect(formulas.summary_subtotal).toBe('$75,667.35');
    expect(formulas.summary_tax).toBe('$6,431.72');
    expect(formulas.grand_total).toBe('$82,099.07');
  }, 120000);
});
