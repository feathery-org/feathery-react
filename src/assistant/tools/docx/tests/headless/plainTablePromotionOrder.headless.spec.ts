import { buildCostsFixture } from '../../../../../elements/components/DocxEditor/bindings/core/tests/fixtures/costsFixture';
import { HeadlessSession, startHeadless } from './headlessSession';

// Two plain tables, each holding "$700", separated by body paragraphs: the
// shape of a new policy section above a premium summary.
function twoPlainTables(): string {
  const sfdt: any = JSON.parse(JSON.stringify(buildCostsFixture()));
  const blocks = sfdt.sections[0].blocks;
  const marker = blocks.find((block: any) =>
    String(block?.contentControlProperties?.tag ?? '').includes('table=costs')
  );
  const table = marker.blocks.find((block: any) => Array.isArray(block?.rows));
  for (const row of table.rows)
    for (const cell of row.cells) {
      delete cell.contentControlProperties;
      cell.blocks = [{ inlines: [{ text: 'Item' }] }];
    }
  table.rows = table.rows.slice(0, 2);
  table.rows[1].cells[1].blocks = [{ inlines: [{ text: '$700' }] }];
  const paragraph = (text: string) => ({ inlines: [{ text }] });
  sfdt.sections[0].blocks = [
    paragraph('Policy'),
    JSON.parse(JSON.stringify(table)),
    paragraph('Premium Summary'),
    JSON.parse(JSON.stringify(table)),
    paragraph('End')
  ];
  return JSON.stringify(sfdt);
}

describe('promoting several plain tables in one change set', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  it('binds a cell in each table even when the upper table is listed first', async () => {
    await session.call('open', twoPlainTables());
    const result = await session.call<any>(
      'applyEdits',
      ['0;1;1;1;0', '0;3;1;1;0'].map((anchor) => ({
        op: 'create_binding',
        group: 'g01-link-premium',
        anchor,
        expect: '$700',
        kind: 'input',
        name: 'collectible_premium',
        valueType: 'currency:USD:2',
        global: true
      })),
      'link-premium'
    );

    expect(result.outcomes).toEqual(['ok', 'ok']);
    const tags = await session.call<string[]>('serializedTags');
    expect(
      tags.filter((tag) => tag.includes('name=collectible_premium'))
    ).toHaveLength(2);
  }, 120000);
});
