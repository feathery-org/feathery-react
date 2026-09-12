import { HeadlessSession, readFixture, startHeadless } from './headlessSession';

/**
 * Moving a row between two bound tables is a composition of the primitives we
 * have: insert_row into the destination, set_cell_text of the values the source
 * row shows, delete_row of the source. No new op (captain, 2026-09-09).
 *
 * The one thing that used to block it: the numeric provenance guard accepted a
 * dictated or an attachment-quoted figure only, so the model was made to ask
 * the user to dictate figures it had just read off the page. A figure the
 * document already shows in the same column, written into a row this change
 * set is creating, is now verified against the document and accepted.
 */
const SUMMARY = [
  'summary_property',
  'summary_subtotal',
  'summary_tax',
  'grand_total'
];

const splitStock = (source: string, group: string) => [
  {
    op: 'duplicate_table',
    group,
    anchor: source,
    rows: 'copy',
    resultRef: '@copy'
  },
  { op: 'delete_row', group, anchor: '@copy', rows: [1, 2, 4, 5] },
  { op: 'delete_row', group, anchor: source, rows: [3] }
];

/** The document with revision records and revision references removed. */
function withoutRevisionIdentity(doc: string): string {
  const parsed = JSON.parse(doc);
  delete parsed.revisions;
  const strip = (node: any): void => {
    if (Array.isArray(node)) return node.forEach(strip);
    if (!node || typeof node !== 'object') return;
    delete node.revisionIds;
    Object.values(node).forEach(strip);
  };
  strip(parsed);
  return JSON.stringify(parsed);
}

describe('a row moves between tables by delete_row plus insert_row with the values the document shows', () => {
  let session: HeadlessSession;
  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);
  afterAll(async () => {
    await session?.close();
  });

  it('while the split is pending, the move joins its table-family card and one reject restores the original', async () => {
    await session.call('open', readFixture('flagship-v4d.browser.sfdt.json'));
    const originalTags = await session.call<string[]>('serializedTags');
    const originalRows = await session.call<string[]>(
      'tableRowTexts',
      'property_premium'
    );
    const source = await session.call<string>(
      'tableAnchor',
      'property_premium'
    );
    expect(
      (
        await session.call<any>(
          'applyEdits',
          splitStock(source, 'g01'),
          'move-pending-split'
        )
      ).outcomes
    ).toEqual(['ok', 'ok', 'ok']);
    const copy = await session.call<string>(
      'tableAnchor',
      'property_premium_copy'
    );
    const moved = await session.call<any>(
      'applyEdits',
      [
        { op: 'insert_row', group: 'g02', anchor: `${copy};1;0;0` },
        {
          op: 'set_cell_text',
          group: 'g02',
          anchor: `${copy};2;0;0`,
          text: 'Buildings'
        },
        {
          op: 'set_cell_text',
          group: 'g02',
          anchor: `${copy};2;1;0`,
          text: '12'
        },
        {
          op: 'set_cell_text',
          group: 'g02',
          anchor: `${copy};2;2;0`,
          text: '$640.50'
        },
        { op: 'delete_row', group: 'g02', anchor: source, rows: [1] }
      ],
      'move-pending'
    );
    expect(moved.outcomes).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    const groups = await session.call<any[]>('groups');
    expect(groups.map((group) => group.changeSetId).sort()).toEqual([
      'move-pending',
      'move-pending-split'
    ]);
    const formulas = await session.call<Record<string, string>>(
      'formulaValues'
    );
    expect(
      formulas.property_premium_copy_subtotal.startsWith('$12,012.00')
    ).toBe(true);
    expect(formulas.property_premium_subtotal.startsWith('$10,042.40')).toBe(
      true
    );
    await session.call('resolveGroupsOf', 'move-pending', false);
    expect(
      (await session.call<any[]>('groups')).map((group) => group.changeSetId)
    ).toEqual(['move-pending-split']);
    await session.call('resolveGroupsOf', 'move-pending-split', false);
    const formulasAfterReject = await session.call<Record<string, string>>(
      'formulaValues'
    );
    expect(formulasAfterReject.property_premium_subtotal).toBe('$22,054.40');
    expect(formulasAfterReject.property_premium_copy_subtotal).toBeUndefined();
    expect(await session.call<string[]>('tableIds')).not.toContain(
      'property_premium_copy'
    );
    expect(
      await session.call<string[]>('tableRowTexts', 'property_premium')
    ).toEqual(originalRows);
    expect(await session.call<string[]>('serializedTags')).toEqual(
      originalTags
    );
    expect(await session.call<any[]>('groups')).toHaveLength(0);
  }, 120000);

  it('an unrelated paragraph in between remains independent: two cards, table reject leaves the paragraph change', async () => {
    await session.call('open', readFixture('flagship-v4d.browser.sfdt.json'));
    const source = await session.call<string>(
      'tableAnchor',
      'property_premium'
    );
    expect(
      (
        await session.call<any>(
          'applyEdits',
          splitStock(source, 'g01'),
          'three-split'
        )
      ).outcomes
    ).toEqual(['ok', 'ok', 'ok']);
    // Something else entirely, in another table: a liability item's name.
    const liability = await session.call<string>(
      'tableAnchor',
      'liability_premium'
    );
    expect(
      (
        await session.call<any>(
          'applyEdits',
          [
            {
              op: 'set_cell_text',
              group: 'g01',
              anchor: `${liability};1;0;0`,
              text: 'Public liability cover'
            }
          ],
          'three-unrelated'
        )
      ).outcomes
    ).toEqual(['ok']);
    const copy = await session.call<string>(
      'tableAnchor',
      'property_premium_copy'
    );
    const moved = await session.call<any>(
      'applyEdits',
      [
        { op: 'insert_row', group: 'g02', anchor: `${copy};1;0;0` },
        {
          op: 'set_cell_text',
          group: 'g02',
          anchor: `${copy};2;0;0`,
          text: 'Buildings'
        },
        {
          op: 'set_cell_text',
          group: 'g02',
          anchor: `${copy};2;1;0`,
          text: '12'
        },
        {
          op: 'set_cell_text',
          group: 'g02',
          anchor: `${copy};2;2;0`,
          text: '$640.50'
        },
        { op: 'delete_row', group: 'g02', anchor: source, rows: [1] }
      ],
      'three-move'
    );
    expect(moved.outcomes).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    const groups = await session.call<any[]>('groups');
    expect(groups.map((group: any) => group.changeSetId).sort()).toEqual([
      'three-move',
      'three-split',
      'three-unrelated'
    ]);
    await session.call('resolveGroupsOf', 'three-move', false);
    expect(
      (await session.call<any[]>('groups'))
        .map((group: any) => group.changeSetId)
        .sort()
    ).toEqual(['three-split', 'three-unrelated']);
    await session.call('resolveGroupsOf', 'three-split', false);
    expect(
      (await session.call<any[]>('groups')).map(
        (group: any) => group.changeSetId
      )
    ).toEqual(['three-unrelated']);
    expect(await session.call<string>('serialize')).toContain(
      'Public liability cover'
    );
    const formulas = await session.call<Record<string, string>>(
      'formulaValues'
    );
    expect(formulas.property_premium_copy_subtotal).toBeUndefined();
    expect(formulas.property_premium_subtotal).toBe('$22,054.40');
  }, 120000);

  it('after the split is accepted, Buildings joins the Stock table: subtotals move by its line total, summary holds, reject restores byte for byte', async () => {
    await session.call('open', readFixture('flagship-v4d.browser.sfdt.json'));
    const source = await session.call<string>(
      'tableAnchor',
      'property_premium'
    );
    expect(
      (
        await session.call<any>(
          'applyEdits',
          splitStock(source, 'g01-split-stock'),
          'move-row-split'
        )
      ).outcomes
    ).toEqual(['ok', 'ok', 'ok']);
    await session.call('resolveGroups', true);
    const accepted = await session.call<string>('serialize');
    const tagsAccepted = await session.call<string[]>('serializedTags');
    const formulasAccepted = await session.call<Record<string, string>>(
      'formulaValues'
    );
    expect(formulasAccepted.property_premium_copy_subtotal).toBe('$4,326.00');
    expect(formulasAccepted.property_premium_subtotal).toBe('$17,728.40');

    const copy = await session.call<string>(
      'tableAnchor',
      'property_premium_copy'
    );
    const moved = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'insert_row',
          group: 'g02-move-buildings',
          anchor: `${copy};1;0;0`
        },
        {
          op: 'set_cell_text',
          group: 'g02-move-buildings',
          anchor: `${copy};2;0;0`,
          text: 'Buildings'
        },
        {
          op: 'set_cell_text',
          group: 'g02-move-buildings',
          anchor: `${copy};2;1;0`,
          text: '12'
        },
        {
          op: 'set_cell_text',
          group: 'g02-move-buildings',
          anchor: `${copy};2;2;0`,
          text: '$640.50'
        },
        {
          op: 'delete_row',
          group: 'g02-move-buildings',
          anchor: source,
          rows: [1]
        }
      ],
      'move-row-buildings'
    );
    expect(moved.outcomes).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    const formulas = await session.call<Record<string, string>>(
      'formulaValues'
    );
    expect(formulas.property_premium_copy_subtotal).toBe('$12,012.00');
    expect(formulas.property_premium_subtotal).toBe('$10,042.40');
    for (const line of SUMMARY)
      expect(formulas[line]).toBe(formulasAccepted[line]);
    // Law 4 by NAME CENSUS: the new row carries the four bindings of an item
    // row under one fresh row id, and the source row's four are still present,
    // marked for deletion, until the card is accepted.
    const tagsNow = await session.call<string[]>('serializedTags');
    const rowOf = (tag: string) =>
      /row=([a-z0-9_-]+)\]\]$/.exec(tag)?.[1] ?? '';
    const nameOf = (tag: string) => /\[\[name=([a-z_]+)/.exec(tag)?.[1] ?? '';
    const known = new Set(formulasAccepted && tagsAccepted.map(rowOf));
    const freshRows = [
      ...new Set(tagsNow.map(rowOf).filter((row) => row && !known.has(row)))
    ];
    expect(freshRows).toHaveLength(1);
    expect(
      tagsNow
        .filter((tag) => rowOf(tag) === freshRows[0])
        .map(nameOf)
        .sort()
    ).toEqual(['item_name', 'line_total', 'rate', 'units']);
    expect(tagsNow.filter((tag) => rowOf(tag) === 'property-r1')).toHaveLength(
      4
    );

    await session.call('resolveGroupsOf', 'move-row-buildings', false);
    const after = await session.call<string>('serialize');
    expect(after).toBe(accepted);
  }, 120000);
});
