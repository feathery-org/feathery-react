import { HeadlessSession, readFixture, startHeadless } from './headlessSession';

const addCyberSection = [
  {
    op: 'insert_section',
    group: 'g01-add-cyber-section',
    anchor: 'before:Operating Locations',
    sectionSpec: {
      title: 'Section 4 - Cyber Insurance',
      blocks: [
        {
          role: 'paragraph',
          text: 'Cover is subject to the general conditions set out in the schedule.'
        },
        {
          role: 'heading',
          level: 2,
          text: '4.1 Coverage Schedule'
        },
        {
          role: 'table',
          table: {
            columnHeaders: ['Peril', 'Status'],
            columnRoles: ['peril', 'status'],
            rows: [
              ['Cyber extortion', 'Included'],
              ['Network interruption', 'Included'],
              ['Data restoration', 'Included']
            ]
          }
        }
      ]
    }
  }
];

describe('section creation on the flagship document', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  beforeEach(async () => {
    await session.call('open', readFixture('flagship-v4.browser.sfdt.json'));
  });

  it('inherits the neighboring section pattern as one accept-or-reject group', async () => {
    const baseline = await session.call<string>('serialize');
    const baselineTags = await session.call<string[]>('serializedTags');
    const result = await session.call<any>(
      'applyEdits',
      addCyberSection,
      'add-cyber-section'
    );

    expect(result.outcomes).toEqual(['ok']);
    expect(result.groups).toBe(1);
    expect(result.revisions).toBeGreaterThan(0);
    const inventory = await session.call<
      Array<{ anchor: string; kind: string; text: string }>
    >('inventory');
    const title = inventory.findIndex(
      (entry) => entry.text === 'Section 4 - Cyber Insurance'
    );
    const nextSection = inventory.findIndex(
      (entry) => entry.text === 'Operating Locations'
    );
    expect(title).toBeGreaterThan(-1);
    expect(nextSection).toBeGreaterThan(title);

    const table = await session.call<string>(
      'tableAnchorContaining',
      'Cyber extortion'
    );
    expect(await session.call<string[]>('tableRowTextsAt', table)).toEqual([
      'PerilStatus',
      'Cyber extortionIncluded',
      'Network interruptionIncluded',
      'Data restorationIncluded'
    ]);
    expect(
      await session.call<Array<string | null>>('rowShadingAt', table)
    ).toEqual(['#001B49FF', null, '#E6E6E6FF', null]);
    expect(await session.call<string[]>('serializedTags')).toEqual(
      baselineTags
    );

    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(baseline);

    const accepted = await session.call<any>(
      'applyEdits',
      addCyberSection,
      'add-cyber-section-accepted'
    );
    expect(accepted.outcomes).toEqual(['ok']);
    await session.call('resolveGroups', true);
    const acceptedSection = await session.call<string>('serialize');
    const acceptedTable = await session.call<string>(
      'tableAnchorContaining',
      'Cyber extortion'
    );
    expect(
      await session.call<string[]>('tableRowTextsAt', acceptedTable)
    ).toEqual([
      'PerilStatus',
      'Cyber extortionIncluded',
      'Network interruptionIncluded',
      'Data restorationIncluded'
    ]);
    expect(await session.call<string[]>('serializedTags')).toEqual(
      baselineTags
    );

    const followUp = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'insert_row',
          group: 'g02-add-response-cover',
          anchor: `${acceptedTable};1;0;0`,
          shape: 'blank',
          resultRef: '@response'
        },
        {
          op: 'set_cell_text',
          group: 'g02-add-response-cover',
          anchor: '@response;0;0',
          text: 'Incident response'
        },
        {
          op: 'set_cell_text',
          group: 'g02-add-response-cover',
          anchor: '@response;1;0',
          text: 'Included'
        }
      ],
      'add-response-cover'
    );
    expect(followUp.outcomes).toEqual(['ok', 'ok', 'ok']);
    expect(followUp.groups).toBe(1);
    const editedTable = await session.call<string>(
      'tableAnchorContaining',
      'Incident response'
    );
    expect(
      await session.call<string[]>('tableRowTextsAt', editedTable)
    ).toEqual([
      'PerilStatus',
      'Cyber extortionIncluded',
      'Incident responseIncluded',
      'Network interruptionIncluded',
      'Data restorationIncluded'
    ]);
    expect(
      await session.call<Array<string | null>>('rowShadingAt', editedTable)
    ).toEqual(['#001B49FF', null, '#E6E6E6FF', null, '#E6E6E6FF']);
    expect(await session.call<string[]>('serializedTags')).toEqual(
      baselineTags
    );
    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(acceptedSection);
  }, 120000);
});
