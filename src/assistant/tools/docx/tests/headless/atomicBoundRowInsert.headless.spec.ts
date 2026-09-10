import { HeadlessSession, readFixture, startHeadless } from './headlessSession';

describe('atomic bound row insertion', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  it('refuses a populated-row request before a bare row can land', async () => {
    await session.call('open', readFixture('flagship-v4.browser.sfdt.json'));
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

    expect(result.outcomes).toEqual(['row_insert_requires_values']);
    expect(await session.call<string[]>('tableRowTexts', 'property_premium')).toEqual(before);
    expect(await session.call<number>('contentControlCount')).toBe(controlsBefore);
    expect(await session.call<any[]>('groups')).toHaveLength(0);

    const blank = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'insert_row',
          group: 'g02-add-blank-row',
          anchor: `${source};5;0;0`,
          allowEmpty: true
        }
      ],
      'explicit-blank-bound-row'
    );
    expect(blank.outcomes).toEqual(['ok']);
    expect(await session.call<string[]>('tableRowTexts', 'property_premium')).toHaveLength(before.length + 1);
    expect(await session.call<number>('contentControlCount')).toBeGreaterThan(controlsBefore);
  }, 120000);
});
