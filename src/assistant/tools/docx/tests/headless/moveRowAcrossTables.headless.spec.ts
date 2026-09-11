import { HeadlessSession, readFixture, startHeadless } from './headlessSession';

/**
 * A row moves between tables with insert_row, set_cell_text and delete_row
 * alone, in BOTH situations the captain named (2026-09-10): between two
 * tables the template already had, and into a table a split created - and in
 * the split case anchored where the assistant actually anchored in the live
 * run: on the row that had itself been moved in, and on the subtotal row.
 */
const move = (target: string, source: string, row: number, group: string) => [
  { op: 'insert_row', group, anchor: `${target};${row};0;0` },
  {
    op: 'set_cell_text',
    group,
    anchor: `${target};${row + 1};0;0`,
    text: 'Buildings'
  },
  {
    op: 'set_cell_text',
    group,
    anchor: `${target};${row + 1};1;0`,
    text: '12'
  },
  {
    op: 'set_cell_text',
    group,
    anchor: `${target};${row + 1};2;0`,
    text: '$640.50'
  },
  { op: 'delete_row', group, anchor: source, rows: [1] }
];

const splitStock = (source: string) => [
  {
    op: 'duplicate_table',
    group: 'g01',
    anchor: source,
    rows: 'copy',
    resultRef: '@copy'
  },
  {
    op: 'delete_row',
    group: 'g01',
    anchor: '@copy',
    rows: [1, 2, 4, 5]
  },
  { op: 'delete_row', group: 'g01', anchor: source, rows: [3] }
];

describe('a row moves between tables by primitives, before and after a split', () => {
  let session: HeadlessSession;
  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);
  afterAll(async () => {
    await session?.close();
  });

  it('before any split: Buildings moves from the Property table into the Liability table', async () => {
    await session.call('open', readFixture('flagship-v4.browser.sfdt.json'));
    const property = await session.call<string>(
      'tableAnchor',
      'property_premium'
    );
    const liability = await session.call<string>(
      'tableAnchor',
      'liability_premium'
    );
    const moved = await session.call<any>(
      'applyEdits',
      move(liability, property, 1, 'g01'),
      'across-before'
    );
    expect(moved.outcomes).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(await session.call<any[]>('groups')).toHaveLength(1);
    await session.call('resolveGroups', true);
    const formulas = await session.call<Record<string, string>>(
      'formulaValues'
    );
    expect(formulas.property_premium_subtotal).toBe('$14,368.40');
    expect(formulas.liability_premium_subtotal).toBe('$27,691.40');
    expect(formulas.summary_subtotal).toBe('$75,667.35');
    expect(formulas.grand_total).toBe('$82,099.07');
  }, 120000);

  it('after a split: a row moves into the copy, then more rows anchor on the moved row and on the subtotal row', async () => {
    await session.call('open', readFixture('flagship-v4.browser.sfdt.json'));
    const source = await session.call<string>(
      'tableAnchor',
      'property_premium'
    );
    expect(
      (
        await session.call<any>(
          'applyEdits',
          splitStock(source),
          'across-split'
        )
      ).outcomes
    ).toEqual(['ok', 'ok', 'ok']);
    await session.call('resolveGroups', true);
    const copy = await session.call<string>(
      'tableAnchor',
      'property_premium_copy'
    );
    // The copy holds Stock (row 1) and its subtotal (row 2); Buildings joins below Stock.
    const moved = await session.call<any>(
      'applyEdits',
      move(copy, source, 1, 'g02'),
      'across-move'
    );
    expect(moved.outcomes).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    await session.call('resolveGroups', true);
    let formulas = await session.call<Record<string, string>>('formulaValues');
    expect(formulas.property_premium_copy_subtotal).toBe('$12,012.00');
    expect(formulas.property_premium_subtotal).toBe('$10,042.40');
    // Anchored on the moved row (row 2 now), below it: a dictated Signage row.
    const onMoved = await session.call<any>(
      'applyEdits',
      [
        { op: 'insert_row', group: 'g03', anchor: `${copy};2;0;0` },
        {
          op: 'set_cell_text',
          group: 'g03',
          anchor: `${copy};3;0;0`,
          text: 'Signage'
        },
        {
          op: 'set_cell_text',
          group: 'g03',
          anchor: `${copy};3;1;0`,
          text: '3',
          literal: true
        },
        {
          op: 'set_cell_text',
          group: 'g03',
          anchor: `${copy};3;2;0`,
          text: '$210.00',
          literal: true
        }
      ],
      'across-on-moved'
    );
    expect(onMoved.outcomes).toEqual(['ok', 'ok', 'ok', 'ok']);
    await session.call('resolveGroups', true);
    formulas = await session.call<Record<string, string>>('formulaValues');
    expect(formulas.property_premium_copy_subtotal).toBe('$12,642.00');
    // Anchored on the subtotal row (row 4 now), below it: allowed, and still a bound line.
    const afterTotal = await session.call<any>(
      'applyEdits',
      [
        { op: 'insert_row', group: 'g04', anchor: `${copy};4;0;0` },
        {
          op: 'set_cell_text',
          group: 'g04',
          anchor: `${copy};5;0;0`,
          text: 'Fixtures'
        },
        {
          op: 'set_cell_text',
          group: 'g04',
          anchor: `${copy};5;1;0`,
          text: '2',
          literal: true
        },
        {
          op: 'set_cell_text',
          group: 'g04',
          anchor: `${copy};5;2;0`,
          text: '$100.00',
          literal: true
        }
      ],
      'across-after-total'
    );
    expect(afterTotal.outcomes).toEqual(['ok', 'ok', 'ok', 'ok']);
    await session.call('resolveGroups', true);
    formulas = await session.call<Record<string, string>>('formulaValues');
    expect(formulas.property_premium_copy_subtotal).toBe('$12,842.00');
    expect(
      await session.call<string[]>('tableRowTexts', 'property_premium_copy')
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Signage'),
        expect.stringContaining('Fixtures')
      ])
    );
  }, 120000);
});
