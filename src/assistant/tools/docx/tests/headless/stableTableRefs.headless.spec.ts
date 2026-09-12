import { HeadlessSession, readFixture, startHeadless } from './headlessSession';

const SOURCE = 'property_premium';
const COPY = 'property_premium_copy';

describe('stable references compose table primitives in one message', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  const applyNoncontiguousSplit = async () => {
    const source = await session.call<string>('tableAnchor', SOURCE);
    return session.call<any>(
      'applyEdits',
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
      'split-stock-and-machinery'
    );
  };

  beforeEach(async () => {
    await session.call('open', readFixture('flagship-v4d.browser.sfdt.json'));
  });

  it('resolves @copy without predicting its shifted anchor', async () => {
    const result = await applyNoncontiguousSplit();

    expect(result.outcomes).toEqual(['ok', 'ok', 'ok']);
    expect(await session.call<any[]>('groups')).toHaveLength(1);
    const pendingSource = await session.call<string[]>('tableRowTexts', SOURCE);
    expect(pendingSource).toContain('Subsection subtotal$22,054.40$15,491.00');
    expect(
      await session.call<Record<string, string>>('formulaValues')
    ).toMatchObject({
      property_premium_subtotal: '$15,491.00',
      property_premium_copy_subtotal: '$6,563.40',
      summary_property: '$22,054.40',
      summary_subtotal: '$75,667.35'
    });
  }, 120000);

  it('accepts with fresh controls and first-item-white striping', async () => {
    const applied = await applyNoncontiguousSplit();
    expect(applied.outcomes).toEqual(['ok', 'ok', 'ok']);
    expect(
      applied.warnings.filter((warning: string) =>
        warning.includes('appearance')
      )
    ).toEqual([]);
    await session.call('resolveGroups', true);

    expect(await session.call<number>('contentControlCount')).toBe(86);
    expect(
      await session.call<Array<string | null>>('rowShading', SOURCE)
    ).toEqual(['#001B49FF', null, '#E6E6E6FF', null, null]);
    expect(
      await session.call<Array<string | null>>('rowShading', COPY)
    ).toEqual(['#001B49FF', null, '#E6E6E6FF', null]);
  }, 120000);

  it('rejects the entire primitive chain to the exact original document', async () => {
    const original = await session.call<string>('serialize');
    expect((await applyNoncontiguousSplit()).outcomes).toEqual([
      'ok',
      'ok',
      'ok'
    ]);
    await session.call('resolveGroups', false);

    expect(await session.call<any[]>('groups')).toEqual([]);
    expect(await session.call<number>('contentControlCount')).toBe(84);
    expect(await session.call<string>('serialize')).toBe(original);
  }, 120000);
});
