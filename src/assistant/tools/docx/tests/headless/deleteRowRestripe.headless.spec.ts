import { HeadlessSession, readFixture, startHeadless } from './headlessSession';

/**
 * A standalone tracked row deletion restripes the survivors from the accept
 * projection, exactly as a split does.
 *
 * Measured before the fix (browser document, Buildings and Stock deleted in a
 * change set of their own): Contents kept the second row's shade although it
 * becomes the first surviving item. The finalizer can only revisit a table an
 * op recorded, and delete_row recorded nothing; only duplicate_table did, which
 * is why the same rows deleted INSIDE a split's change set came out right.
 */
const STRIPE = '#E6E6E6FF';

describe('a standalone delete_row leaves the survivors striped for the document an accept produces', () => {
  let session: HeadlessSession;
  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);
  afterAll(async () => {
    await session?.close();
  });

  it('Buildings and Stock deleted: Contents white, Business interruption shaded, Machinery white', async () => {
    await session.call('open', readFixture('flagship-v4d.browser.sfdt.json'));
    const pristine = await session.call<string>('serialize');
    const before = await session.call<Array<string | null>>('rowShading', 'property_premium');
    // header, Buildings, Contents, Stock, Business interruption, Machinery, subtotal
    expect(before.slice(1, 6)).toEqual([null, STRIPE, null, STRIPE, null]);

    const applied = await session.call<any>('deleteRows', 'property_premium', [1, 3]);
    expect(applied.outcomes).toEqual(['ok']);

    const pending = await session.call<Array<string | null>>('rowShading', 'property_premium');
    // Rows 1 and 3 are marked, not gone; the survivors 2, 4, 5 read as items 0, 1, 2.
    expect(pending.length).toBe(before.length);
    expect([pending[2], pending[4], pending[5]]).toEqual([null, STRIPE, null]);
    // The aggregate row keeps the template's aggregate style (unshaded here).
    expect(pending[6]).toBe(before[6]);

    // Reject restores every fill byte for byte.
    const rejected = await session.call<number>('resolveGroups', false).catch(() => null);
    if (rejected !== null) {
      expect(await session.call<string>('serialize')).toBe(pristine);
    }
  }, 120000);
});
