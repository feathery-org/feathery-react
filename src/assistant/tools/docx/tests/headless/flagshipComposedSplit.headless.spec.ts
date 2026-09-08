/**
 * COMPOSED SPLIT, on the browser document, through the real laid-out engine.
 *
 * The assistant has no split op. A split is composed as `duplicate_table` with
 * `keepRows` plus `delete_row` of the complement, and the two jsdom specs that
 * own this shape - `composedSplitAcceptWedge.spec.ts` and
 * `splitConservesDocumentTotals.spec.ts` - drive it over SYNTHETIC fixtures,
 * because the client-shaped document with header and footer stories never lays
 * out in jsdom at all.
 *
 * So the accept side of a split over the real document had never been measured
 * anywhere but by hand in a browser, one human-driven run per attempt. That is
 * what this row is: the same composition, the same entry points, over
 * `flagship-v3` - the 163-content-control proposal - laid out for real, in
 * seconds.
 *
 * The Property Premium Detail schedule reads:
 *   Buildings $7686.00, Contents $3322.00, Stock $4326.00,
 *   Business interruption $4483.00, Machinery breakdown $2237.40
 * Splitting after "Contents" is therefore $11,008.00 and $11,046.40, and the
 * Premium Summary outside the table must not move: a split changes
 * presentation, never document totals.
 *
 * WHAT THIS LANE MEASURED, FIRST RUN, 2026-09-08. The split never reaches the
 * revision group at all. `applyDocumentEdits` REFUSES it:
 *
 *   split_moves_referenced_item / change_set_failed
 *   'This split cannot be applied. "line_total" outside the table reads
 *    "units", which is one item's own figure rather than a total, and the split
 *    moves that item into the second table. [...]'
 *
 * `line_total` is not outside the table. It is the per-row cell formula of the
 * schedule's own item rows (`[[name=line_total|expr=mul(units,rate)|row=property-r3]]`),
 * and `units` is that same row's own field. The referenced-item guard's
 * in-fragment exemption - `splitPaths.some((path) => pathContains(path,
 * occurrence.path))` in `syncfusionDocumentOps.ts` - does not exempt them, so a
 * row formula travelling WITH its row is read as an outside total pointing at
 * nothing, and the whole change set rolls back.
 *
 * Per this round's brief the engine is NOT fixed here; the measurement is the
 * deliverable. So the refusal is pinned as an active row below (a refusal must
 * at least leave the document untouched, and it does), and the two
 * pre-registered rows it blocks are `it.skip` with the measured values, ready to
 * light up the moment the guard stops firing on a row's own formula.
 *
 * The synthetic fixtures the jsdom specs use split cleanly, which is why this
 * was invisible: `flagship-v3` carries header and footer stories, and per the
 * corpus README that shape never lays out in jsdom, so no jest run had ever
 * driven a split over it.
 */
import { HeadlessSession, readFixture, startHeadless } from './headlessSession';

const FIXTURE = 'flagship-v3.sfdt.json';
const TABLE = 'property_premium';
const HEADER_ROWS = 1;
/** The row after "Contents": rows 3-5 move, rows 1-2 stay. */
const SPLIT_AT = 3;

const FIRST_FRAGMENT = '$11,008.00';
const SECOND_FRAGMENT = '$11,046.40';

/** The summary lines that reach the schedule and must read the same after. */
const SUMMARY_LINES = [
  'summary_property',
  'summary_subtotal',
  'summary_tax',
  'grand_total'
];

describe('a composed split of the browser document accepts whole and conserves the summary', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  async function openFresh() {
    await session.call('open', readFixture(FIXTURE));
    return {
      serialized: await session.call<string>('serialize'),
      formulas: await session.call<Record<string, string>>('formulaValues'),
      controls: await session.call<number>('contentControlCount'),
      tags: await session.call<string[]>('serializedTags')
    };
  }

  it('CONTROL: the schedule is the shape the split needs, and the summary reads it', async () => {
    const baseline = await openFresh();
    expect(
      await session.call<string[]>('tableRoles', TABLE, HEADER_ROWS)
    ).toEqual([
      'header',
      'item',
      'item',
      'item',
      'item',
      'item',
      'aggregate'
    ]);
    const rows = await session.call<string[]>('tableRowTexts', TABLE);
    expect(rows[2]).toContain('Contents');
    expect(
      (await session.call<Record<string, string>>('formulaExpressions'))
        .summary_property
    ).toBe('property_premium_subtotal');
    expect(baseline.controls).toBe(163);
    expect(await session.call<any[]>('revisions')).toEqual([]);
  });

  it('REFUSAL, measured 2026-09-08: the guard fires on a row\'s own formula, and rolls the document back whole', async () => {
    const baseline = await openFresh();
    const applied = await session.call<{
      outcomes: string[];
      messages: string[];
      moving: number[];
    }>('splitTable', TABLE, HEADER_ROWS, SPLIT_AT);

    expect(applied.moving).toEqual([3, 4, 5]);
    expect(applied.outcomes).toEqual([
      'split_moves_referenced_item',
      'change_set_failed'
    ]);
    // The refusal names the row formula it mistook for an outside total, and
    // the moved row's own field it thinks that total now points at.
    expect(applied.messages[0]).toContain('"line_total"');
    expect(applied.messages[0]).toContain('"units"');
    expect(applied.messages[0]).not.toMatch(/undefined|\[object|scanBindings/);

    // Whatever else is wrong, a refusal must cost the captain nothing: no
    // revision, no fragment, no expression rewrite, not one byte.
    expect(await session.call<any[]>('revisions')).toEqual([]);
    expect(await session.call<number>('contentControlCount')).toBe(
      baseline.controls
    );
    expect(await session.call<string>('serialize')).toBe(baseline.serialized);
    expect(await session.call<string[]>('tableIds')).not.toContain(
      `${TABLE}_copy`
    );
  });

  // PRE-REGISTERED, BLOCKED. Measured 2026-09-08: apply returns
  // ['split_moves_referenced_item', 'change_set_failed'] instead of ['ok','ok'],
  // so there is no group to accept - 0 revisions, 0 chips, no
  // `property_premium_copy`, and the $11,008.00 / $11,046.40 fragments are never
  // minted. Unskip when the referenced-item guard exempts a row's own formula.
  it.skip('COMPOSED SPLIT: one group, two fragments, accept leaves the document whole', async () => {
    const baseline = await openFresh();
    const applied = await session.call<{
      outcomes: string[];
      messages: string[];
      moving: number[];
    }>('splitTable', TABLE, HEADER_ROWS, SPLIT_AT);
    expect(applied.outcomes).toEqual(['ok', 'ok']);
    expect(applied.moving).toEqual([3, 4, 5]);

    // The engine turns track changes on inside `applyDocumentEdits`; nothing
    // here sets it, so this asserts the engine did.
    expect(await session.call<boolean>('trackChanges')).toBe(true);

    const groups = await session.call<any[]>('groups');
    const pending = await session.call<any[]>('revisions');
    const split = await session.call<Record<string, string>>('formulaValues');

    expect(groups).toHaveLength(1);
    expect(pending.length).toBeGreaterThan(1);
    expect(split.property_premium_subtotal).toBe(FIRST_FRAGMENT);
    expect(split.property_premium_copy_subtotal).toBe(SECOND_FRAGMENT);

    await session.call('resolveGroups', true);

    const survivors = await session.call<any[]>('revisions');
    const controlsAfter = await session.call<number>('contentControlCount');
    const baselineTags = new Set<string>(baseline.tags);
    if (survivors.length || controlsAfter !== baseline.controls)
      // eslint-disable-next-line no-console
      console.log(
        '[headless] MEASURED after accept:',
        JSON.stringify(
          {
            survivors,
            controlsAfter,
            baselineControls: baseline.controls,
            newTags: (await session.call<string[]>('serializedTags')).filter(
              (tag) => !baselineTags.has(tag)
            )
          },
          null,
          1
        )
      );

    expect(survivors).toEqual([]);
    expect(controlsAfter).toBe(baseline.controls);

    const accepted = await session.call<Record<string, string>>('formulaValues');
    expect(await session.call<string[]>('tableIds')).toEqual(
      expect.arrayContaining([TABLE, `${TABLE}_copy`])
    );
    expect(accepted.property_premium_subtotal).toBe(FIRST_FRAGMENT);
    expect(accepted.property_premium_copy_subtotal).toBe(SECOND_FRAGMENT);
    for (const name of SUMMARY_LINES)
      expect([name, accepted[name]]).toEqual([name, baseline.formulas[name]]);
  });

  // PRE-REGISTERED, BLOCKED by the same measured refusal: with no revision to
  // reject, the byte-for-byte restore is what the REFUSAL row above already
  // proves for the rollback path. Unskip alongside the row above.
  it.skip('REJECT: the same split, rejected, restores the document byte for byte', async () => {
    const baseline = await openFresh();
    expect(
      (
        await session.call<{ outcomes: string[] }>(
          'splitTable',
          TABLE,
          HEADER_ROWS,
          SPLIT_AT
        )
      ).outcomes
    ).toEqual(['ok', 'ok']);
    expect((await session.call<any[]>('revisions')).length).toBeGreaterThan(1);

    await session.call('resolveGroups', false);

    expect(await session.call<any[]>('revisions')).toEqual([]);
    expect(await session.call<string>('serialize')).toBe(baseline.serialized);
  });
});
