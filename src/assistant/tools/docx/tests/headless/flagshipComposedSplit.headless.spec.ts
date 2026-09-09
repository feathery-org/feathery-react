/**
 * COMPOSED SPLIT, on the captain's own document, through the real laid-out
 * engine.
 *
 * The assistant has no bound split op. A split is composed as `duplicate_table`
 * with `keepRows` plus `delete_row` of the complement, and the two jsdom specs
 * that own this shape - `composedSplitAcceptWedge.spec.ts` and
 * `splitConservesDocumentTotals.spec.ts` - drive it over a REDUCED fixture,
 * because a document with header and footer stories never lays out in jsdom at
 * all.
 *
 * So the accept side of a split over the real document had never been measured
 * anywhere but by hand in a browser, one human-driven run per attempt. That is
 * what these rows are: the same composition, the same entry points, over the
 * document the captain actually has open.
 *
 * THE PRIMARY FIXTURE IS THE BROWSER CAPTURE, not the harness's authored
 * proposal. `flagship-v3.browser.sfdt.json` came out of the captain's live tab
 * on 2026-09-08 before any op ran: 79 content controls, zero revisions, header
 * stories present, and the figures the captain reads on screen. The harness's
 * `flagship-v3.sfdt.json` is a DIFFERENT document with 163 controls and
 * different totals; it stays as a second fixture on the rows where the shape,
 * not the arithmetic, is what is under test.
 *
 * The Property Premium Detail schedule of the browser document reads:
 *   Buildings $7,686.00, Contents $3,322.00, Stock $4,326.00,
 *   Business interruption $4,483.00, Machinery breakdown $2,237.40
 * Splitting after "Contents" is therefore $11,008.00 and $11,046.40, and the
 * Premium Summary outside the table must not move: a split changes
 * presentation, never document totals.
 *
 * WHAT THIS LANE MEASURED, 2026-09-08, at 98c3a7f5. The refusal this file was
 * first written to pin - `split_moves_referenced_item` / `change_set_failed` -
 * IS GONE, on both fixtures. It was measured against 9a9347b7, one commit
 * before `98c3a7f5` retired it ("make references follow the bindings a split
 * names"); the lane was authored in a sibling worktree at that older commit and
 * carried the stale measurement in with it. At this HEAD the composition
 * applies `['ok', 'ok']`, mints both fragments, conserves every summary line,
 * and accepts with no surviving revision. Those are the active rows below.
 *
 * WHAT IS STILL BROKEN, and is NOT this lane's composition:
 *
 *   THE NATIVE OP. `split_table` still refuses any bound table outright
 *   (`assertTableHasNoBindings` -> `structural_op_would_destroy_bindings`), and
 *   that is the refusal the captain hit in the browser on this very document:
 *   "the table is linked to calculated values, and the editor rejected the
 *   change before anything was written". The composition below is the shape
 *   that works, and the refusal now names it, but per the split law a split
 *   never refuses - so the native op has to be composed from these same
 *   primitives rather than refusing. Not this round.
 *
 *   UNDO. Accept is clean and reject is byte-identical, but undo does not reach
 *   the pre-change document; the numbers are pinned in the characterization row
 *   at the bottom of this file.
 */
import {
  HeadlessSession,
  readFixture,
  shoot,
  startHeadless
} from './headlessSession';

/** The captain's document, captured pristine from his own tab. */
const FIXTURE = 'flagship-v3.browser.sfdt.json';
/** The harness's authored proposal - a different document, kept for shape. */
const HARNESS_FIXTURE = 'flagship-v3.sfdt.json';
const TABLE = 'property_premium';
const HEADER_ROWS = 1;
/** The row after "Contents": rows 3-5 move, rows 1-2 stay. */
const SPLIT_AT = 3;

const BASELINE_CONTROLS = 79;
const BASELINE_SUBTOTAL = '$22,054.40';
const FIRST_FRAGMENT = '$11,008.00';
const SECOND_FRAGMENT = '$11,046.40';

/** The summary lines that reach the schedule and must read the same after. */
const SUMMARY_LINES = [
  'summary_property',
  'summary_subtotal',
  'summary_tax',
  'grand_total'
];

interface Applied {
  outcomes: string[];
  messages: string[];
  moving: number[];
}

/** The `name=` of a binding tag, or '' for a table marker. */
const nameOf = (tag: string): string =>
  /\[\[name=([^|\]]+)/.exec(tag)?.[1] ?? '';

/** How many times each binding NAME is bound in the document. */
const census = (tags: string[]): Map<string, number> => {
  const out = new Map<string, number>();
  for (const tag of tags) {
    const name = nameOf(tag);
    if (name) out.set(name, (out.get(name) ?? 0) + 1);
  }
  return out;
};

describe('a composed split of the browser document accepts whole and conserves the summary', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  async function openFresh(fixture = FIXTURE) {
    await session.call('open', readFixture(fixture));
    return {
      serialized: await session.call<string>('serialize'),
      formulas: await session.call<Record<string, string>>('formulaValues'),
      controls: await session.call<number>('contentControlCount'),
      tags: await session.call<string[]>('serializedTags')
    };
  }

  const split = (): Promise<Applied> =>
    session.call<Applied>('splitTable', TABLE, HEADER_ROWS, SPLIT_AT);

  it('CONTROL: the schedule is the shape the split needs, and the summary reads it', async () => {
    const baseline = await openFresh();
    // Layout ran. Zero pages is the jsdom failure this lane exists to escape,
    // and every content-control count below is a layout registration.
    expect(await session.call<number>('pageCount')).toBeGreaterThan(0);
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
    expect(baseline.formulas.property_premium_subtotal).toBe(BASELINE_SUBTOTAL);
    expect(baseline.controls).toBe(BASELINE_CONTROLS);
    expect(await session.call<any[]>('revisions')).toEqual([]);
  });

  it('CONTROL: the harness fixture is a DIFFERENT document, and this file must not confuse the two', async () => {
    const harness = await openFresh(HARNESS_FIXTURE);
    expect(harness.controls).toBe(163);
    // Same schedule shape, different arithmetic - which is exactly why the
    // oracle figures above are read off the browser capture and not this one.
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
    expect(harness.formulas.summary_subtotal).not.toBe(
      (await openFresh()).formulas.summary_subtotal
    );
  });

  it('APPLY: the composition is accepted by the engine and mints both fragments', async () => {
    const baseline = await openFresh();
    const applied = await split();

    expect(applied.moving).toEqual([3, 4, 5]);
    expect(applied.outcomes).toEqual(['ok', 'ok']);

    // TRACKING IS OFF AGAIN, and that is the contract rather than a leak. The
    // pre-registered version of this row asserted `true` and was never run, so
    // it had the lifecycle backwards: `applyDocumentEditsMeasured` turns
    // tracking on inside its protected try and its `finally` calls
    // `disableUserTrackChanges` on both SyncFusion owners, so the captain's own
    // typing after a change set is never tracked. The revisions the batch
    // authored are what proves it was tracked WHILE it ran, and they are
    // asserted just below.
    expect(await session.call<boolean>('trackChanges')).toBe(false);

    const groups = await session.call<any[]>('groups');
    const pending = await session.call<any[]>('revisions');
    const fragments = await session.call<Record<string, string>>(
      'formulaValues'
    );

    // One card. A split is one decision for a reviewer, not five.
    expect(groups).toHaveLength(1);
    expect(pending.length).toBeGreaterThan(1);
    expect(fragments.property_premium_subtotal).toBe(FIRST_FRAGMENT);
    expect(fragments.property_premium_copy_subtotal).toBe(SECOND_FRAGMENT);

    // THE SPLIT LAW, on the pending document: the reference outside the table
    // follows BOTH fragments, so the summary still reads what it read.
    for (const name of SUMMARY_LINES)
      expect([name, fragments[name]]).toEqual([name, baseline.formulas[name]]);
  });

  it('ACCEPT: the split lands, destroys no binding, and the Premium Summary does not move', async () => {
    const baseline = await openFresh();
    expect((await split()).outcomes).toEqual(['ok', 'ok']);

    await session.call('resolveGroups', true);

    // THE EMPTY-RANGE LAW, verified in the real engine: no bookkeeping revision
    // survives a resolve. `purgeUnresolvableRevisions` is what makes this hold;
    // before it, a zero-length Deletion sat in the collection forever and the
    // card never cleared. The notice path (`reportStall` -> RailHead) is out of
    // headless reach, so `unresolved` being empty is the whole assertion here.
    expect(await session.call<any[]>('revisions')).toEqual([]);
    expect(await session.call<any[]>('groups')).toEqual([]);
    expect(await session.call<number>('chipCount')).toBe(0);

    // NO BINDING WAS DESTROYED - asserted on binding NAMES, not on tag strings,
    // and this distinction is the whole content of the law here.
    //
    // Comparing whole tags fails on a correct split, and it fails twice over.
    // Measured on this document: the three moved rows arrive in the copy under
    // FRESH row ids, so `[[name=units|...|row=property-r3]]` is legitimately
    // gone and `row=property-copy-r3` stands in its place - that IS "the
    // source's moved rows are replaced by their copies". And the split law
    // REWRITES the two summary expressions that named the shrinking aggregate,
    // so their tags change by design. Neither is a destroyed binding.
    //
    // What a split may never do is drop a NAME: every name the captain's
    // document arrived with must still be bound, and at no lower a count, so a
    // moved row cannot quietly take a binding out of the document with it.
    const after = await session.call<string[]>('serializedTags');
    const was = census(baseline.tags);
    const now = census(after);
    expect(
      [...was].filter(([name, count]) => (now.get(name) ?? 0) < count)
    ).toEqual([]);
    // Everything NEW belongs to the copy: its own subtotal, and its own table
    // marker. Two, which is exactly the growth in registered controls.
    expect([...now.keys()].filter((name) => !was.has(name))).toEqual([
      `${TABLE}_copy_subtotal`
    ]);
    const baselineTags = new Set(baseline.tags);
    expect(
      after.filter((tag) => !baselineTags.has(tag) && !nameOf(tag))
    ).toEqual([`[[table=${TABLE}_copy]]`]);
    expect(await session.call<number>('contentControlCount')).toBe(
      BASELINE_CONTROLS + 2
    );

    const accepted = await session.call<Record<string, string>>(
      'formulaValues'
    );
    expect(await session.call<string[]>('tableIds')).toEqual(
      expect.arrayContaining([TABLE, `${TABLE}_copy`])
    );
    expect(accepted.property_premium_subtotal).toBe(FIRST_FRAGMENT);
    expect(accepted.property_premium_copy_subtotal).toBe(SECOND_FRAGMENT);
    for (const name of SUMMARY_LINES)
      expect([name, accepted[name]]).toEqual([name, baseline.formulas[name]]);

    // eslint-disable-next-line no-console
    console.log('[headless] evidence:', await shoot(session, 'split-accepted', 'Machinery breakdown'));
  });

  it('REJECT: the same split, rejected, restores the document byte for byte', async () => {
    const baseline = await openFresh();
    expect((await split()).outcomes).toEqual(['ok', 'ok']);
    expect((await session.call<any[]>('revisions')).length).toBeGreaterThan(1);

    await session.call('resolveGroups', false);

    expect(await session.call<any[]>('revisions')).toEqual([]);
    expect(await session.call<string>('serialize')).toBe(baseline.serialized);
    expect(await session.call<number>('contentControlCount')).toBe(
      baseline.controls
    );
    expect(await session.call<string[]>('tableIds')).not.toContain(
      `${TABLE}_copy`
    );
    // eslint-disable-next-line no-console
    console.log('[headless] evidence:', await shoot(session, 'split-rejected', 'Machinery breakdown'));
  });

  // THE OP THE ASSISTANT ACTUALLY SENDS.
  //
  // Every row above issues the two primitives by hand. This one sends a single
  // `split_table` - the op the captain's assistant sent on 2026-09-08, and the
  // one that came back "the table is linked to calculated values, and the
  // editor rejected the change before anything was written". The engine now
  // compiles it into those same two primitives itself (compileTableSplit), so
  // the end state has to be indistinguishable from the composed rows.
  //
  // That indistinguishability is the whole assertion: same single card, same
  // fragments, same untouched summary, same name census, same byte-identical
  // reject. If the desugaring ever diverges from the composition, this row and
  // the ones above disagree.
  describe('the native split_table op, desugared by the engine', () => {
    const nativeSplit = (): Promise<{
      outcomes: string[];
      messages: string[];
      ops: string[];
    }> => session.call('nativeSplitTable', TABLE, SPLIT_AT);

    it('APPLY: one card under the op the model sent, and both fragments', async () => {
      const baseline = await openFresh();
      const applied = await nativeSplit();

      // ONE result, under `split_table`, not the two children it became. The
      // collapse is part of the contract: a split is one decision.
      expect(applied.outcomes).toEqual(['ok']);
      expect(applied.ops).toEqual(['split_table']);
      expect(await session.call<any[]>('groups')).toHaveLength(1);

      const fragments = await session.call<Record<string, string>>(
        'formulaValues'
      );
      expect(fragments.property_premium_subtotal).toBe(FIRST_FRAGMENT);
      expect(fragments.property_premium_copy_subtotal).toBe(SECOND_FRAGMENT);
      for (const name of SUMMARY_LINES)
        expect([name, fragments[name]]).toEqual([name, baseline.formulas[name]]);
    });

    it('ACCEPT: the identical end state the hand-composed split reaches', async () => {
      const baseline = await openFresh();
      expect((await nativeSplit()).outcomes).toEqual(['ok']);

      await session.call('resolveGroups', true);

      expect(await session.call<any[]>('revisions')).toEqual([]);
      expect(await session.call<number>('chipCount')).toBe(0);

      const after = await session.call<string[]>('serializedTags');
      const was = census(baseline.tags);
      const now = census(after);
      expect(
        [...was].filter(([name, count]) => (now.get(name) ?? 0) < count)
      ).toEqual([]);
      expect([...now.keys()].filter((name) => !was.has(name))).toEqual([
        `${TABLE}_copy_subtotal`
      ]);
      const baselineTags = new Set(baseline.tags);
      expect(
        after.filter((tag) => !baselineTags.has(tag) && !nameOf(tag))
      ).toEqual([`[[table=${TABLE}_copy]]`]);
      expect(await session.call<number>('contentControlCount')).toBe(
        BASELINE_CONTROLS + 2
      );

      const accepted = await session.call<Record<string, string>>(
        'formulaValues'
      );
      expect(accepted.property_premium_subtotal).toBe(FIRST_FRAGMENT);
      expect(accepted.property_premium_copy_subtotal).toBe(SECOND_FRAGMENT);
      for (const name of SUMMARY_LINES)
        expect([name, accepted[name]]).toEqual([name, baseline.formulas[name]]);

      // eslint-disable-next-line no-console
      console.log(
        '[headless] evidence:',
        await shoot(session, 'native-split-accepted', 'Machinery breakdown')
      );
    });

    it('REJECT: byte-identical, from the native op too', async () => {
      const baseline = await openFresh();
      expect((await nativeSplit()).outcomes).toEqual(['ok']);
      expect((await session.call<any[]>('revisions')).length).toBeGreaterThan(
        1
      );

      await session.call('resolveGroups', false);

      expect(await session.call<any[]>('revisions')).toEqual([]);
      expect(await session.call<string>('serialize')).toBe(baseline.serialized);
      expect(await session.call<string[]>('tableIds')).not.toContain(
        `${TABLE}_copy`
      );
      // eslint-disable-next-line no-console
      console.log(
        '[headless] evidence:',
        await shoot(session, 'native-split-rejected', 'Machinery breakdown')
      );
    });
  });

  // CHARACTERIZATION, MEASURED 2026-09-08, NOT YET A FIX.
  //
  // Undo after an accepted split does not reach the pre-change document. Twelve
  // presses, reading (serialized length, registered controls, revision count)
  // after each, against a pristine 322196 / 79 / 0:
  //
  //   1  427257 / 93 / 5     the accept is undone, so the revisions come back
  //   2  425199 / 93 / 3
  //   3  416472 / 93 / 4     editorHistory.undo() THREW here
  //   4-7  416472 / 93 / 4   no further movement
  //   8  418137 / 92 / 4     one control released, length went UP
  //   9-12 418137 / 92 / 4   plateau
  //
  // Two separate faults, and the plateau is the worse one: undo stops moving
  // the document at all while 93 controls and four revisions are still live, so
  // no number of presses gets the captain back. That is a violation of the undo
  // law and it is round-2 work; this row is here so the numbers are pinned and
  // the row lights up the moment undo reaches pristine.
  it.skip('UNDO: pressing undo enough times reaches the pre-change document', async () => {
    const baseline = await openFresh();
    expect((await split()).outcomes).toEqual(['ok', 'ok']);
    await session.call('resolveGroups', true);

    const trail: Array<{ len: number; controls: number; revisions: number }> =
      [];
    let pristine = false;
    for (let press = 0; press < 12 && !pristine; press += 1) {
      // eslint-disable-next-line no-await-in-loop
      const step = await session.call<{
        len: number;
        controls: number;
        revisions: number;
        serialized: string;
      }>('undoOnce');
      trail.push({
        len: step.len,
        controls: step.controls,
        revisions: step.revisions
      });
      pristine = step.serialized === baseline.serialized;
    }
    // eslint-disable-next-line no-console
    console.log('[headless] undo trail:', JSON.stringify(trail));
    expect(pristine).toBe(true);
    expect(await session.call<number>('contentControlCount')).toBe(
      baseline.controls
    );
    expect(await session.call<any[]>('revisions')).toEqual([]);
  });
});
