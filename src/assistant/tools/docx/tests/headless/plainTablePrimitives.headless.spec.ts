import { HeadlessSession, readFixture, startHeadless } from './headlessSession';

describe('one table primitive surface for plain tables', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  beforeEach(async () => {
    await session.call('open', readFixture('flagship-v4d.browser.sfdt.json'));
  });

  it('inserts, fills, accepts, and rejects a column through the shared operations', async () => {
    const baseline = await session.call<string>('serialize');
    const controls = await session.call<number>('contentControlCount');
    const source = await session.call<string>(
      'tableAnchorContaining',
      'Fire and explosion'
    );

    const operations = [
      {
        op: 'insert_column',
        group: 'g01-add-notes',
        anchor: `${source};0;1;0`,
        position: 'after',
        resultRef: '@notes'
      },
      {
        op: 'set_column_layout',
        group: 'g01-add-notes',
        anchor: '@notes;0;0',
        width: 120
      },
      {
        op: 'set_cell_text',
        group: 'g01-add-notes',
        anchor: '@notes;0;0',
        text: 'Notes'
      },
      {
        op: 'set_cell_text',
        group: 'g01-add-notes',
        anchor: '@notes;1;0',
        text: 'Review'
      }
    ];
    const result = await session.call<any>(
      'applyEdits',
      operations,
      'plain-add-notes'
    );

    expect(result.outcomes).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(result.groups).toBe(1);
    expect(await session.call<any[]>('traces')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          applied: expect.arrayContaining([
            expect.objectContaining({
              op: 'insert_column',
              route: 'editor',
              mechanism: 'sfdt_via_syncfusion_editor'
            }),
            expect.objectContaining({
              op: 'set_cell_text',
              route: 'editor',
              mechanism: 'syncfusion_editor'
            })
          ])
        })
      ])
    );
    expect(await session.call<number>('contentControlCount')).toBe(controls);
    const pending = await session.call<string>(
      'tableAnchorContaining',
      'Notes'
    );
    expect(await session.call<number>('tableColumnCountAt', pending)).toBe(3);
    expect(
      (await session.call<number[]>('columnWidthsAt', pending))[2]
    ).toBeCloseTo(120, 0);
    expect(await session.call<string[]>('tableRowTextsAt', pending)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Notes'),
        expect.stringContaining('Review')
      ])
    );

    await session.call('resolveGroups', true);
    const accepted = await session.call<string>(
      'tableAnchorContaining',
      'Notes'
    );
    expect(await session.call<number>('tableColumnCountAt', accepted)).toBe(3);
    expect(await session.call<number>('contentControlCount')).toBe(controls);

    await session.call('open', readFixture('flagship-v4d.browser.sfdt.json'));
    const rejectSource = await session.call<string>(
      'tableAnchorContaining',
      'Fire and explosion'
    );
    operations[0].anchor = `${rejectSource};0;1;0`;
    const rejected = await session.call<any>(
      'applyEdits',
      operations,
      'plain-add-notes-reject'
    );
    expect(rejected.outcomes).toEqual(['ok', 'ok', 'ok', 'ok']);
    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(baseline);
  }, 120000);

  it('splits noncontiguous rows by composing duplicate_table and delete_row', async () => {
    const baseline = await session.call<string>('serialize');
    const controls = await session.call<number>('contentControlCount');
    const source = await session.call<string>(
      'tableAnchorContaining',
      'Fire and explosion'
    );

    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'duplicate_table',
          group: 'g01-split-coverage',
          anchor: source,
          rows: 'copy',
          resultRef: '@copy'
        },
        {
          op: 'delete_row',
          group: 'g01-split-coverage',
          anchor: '@copy',
          rows: [1, 3]
        },
        {
          op: 'delete_row',
          group: 'g01-split-coverage',
          anchor: source,
          rows: [2, 4]
        }
      ],
      'plain-split-coverage'
    );

    expect(result.outcomes).toEqual(['ok', 'ok', 'ok']);
    expect(result.groups).toBe(1);
    expect(await session.call<any[]>('traces')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          applied: expect.arrayContaining([
            expect.objectContaining({
              op: 'duplicate_table',
              route: 'editor',
              mechanism: 'sfdt_via_syncfusion_editor'
            }),
            expect.objectContaining({
              op: 'delete_row',
              route: 'editor',
              mechanism: 'syncfusion_editor'
            })
          ])
        })
      ])
    );
    expect(await session.call<number>('contentControlCount')).toBe(controls);

    await session.call('resolveGroups', true);
    const sourceRows = await session.call<string[]>('tableRowTextsAt', source);
    expect(sourceRows).toEqual([
      'PerilStatus',
      'Fire and explosionIncluded',
      'SubsidenceExcluded'
    ]);
    const copy = await session.call<string>(
      'tableAnchorContaining',
      'Storm and flood'
    );
    expect(await session.call<string[]>('tableRowTextsAt', copy)).toEqual([
      'PerilStatus',
      'Storm and floodIncluded',
      'Escape of waterIncluded'
    ]);
    expect(
      await session.call<Array<string | null>>('rowShadingAt', source)
    ).toEqual(['#001B49FF', null, '#E6E6E6FF']);
    expect(
      await session.call<Array<string | null>>('rowShadingAt', copy)
    ).toEqual(['#001B49FF', null, '#E6E6E6FF']);

    await session.call('open', readFixture('flagship-v4d.browser.sfdt.json'));
    const rejectSource = await session.call<string>(
      'tableAnchorContaining',
      'Fire and explosion'
    );
    const rejected = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'duplicate_table',
          group: 'g01-split-coverage',
          anchor: rejectSource,
          rows: 'copy',
          resultRef: '@copy'
        },
        {
          op: 'delete_row',
          group: 'g01-split-coverage',
          anchor: '@copy',
          rows: [1, 3]
        },
        {
          op: 'delete_row',
          group: 'g01-split-coverage',
          anchor: rejectSource,
          rows: [2, 4]
        }
      ],
      'plain-split-coverage-reject'
    );
    expect(rejected.outcomes).toEqual(['ok', 'ok', 'ok']);
    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(baseline);
  }, 120000);

  it('adds and fills a row while preserving plain-table banding', async () => {
    const baseline = await session.call<string>('serialize');
    const controls = await session.call<number>('contentControlCount');
    const source = await session.call<string>(
      'tableAnchorContaining',
      'Fire and explosion'
    );
    const operations = [
      {
        op: 'insert_row',
        group: 'g01-add-earthquake',
        anchor: `${source};1;0;0`,
        shape: 'blank',
        resultRef: '@earthquake'
      },
      {
        op: 'set_cell_text',
        group: 'g01-add-earthquake',
        anchor: '@earthquake;0;0',
        text: 'Earthquake'
      },
      {
        op: 'set_cell_text',
        group: 'g01-add-earthquake',
        anchor: '@earthquake;1;0',
        text: 'Excluded'
      }
    ];

    const result = await session.call<any>(
      'applyEdits',
      operations,
      'plain-add-earthquake'
    );
    expect(result.outcomes).toEqual(['ok', 'ok', 'ok']);
    expect(result.groups).toBe(1);
    expect(await session.call<number>('contentControlCount')).toBe(controls);
    await session.call('resolveGroups', true);
    expect(await session.call<string[]>('tableRowTextsAt', source)).toEqual([
      'PerilStatus',
      'Fire and explosionIncluded',
      'EarthquakeExcluded',
      'Storm and floodIncluded',
      'SubsidenceExcluded',
      'Escape of waterIncluded'
    ]);
    expect(
      await session.call<Array<string | null>>('rowShadingAt', source)
    ).toEqual(['#001B49FF', null, '#E6E6E6FF', null, '#E6E6E6FF', null]);

    await session.call('open', readFixture('flagship-v4d.browser.sfdt.json'));
    const rejectSource = await session.call<string>(
      'tableAnchorContaining',
      'Fire and explosion'
    );
    operations[0].anchor = `${rejectSource};1;0;0`;
    expect(
      (
        await session.call<any>(
          'applyEdits',
          operations,
          'plain-add-earthquake-reject'
        )
      ).outcomes
    ).toEqual(['ok', 'ok', 'ok']);
    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(baseline);
  }, 120000);

  it('deletes a row and a column through the same public operations', async () => {
    const controls = await session.call<number>('contentControlCount');
    const source = await session.call<string>(
      'tableAnchorContaining',
      'Fire and explosion'
    );

    const rowResult = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'delete_row',
          group: 'g01-delete-storm',
          anchor: `${source};2;0;0`,
          rows: [2]
        }
      ],
      'plain-delete-storm'
    );
    expect(rowResult.outcomes).toEqual(['ok']);
    await session.call('resolveGroups', true);
    expect(await session.call<string[]>('tableRowTextsAt', source)).toEqual([
      'PerilStatus',
      'Fire and explosionIncluded',
      'SubsidenceExcluded',
      'Escape of waterIncluded'
    ]);
    expect(
      await session.call<Array<string | null>>('rowShadingAt', source)
    ).toEqual(['#001B49FF', null, '#E6E6E6FF', null]);

    const afterRowDelete = await session.call<string>('serialize');
    const deleteColumn = [
      {
        op: 'delete_column',
        group: 'g02-delete-status',
        anchor: `${source};0;1;0`
      }
    ];
    const columnResult = await session.call<any>(
      'applyEdits',
      deleteColumn,
      'plain-delete-status-reject'
    );
    expect(columnResult.outcomes).toEqual(['ok']);
    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(afterRowDelete);

    expect(
      (
        await session.call<any>(
          'applyEdits',
          deleteColumn,
          'plain-delete-status'
        )
      ).outcomes
    ).toEqual(['ok']);
    await session.call('resolveGroups', true);
    const remaining = await session.call<string>(
      'tableAnchorContaining',
      'Fire and explosion'
    );
    expect(await session.call<number>('tableColumnCountAt', remaining)).toBe(1);
    expect(await session.call<number>('contentControlCount')).toBe(controls);
  }, 120000);

  it('restripes a plain source when a later message inserts into its pending split', async () => {
    const baseline = await session.call<string>('serialize');
    const applySequence = async (source: string, suffix: string) => {
      const split = await session.call<any>(
        'applyEdits',
        [
          {
            op: 'duplicate_table',
            group: 'g01-split-coverage',
            anchor: source,
            rows: 'copy',
            resultRef: '@copy'
          },
          {
            op: 'delete_row',
            group: 'g01-split-coverage',
            anchor: '@copy',
            rows: [1, 3]
          },
          {
            op: 'delete_row',
            group: 'g01-split-coverage',
            anchor: source,
            rows: [2, 4]
          }
        ],
        `plain-split-pending-${suffix}`
      );
      const insert = await session.call<any>(
        'applyEdits',
        [
          {
            op: 'insert_row',
            group: 'g02-add-earthquake',
            anchor: `${source};3;0;0`,
            shape: 'blank',
            resultRef: '@earthquake'
          },
          {
            op: 'set_cell_text',
            group: 'g02-add-earthquake',
            anchor: '@earthquake;0;0',
            text: 'Earthquake'
          },
          {
            op: 'set_cell_text',
            group: 'g02-add-earthquake',
            anchor: '@earthquake;1;0',
            text: 'Excluded'
          }
        ],
        `plain-add-to-pending-source-${suffix}`
      );
      expect(split.outcomes).toEqual(['ok', 'ok', 'ok']);
      expect(insert.outcomes).toEqual(['ok', 'ok', 'ok']);
    };

    const source = await session.call<string>(
      'tableAnchorContaining',
      'Fire and explosion'
    );
    await applySequence(source, 'accept');

    await session.call('resolveGroups', true);
    expect(await session.call<string[]>('tableRowTextsAt', source)).toEqual([
      'PerilStatus',
      'Fire and explosionIncluded',
      'SubsidenceExcluded',
      'EarthquakeExcluded'
    ]);
    expect(
      await session.call<Array<string | null>>('rowShadingAt', source)
    ).toEqual(['#001B49FF', null, '#E6E6E6FF', null]);

    await session.call('open', readFixture('flagship-v4d.browser.sfdt.json'));
    const rejectSource = await session.call<string>(
      'tableAnchorContaining',
      'Fire and explosion'
    );
    await applySequence(rejectSource, 'reject');
    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(baseline);
  }, 120000);
});
