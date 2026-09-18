import { buildCostsFixture } from '../../../../../elements/components/DocxEditor/bindings/core/tests/fixtures/costsFixture';
import { HeadlessSession, startHeadless } from './headlessSession';

describe('column layout primitive', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  it('widens one column and styles its header as honest untracked formatting', async () => {
    await session.call('open', JSON.stringify(buildCostsFixture()));
    const tableAnchor = await session.call<string>('tableAnchor', 'costs');
    const before = await session.call<number[]>('columnWidths', 'costs');
    const wanted = Math.max(180, Math.ceil(before[2] + 40));

    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'set_column_layout',
          anchor: `${tableAnchor};0;2;0`,
          width: wanted
        },
        {
          op: 'set_cell_format',
          anchor: `${tableAnchor};0;2;0`,
          shading: '#DDEBFF'
        }
      ],
      'format-value-column'
    );

    expect(result.outcomes).toEqual(['ok', 'ok']);
    const after = await session.call<number[]>('columnWidths', 'costs');
    expect(after[2]).toBeCloseTo(wanted, 0);
    expect(after.filter((_width, index) => index !== 2)).toEqual(
      before.filter((_width, index) => index !== 2)
    );
    expect(await session.call<string>('cellShading', 'costs', 0, 2)).toMatch(
      /DDEBFF/i
    );
    expect(result.revisions).toBe(0);
    expect(result.groups).toBe(0);
    const traces = await session.call<any[]>('traces');
    expect(traces).toHaveLength(1);
    expect(traces[0].applied).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          op: 'set_column_layout',
          tracking: 'untracked_formatting'
        }),
        expect.objectContaining({
          op: 'set_cell_format',
          tracking: 'untracked_formatting'
        })
      ])
    );
  }, 120000);

  it('restores the live width when it shares a card with tracked content', async () => {
    await session.call('open', JSON.stringify(buildCostsFixture()));
    const tableAnchor = await session.call<string>('tableAnchor', 'costs');
    const before = await session.call<number[]>('columnWidths', 'costs');
    const heading = (await session.call<any[]>('inventory')).find(
      (entry) => entry.text === 'Project cost estimate'
    );

    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'replace_text',
          group: 'g01-column-review',
          anchor: heading.anchor,
          find: 'Project cost estimate',
          replace: 'Updated project cost estimate',
          expect: 'Project cost estimate'
        },
        {
          op: 'set_column_layout',
          group: 'g01-column-review',
          anchor: `${tableAnchor};0;2;0`,
          width: Math.max(180, Math.ceil(before[2] + 40))
        }
      ],
      'reviewed-column-format'
    );

    expect(result.outcomes).toEqual(['ok', 'ok']);
    expect(result.groups).toBe(1);
    await session.call('resolveGroups', false);
    expect(await session.call<number[]>('columnWidths', 'costs')).toEqual(
      before
    );
    expect(await session.call<any[]>('inventory')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: 'Project cost estimate' })
      ])
    );
  }, 120000);
});
