import { HeadlessSession, readFixture, startHeadless } from './headlessSession';

describe('atomic bound row insertion', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  it('allows the row primitive to stand alone and rejects it cleanly', async () => {
    await session.call('open', readFixture('flagship-v4d.browser.sfdt.json'));
    const source = await session.call<string>('tableAnchor', 'property_premium');
    const before = await session.call<string[]>('tableRowTexts', 'property_premium');
    const controlsBefore = await session.call<number>('contentControlCount');

    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'insert_row',
          group: 'g01-add-signage',
          anchor: `${source};5;0;0`
        }
      ],
      'atomic-bound-row'
    );

    expect(result.outcomes).toEqual(['ok']);
    expect(
      await session.call<string[]>('tableRowTexts', 'property_premium')
    ).toHaveLength(before.length + 1);
    expect(await session.call<number>('contentControlCount')).toBeGreaterThan(
      controlsBefore
    );
    expect(await session.call<any[]>('groups')).toHaveLength(1);

    await session.call('resolveGroups', false);
    expect(
      await session.call<string[]>('tableRowTexts', 'property_premium')
    ).toEqual(before);
    expect(await session.call<number>('contentControlCount')).toBe(
      controlsBefore
    );
  }, 120000);
});
