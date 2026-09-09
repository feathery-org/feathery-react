/**
 * UNDO ATTRIBUTION. Identical bytes in the master and slice3 worktrees.
 *
 * The question is narrow: after the app accepts its own tracked change set,
 * does pressing undo enough times get the document back? Slice3's split does
 * not reach pristine. A split does not exist on master (it was refused there),
 * so the change set here is the simplest tracked edit BOTH branches support -
 * one bound `delete_row` - which isolates the undo machinery from anything the
 * slice changed about splits.
 */
import { HeadlessSession, readFixture, startHeadless } from './headlessSession';

const FIXTURE = 'flagship-v3.browser.sfdt.json';

describe('undo after an accepted tracked delete_row', () => {
  let session: HeadlessSession;
  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);
  afterAll(async () => {
    await session?.close();
  });

  it('records how far undo gets', async () => {
    await session.call('open', readFixture(FIXTURE));
    const baseline = await session.call<any>('snapshot');
    const applied = await session.call<any>(
      'deleteRow',
      'property_premium',
      3
    );
    const pending = await session.call<any>('snapshot');
    const groups = await session.call<any[]>('groups');
    await session.call('resolveGroups', true);
    const accepted = await session.call<any>('snapshot');

    const trail: any[] = [];
    let pristine = false;
    for (let press = 0; press < 12 && !pristine; press += 1) {
      // eslint-disable-next-line no-await-in-loop
      const step = await session.call<any>('undoOnce');
      pristine = step.serialized === baseline.serialized;
      trail.push({
        ok: step.ok,
        len: step.len,
        controls: step.controls,
        revisions: step.revisions,
        pristine
      });
    }
    // eslint-disable-next-line no-console
    console.log(
      'UNDO_ATTRIBUTION ' +
        JSON.stringify(
          {
            applied,
            baseline: {
              len: baseline.len,
              controls: baseline.controls,
              revisions: baseline.revisions
            },
            pending: {
              len: pending.len,
              controls: pending.controls,
              revisions: pending.revisions
            },
            groups: groups.length,
            accepted: {
              len: accepted.len,
              controls: accepted.controls,
              revisions: accepted.revisions
            },
            reachedPristine: pristine,
            trail
          },
          null,
          1
        )
    );
  }, 180000);
});
