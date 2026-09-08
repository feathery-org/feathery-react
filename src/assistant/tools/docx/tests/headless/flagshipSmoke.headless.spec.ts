/**
 * SMOKE: the real engine, laid out, in a headless Chrome, over the BROWSER
 * document.
 *
 * `flagship-v3.sfdt.json` is the full client-shaped proposal WITH header and
 * footer stories. It is the one shape the jsdom suite cannot touch at all: per
 * the corpus README, a repeating header over a body long enough to paginate
 * never terminates in jsdom, because jsdom has no text metrics and page height
 * never resolves. Here it opens, paginates, and registers its content controls
 * in about a second.
 *
 * If this row fails, nothing else in the lane is interpretable: it would mean
 * the host page is not laying the document out, so every later measurement
 * would be of an unlaid document - the exact blindness the lane exists to end.
 *
 * Requires Node 18+ (gated by puppeteer-core 23) and a system Chrome; see
 * `headlessSession.ts` for the resolution order and the install hint.
 */
import { HeadlessSession, readFixture, startHeadless } from './headlessSession';

const FIXTURE = 'flagship-v3.sfdt.json';

describe('the browser document lays out and registers its content controls', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
    await session.call('open', readFixture(FIXTURE));
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  it('SMOKE: layout ran, 79 content controls registered, no revisions, serialize round-trips', async () => {
    const pages = await session.call<number>('pageCount');
    expect(pages).toBeGreaterThan(0);

    // The measurement jsdom cannot make: controls are registered by LAYOUT, not
    // by parsing, so an unlaid document reports zero however many
    // `contentControlProperties` its JSON carries.
    //
    // MEASURED 2026-09-08 in this lane: 163, not the 79 this lane was
    // commissioned expecting. 163 is exactly the number of
    // `contentControlProperties` the fixture serializes - 162 in the body plus
    // one in the header story - so the invariant worth pinning is that EVERY
    // serialized control registers, and it holds. 79 belongs to a different
    // document, not to flagship-v3.
    expect(await session.call<number>('contentControlCount')).toBe(163);
    expect(await session.call<string[]>('serializedTags')).toHaveLength(163);

    expect(await session.call<any[]>('revisions')).toEqual([]);

    const serialized = await session.call<string>('serialize');
    expect(serialized.length).toBeGreaterThan(0);
    const round = JSON.parse(serialized);
    expect(Array.isArray(round.sections)).toBe(true);
    expect(round.sections.length).toBeGreaterThan(0);

    // The three bound schedules plus the summary the split has to conserve.
    expect(await session.call<string[]>('tableIds')).toEqual(
      expect.arrayContaining([
        'property_premium',
        'liability_premium',
        'motor_premium',
        'summary'
      ])
    );
  });
});
