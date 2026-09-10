import { HeadlessSession, readFixture, startHeadless } from './headlessSession';

describe('document operation trace', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  it('records requested primitives and whether SFDT or the native editor applied each one', async () => {
    await session.call('open', readFixture('flagship-v4.browser.sfdt.json'));
    const source = await session.call<string>(
      'tableAnchor',
      'property_premium'
    );

    const split = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'duplicate_table',
          group: 'trace-split',
          anchor: source,
          rows: 'copy',
          keepRows: [3, 4, 5]
        },
        {
          op: 'delete_row',
          group: 'trace-split',
          anchor: `${source};3;0;0`,
          rows: [3, 4, 5]
        }
      ],
      'trace-sfdt'
    );
    expect(split.outcomes).toEqual(['ok', 'ok']);

    const title = await session.call<any>(
      'replaceIndexed',
      'Commercial Combined Insurance Proposal',
      'Commercial Combined Insurance Quote',
      'trace-editor'
    );
    expect(title.outcomes).toEqual(['ok']);

    const traces = await session.call<any[]>('traces');
    expect(traces).toHaveLength(2);
    expect(traces[0]).toMatchObject({
      version: 1,
      changeSetId: 'trace-sfdt',
      requested: [{ op: 'duplicate_table' }, { op: 'delete_row' }],
      applied: [
        { op: 'duplicate_table', route: 'engine', mechanism: 'sfdt' },
        { op: 'delete_row', route: 'engine', mechanism: 'sfdt' }
      ]
    });
    expect(traces[0].canonical.map((op: any) => op.op)).toEqual([
      'duplicate_table',
      'delete_row'
    ]);
    expect(traces[0].executed.map((op: any) => op.op)).toEqual([
      'duplicate_table',
      'delete_row'
    ]);
    expect(traces[1]).toMatchObject({
      version: 1,
      changeSetId: 'trace-editor',
      requested: [{ op: 'replace_text' }],
      applied: [
        {
          op: 'replace_text',
          route: 'editor',
          mechanism: 'syncfusion_editor'
        }
      ]
    });
  }, 120000);
});
