import { HeadlessSession, readFixture, startHeadless } from './headlessSession';

/**
 * One review family when a later message builds on the same table.
 *
 * Each structural turn keeps its own tracking identity while the rail resolves
 * every dependent identity together as one table family.
 */
const SOURCE = 'property_premium';
const SUMMARY = [
  'summary_property',
  'summary_subtotal',
  'summary_tax',
  'grand_total'
];

describe('dependent table messages remain independently reviewable', () => {
  let session: HeadlessSession;
  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);
  afterAll(async () => {
    await session?.close();
  });

  async function splitThenDelete() {
    await session.call('open', readFixture('flagship-v4d.browser.sfdt.json'));
    const baseline = await session.call<string>('serialize');
    const table = await session.call<string>('tableAnchor', SOURCE);
    const split = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'duplicate_table',
          group: 'g01-split-stock',
          anchor: table,
          rows: 'copy',
          resultRef: '@copy'
        },
        {
          op: 'delete_row',
          group: 'g01-split-stock',
          anchor: '@copy',
          rows: [1, 2, 4, 5]
        },
        {
          op: 'delete_row',
          group: 'g01-split-stock',
          anchor: table,
          rows: [3]
        }
      ],
      'stacked-split'
    );
    expect(split.outcomes).toEqual(['ok', 'ok', 'ok']);
    const formulasAfterSplit = await session.call<Record<string, string>>(
      'formulaValues'
    );
    const groupsAfterSplit = await session.call<any[]>('groups');
    const deleted = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'delete_row',
          group: 'g01-delete-buildings',
          anchor: table,
          rows: [1]
        }
      ],
      'stacked-delete'
    );
    expect(deleted.outcomes).toEqual(['ok']);
    return {
      baseline,
      formulasAfterSplit,
      groupsAfterSplit
    };
  }

  it('the second change gets its own card and moves the figures it should', async () => {
    const { formulasAfterSplit, groupsAfterSplit } = await splitThenDelete();
    expect(groupsAfterSplit).toHaveLength(1);
    const groups = await session.call<any[]>('groups');
    expect(groups.map((group) => group.changeSetId).sort()).toEqual([
      'stacked-delete',
      'stacked-split'
    ]);
    const formulas = await session.call<Record<string, string>>(
      'formulaValues'
    );
    expect(formulasAfterSplit.property_premium_subtotal).toBe('$17,728.40');
    // Pending reads include the run marked deleted-by-card-2; the live value leads.
    expect(formulas.property_premium_subtotal.startsWith('$10,042.40')).toBe(
      true
    );
    expect(formulas.property_premium_copy_subtotal).toBe('$4,326.00');
    // The summary follows: Buildings left the document's property total.
    expect(formulas.summary_property).not.toBe(
      formulasAfterSplit.summary_property
    );
  }, 120000);

  it('rejecting newest then oldest restores the original document', async () => {
    const { baseline, formulasAfterSplit } = await splitThenDelete();
    await session.call('resolveGroupsOf', 'stacked-delete', false);
    expect(
      (await session.call<any[]>('groups')).map((group) => group.changeSetId)
    ).toEqual(['stacked-split']);
    expect(await session.call<Record<string, string>>('formulaValues')).toEqual(
      formulasAfterSplit
    );
    await session.call('resolveGroupsOf', 'stacked-split', false);
    expect(await session.call<any[]>('groups')).toHaveLength(0);
    const final = await session.call<string>('serialize');
    expect(final).toBe(baseline);
  }, 120000);

  it('accepting the family gives the final document with every total consistent', async () => {
    await splitThenDelete();
    await session.call('resolveGroups', true);
    expect(await session.call<any[]>('groups')).toHaveLength(0);
    const formulas = await session.call<Record<string, string>>(
      'formulaValues'
    );
    expect(formulas.property_premium_subtotal).toBe('$10,042.40');
    expect(formulas.property_premium_copy_subtotal).toBe('$4,326.00');
    for (const line of SUMMARY) expect(formulas[line]).toBeTruthy();
  }, 120000);
});
