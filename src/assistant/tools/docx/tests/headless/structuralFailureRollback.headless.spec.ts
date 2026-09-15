import { buildCostsFixture } from '../../../../../elements/components/DocxEditor/bindings/core/tests/fixtures/costsFixture';
import { HeadlessSession, readFixture, startHeadless } from './headlessSession';

describe('a failed structural primitive chain is atomic', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  it('removes an already-pasted copy when a later native row delete fails', async () => {
    await session.call('open', readFixture('flagship-v4d.browser.sfdt.json'));
    const original = await session.call<string>('serialize');
    const source = await session.call<string>(
      'tableAnchor',
      'property_premium'
    );

    const result = await session.call<any>(
      'applyEditsWithNativeFailure',
      [
        {
          op: 'duplicate_table',
          group: 'g01-split-property',
          anchor: source,
          rows: 'copy',
          resultRef: '@copy'
        },
        {
          op: 'delete_row',
          group: 'g01-split-property',
          anchor: '@copy',
          rows: [1, 2, 4]
        },
        {
          op: 'delete_row',
          group: 'g01-split-property',
          anchor: source,
          rows: [3, 5]
        }
      ],
      'split-native-failure',
      'deleteRow',
      1
    );

    expect(result.status).toBe('failed');
    expect(result.outcomes).toContain('engine_apply_failed');
    expect(result.groups).toBe(0);
    expect(await session.call<string>('serialize')).toBe(original);
    expect(await session.call<number>('contentControlCount')).toBe(84);
  }, 120000);

  it('restores a structural edit when its derived value write fails', async () => {
    await session.call('open', JSON.stringify(buildCostsFixture()));
    const source = await session.call<string>('tableAnchor', 'costs');
    const originalRows = await session.call<string[]>('tableRowTexts', 'costs');
    const originalFormulas = await session.call<Record<string, string>>(
      'formulaValues'
    );
    const originalControls = await session.call<number>('contentControlCount');

    const result = await session.call<any>(
      'applyEditsWithNativeFailure',
      [
        {
          op: 'delete_row',
          group: 'g01-delete-cost',
          anchor: `${source};1;0;0`,
          rows: [1]
        }
      ],
      'delete-with-derived-failure',
      'updateContentControl',
      1,
      'throw'
    );

    expect(result.status).toBe('failed');
    expect(result.outcomes).toContain('engine_apply_failed');
    expect(result.groups).toBe(0);
    expect(await session.call<string[]>('tableRowTexts', 'costs')).toEqual(
      originalRows
    );
    expect(await session.call<Record<string, string>>('formulaValues')).toEqual(
      originalFormulas
    );
    expect(await session.call<number>('contentControlCount')).toBe(
      originalControls
    );
  }, 120000);
});
