import { HeadlessSession, readFixture, startHeadless } from './headlessSession';

/**
 * Every way the schema lets the model name a table lands the same split.
 *
 * Captured on the captain's rig, one request, four engine calls: the model's
 * first and correct `split_table {anchor:"1;10", rows:[1,3]}` was refused
 * (structural_op_would_destroy_bindings - the split compiler only knew cell
 * anchors, so the op fell through to the native path); its recommended
 * `duplicate_table {table} + delete_row {anchor:"1;10"}` failed with
 * missing_anchor / anchor_not_found; only two separate calls landed, as two
 * cards. The table's own anchor, a bound table id, and a cell anchor are one
 * address, resolved once before anything plans.
 */
const TABLE = 'property_premium';
const ROWS = [1, 3];

describe('a table-scoped op accepts the table anchor, the table id, or a cell anchor alike', () => {
  let session: HeadlessSession;
  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);
  afterAll(async () => {
    await session?.close();
  });

  async function fresh() {
    await session.call('open', readFixture('flagship-v3.browser.sfdt.json'));
    return session.call<string>('tableAnchor', TABLE);
  }

  it('split_table by the table anchor with non-adjacent rows: one call, one group', async () => {
    const table = await fresh();
    const out = await session.call<any>(
      'applyEdits',
      [{ op: 'split_table', group: 'g01-split', anchor: table, rows: ROWS }],
      'anchor-forms-split'
    );
    expect(out.outcomes).toEqual(['ok']);
    expect(out.groups).toBe(1);
    // Revision ids are random, so two runs never match byte for byte; the
    // structural outcome does.
    const byTableAnchor = await session.call<number>('contentControlCount');

    const cell = `${await fresh()};${ROWS[0]};0;0`;
    const cellForm = await session.call<any>(
      'applyEdits',
      [{ op: 'split_table', group: 'g01-split', anchor: cell, rows: ROWS }],
      'anchor-forms-split'
    );
    expect(cellForm.outcomes).toEqual(['ok']);
    expect(await session.call<number>('contentControlCount')).toBe(byTableAnchor);
    expect(cellForm.groups).toBe(1);
  }, 120000);

  it('the recommended pair, duplicate_table by table id plus delete_row by table anchor, in ONE change set is one group', async () => {
    const table = await fresh();
    const out = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'duplicate_table',
          group: 'g01-split',
          table: TABLE,
          rows: 'copy',
          keepRows: ROWS
        },
        { op: 'delete_row', group: 'g01-split', anchor: table, rows: ROWS }
      ],
      'anchor-forms-pair'
    );
    expect(out.outcomes).toEqual(['ok', 'ok']);
    expect(out.groups).toBe(1);
  }, 120000);
});
