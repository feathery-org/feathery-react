import { HeadlessSession, readFixture, startHeadless } from './headlessSession';

const SOURCE = 'property_premium';
const BEFORE = '$22,054.40';
const AFTER = '$11,008.00';

describe('calculated subtotals are visible tracked changes', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  async function split() {
    await session.call('open', readFixture('flagship-v4.browser.sfdt.json'));
    const baseline = await session.call<string>('serialize');
    const anchor = await session.call<string>('tableAnchor', SOURCE);
    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'duplicate_table',
          group: 'g01-split-property-premium',
          anchor,
          rows: 'copy',
          resultRef: '@copy'
        },
        {
          op: 'delete_row',
          group: 'g01-split-property-premium',
          anchor: '@copy',
          rows: [1, 2]
        },
        {
          op: 'delete_row',
          group: 'g01-split-property-premium',
          anchor,
          rows: [3, 4, 5]
        }
      ],
      'tracked-subtotal-split'
    );
    expect(result.outcomes).toEqual(['ok', 'ok', 'ok']);
    return baseline;
  }

  it('shows the original table subtotal as one before/after replacement', async () => {
    await split();
    const groups = await session.call<any[]>('groupItems');
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toContainEqual(
      expect.objectContaining({
        revisionType: 'Replace',
        text: AFTER,
        beforeText: BEFORE
      })
    );
  }, 120000);

  it('rejects the tracked subtotal and split back to the exact document', async () => {
    const baseline = await split();
    await session.call('resolveGroups', false);
    expect(await session.call<any[]>('groups')).toEqual([]);
    expect(await session.call<string>('serialize')).toBe(baseline);
  }, 120000);
});
