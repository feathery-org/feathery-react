import { HeadlessSession, readFixture, startHeadless } from './headlessSession';

/**
 * One card per message, even when the second message builds on the first.
 *
 * Measured before the fix: split a table (its subtotal recompute pending), then
 * delete a row of the same table in a second message; the delete's recompute
 * wrote the subtotal cell, and because both cards shared one tracking author
 * Syncfusion removed the split's pending insertion outright, so the split card
 * lost two edits and rejecting the delete could not restore them. Each change
 * set now writes as its own tracking identity, so the cards stay independent.
 */
const SOURCE = 'property_premium';
const SUMMARY = [
  'summary_property',
  'summary_subtotal',
  'summary_tax',
  'grand_total'
];

describe('two messages, two cards: the later card can be rejected on its own', () => {
  let session: HeadlessSession;
  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);
  afterAll(async () => {
    await session?.close();
  });

  async function splitThenDelete() {
    await session.call('open', readFixture('flagship-v3.browser.sfdt.json'));
    const baseline = await session.call<string>('serialize');
    const table = await session.call<string>('tableAnchor', SOURCE);
    const split = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'split_table',
          group: 'g01-split-stock',
          anchor: table,
          rows: [3]
        }
      ],
      'stacked-split'
    );
    expect(split.outcomes).toEqual(['ok']);
    const formulasAfterSplit = await session.call<Record<string, string>>(
      'formulaValues'
    );
    const groupsAfterSplit = await session.call<any[]>('groups');
    const rowsAfterSplit = await session.call<string[]>(
      'tableRowTexts',
      SOURCE
    );
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
      groupsAfterSplit,
      rowsAfterSplit
    };
  }

  it('the second card lands as its own card and moves the figures it should', async () => {
    const { formulasAfterSplit, groupsAfterSplit } = await splitThenDelete();
    expect(groupsAfterSplit).toHaveLength(1);
    expect(await session.call<any[]>('groups')).toHaveLength(2);
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

  it("rejecting only the second card restores the first card's document", async () => {
    const { baseline, formulasAfterSplit, rowsAfterSplit } =
      await splitThenDelete();
    await session.call('resolveGroupsOf', 'stacked-delete', false);
    // The subtotal replacement keeps the split card's identity while the later
    // card is pending, so rejecting the later card restores the split state.
    expect(await session.call<any[]>('groups')).toHaveLength(1);
    expect(await session.call<Record<string, string>>('formulaValues')).toEqual(
      formulasAfterSplit
    );
    expect(await session.call<string[]>('tableRowTexts', SOURCE)).toEqual(
      rowsAfterSplit
    );
    await session.call('resolveGroupsOf', 'stacked-split', false);
    expect(await session.call<any[]>('groups')).toHaveLength(0);
    const final = await session.call<string>('serialize');
    expect(final).toBe(baseline);
  }, 120000);

  it('accepting both cards gives the final document with every total consistent', async () => {
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
