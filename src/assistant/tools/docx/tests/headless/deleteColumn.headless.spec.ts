import { buildCostsFixture } from '../../../../../elements/components/DocxEditor/bindings/core/tests/fixtures/costsFixture';
import { HeadlessSession, startHeadless } from './headlessSession';

describe('delete_column dependency contract', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  it.each([
    [1, 'line_total'],
    [3, 'costs_subtotal']
  ])(
    'refuses column %i before mutation when %s depends on it',
    async (column, dependent) => {
      await session.call('open', JSON.stringify(buildCostsFixture()));
      const baseline = await session.call<string>('serialize');
      const tableAnchor = await session.call<string>('tableAnchor', 'costs');

      const result = await session.call<any>(
        'applyEdits',
        [{ op: 'delete_column', anchor: `${tableAnchor};0;${column};0` }],
        `delete-dependent-column-${column}`
      );

      expect(result.outcomes).toEqual(['delete_column_has_dependents']);
      expect(result.messages[0]).toContain(dependent);
      expect(result.groups).toBe(0);
      expect(await session.call<string>('serialize')).toBe(baseline);
    },
    120000
  );

  it('deletes an independent bound column as one tracked replacement and rejects exactly', async () => {
    await session.call('open', JSON.stringify(buildCostsFixture()));
    const baseline = await session.call<string>('serialize');
    const tableAnchor = await session.call<string>('tableAnchor', 'costs');

    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'delete_column',
          group: 'g01-delete-item',
          anchor: `${tableAnchor};0;0;0`
        }
      ],
      'delete-independent-column'
    );

    expect(result.outcomes).toEqual(['ok']);
    expect(result.groups).toBe(1);
    expect(await session.call<number>('tableColumnCount', 'costs')).toBe(3);
    expect(await session.call<string[]>('tableRowTexts', 'costs')).not.toEqual(
      expect.arrayContaining([expect.stringContaining('Item')])
    );

    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(baseline);
  }, 120000);
});
