import { HeadlessSession, readFixture, startHeadless } from './headlessSession';

/**
 * A template that runs its stripe through the totals row keeps it running
 * through the totals row of every fragment a split produces.
 *
 * Captain (2026-09-09): "the subsection subtotal is part of the striping". The
 * source document was rebuilt with the Property and Motor subtotals shaded as
 * the next band; here the same shape is produced from the browser fixture so
 * the row does not wait on a re-upload. Before the fix the copy's subtotal
 * kept the fill it was cloned with, two shaded rows in a row after Stock.
 */
const STRIPE = '#E6E6E6FF';

describe('the stripe runs through the totals row when the template does', () => {
  let session: HeadlessSession;
  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);
  afterAll(async () => {
    await session?.close();
  });

  /** The browser fixture with the Property subtotal shaded as the next band. */
  const fixtureWithStripedSubtotal = (): string => {
    const doc = JSON.parse(readFixture('flagship-v3.browser.sfdt.json'));
    let touched = 0;
    const visit = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(visit);
      const rows = node.rows;
      if (Array.isArray(rows) && JSON.stringify(rows[1] ?? {}).includes('Buildings')) {
        const last = rows[rows.length - 1];
        if (JSON.stringify(last).includes('Subsection subtotal')) {
          for (const cell of last.cells ?? []) {
            cell.cellFormat = cell.cellFormat ?? {};
            cell.cellFormat.shading = { ...(cell.cellFormat.shading ?? {}), backgroundColor: STRIPE };
            touched++;
          }
        }
      }
      for (const value of Object.values(node)) visit(value);
    };
    visit(doc);
    if (!touched) throw new Error('fixture has no Property subtotal row to shade');
    return JSON.stringify(doc);
  };

  it('Buildings and Stock split out: both totals rows sit in the stripe, reject is byte-identical', async () => {
    await session.call('open', fixtureWithStripedSubtotal());
    const pristine = await session.call<string>('serialize');
    const before = await session.call<Array<string | null>>('rowShading', 'property_premium');
    // header, Buildings, Contents, Stock, Business interruption, Machinery, subtotal
    expect(before.slice(1)).toEqual([null, STRIPE, null, STRIPE, null, STRIPE]);

    const table = await session.call<string>('tableAnchor', 'property_premium');
    const out = await session.call<any>(
      'applyEdits',
      [{ op: 'split_table', group: 'g01-split', anchor: table, rows: [1, 3] }],
      'subtotal-in-stripe'
    );
    expect(out.outcomes).toEqual(['ok']);

    const source = await session.call<Array<string | null>>('rowShading', 'property_premium');
    // Rows 1 and 3 are marked, not gone: survivors Contents, BI, Machinery, subtotal.
    expect([source[2], source[4], source[5], source[6]]).toEqual([null, STRIPE, null, STRIPE]);

    const copy = await session.call<Array<string | null>>('rowShading', 'property_premium_copy');
    // header, Buildings, Stock, subtotal: the cloned subtotal is restriped for its own length.
    expect(copy.slice(1)).toEqual([null, STRIPE, null]);

    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(pristine);
  }, 120000);
});
