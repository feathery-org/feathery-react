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

const equipmentSection = {
  title: '1.4 Equipment Costs',
  blocks: [
    {
      role: 'table',
      table: {
        columnHeaders: ['Equipment', 'Quantity', 'Unit Cost'],
        rows: [
          ['Laptop', '2', '$1,000'],
          ['Monitor', '3', '$400']
        ]
      }
    }
  ]
};

const liveCyberPremiumSection = {
  title: 'Section 4 - Cyber Insurance',
  blocks: [
    {
      role: 'paragraph',
      text: 'Covers ransomware, data breach, and business interruption.'
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
          ['Ransomware', 'Included'],
          ['Data breach', 'Included'],
          ['Business interruption', 'Included']
        ]
      }
    },
    {
      role: 'heading',
      level: 2,
      text: '4.2 Endorsements'
    },
    {
      role: 'table',
      table: {
        columnHeaders: ['Ref', 'Wording'],
        columnRoles: ['reference', 'wording'],
        rows: [
          ['CY-01', 'Multi-factor authentication'],
          ['CY-02', 'Incident response']
        ]
      }
    },
    {
      role: 'heading',
      level: 2,
      text: '4.3 Security Requirements'
    },
    {
      role: 'table',
      table: {
        columnHeaders: ['Requirement', 'Status'],
        columnRoles: ['requirement', 'status'],
        rows: [
          ['Encryption', 'Required'],
          ['Annual testing', 'Required']
        ]
      }
    },
    {
      role: 'heading',
      level: 2,
      text: '4.4 Premium Detail'
    },
    {
      role: 'table',
      table: {
        columnHeaders: ['Item', 'Units', 'Rate'],
        columnRoles: ['premium_item', 'units', 'rate'],
        rows: [
          ['Endpoint protection', '2', '$850'],
          ['Monitoring', '3', '$425'],
          ['Incident response', '1', '$1,200']
        ],
        // ai-services stamps this only after matching every figure against the
        // user's own messages. It is not part of Robin's public schema.
        literal: true
      }
    }
  ]
};

describe('section creation on the flagship document', () => {
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
    expect((await session.call<string[]>('serializedTags')).sort()).toEqual(
      [...baselineTags].sort()
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
    expect((await session.call<string[]>('serializedTags')).sort()).toEqual(
      [...baselineTags].sort()
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
    expect((await session.call<string[]>('serializedTags')).sort()).toEqual(
      [...baselineTags].sort()
    );
    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(acceptedSection);
  }, 120000);

  it('keeps a numbered subsection inside its parent Word section', async () => {
    const propertyTable = await session.call<string>(
      'tableAnchor',
      'property_premium'
    );
    const beforeMisplaced = await session.call<string>('serialize');
    const misplaced = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'insert_section',
          group: 'g01-misplaced-equipment',
          anchor: '2;0',
          position: 'before',
          sectionSpec: equipmentSection
        }
      ],
      'misplaced-equipment'
    );
    expect(misplaced.outcomes[0]).toContain('section_parent_mismatch');
    expect(await session.call<string>('serialize')).toBe(beforeMisplaced);

    const insidePriorUnit = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'insert_section',
          group: 'g01-equipment-inside-premium',
          anchor: '1;8',
          position: 'before',
          sectionSpec: equipmentSection
        }
      ],
      'equipment-inside-premium'
    );
    expect(insidePriorUnit.outcomes[0]).toContain('subsection_order_mismatch');
    expect(await session.call<string>('serialize')).toBe(beforeMisplaced);

    const placed = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'insert_section',
          group: 'g01-place-equipment',
          anchor: propertyTable,
          position: 'after',
          sectionSpec: equipmentSection
        }
      ],
      'place-equipment'
    );
    expect(placed.outcomes).toEqual(['ok']);
    const inventory = await session.call<
      Array<{ anchor: string; kind: string; text: string }>
    >('inventory');
    const insertedHeading = inventory.find(
      (entry) => entry.text === '1.4 Equipment Costs'
    )?.anchor;
    const livePropertyTable = await session.call<string>(
      'tableAnchor',
      'property_premium'
    );
    expect(insertedHeading).toMatch(/^1;/);
    expect(Number(insertedHeading?.split(';')[1])).toBeGreaterThan(
      Number(livePropertyTable.split(';')[1])
    );
  }, 120000);

  it('keeps a parent-tail blank anchor in its physical section', async () => {
    const propertyTable = await session.call<string>(
      'tableAnchor',
      'property_premium'
    );
    const [section, block] = propertyTable.split(';').map(Number);
    const placed = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'insert_section',
          group: 'g01-place-equipment-at-tail',
          anchor: `${section};${block + 1}`,
          position: 'after',
          sectionSpec: equipmentSection
        }
      ],
      'place-equipment-at-tail'
    );
    expect(placed.outcomes).toEqual(['ok']);

    const inventory = await session.call<
      Array<{ anchor: string; kind: string; text: string }>
    >('inventory');
    const insertedHeading = inventory.find(
      (entry) => entry.text === '1.4 Equipment Costs'
    )?.anchor;
    const livePropertyTable = await session.call<string>(
      'tableAnchor',
      'property_premium'
    );
    expect(insertedHeading).toMatch(/^1;/);
    expect(Number(insertedHeading?.split(';')[1])).toBeGreaterThan(
      Number(livePropertyTable.split(';')[1])
    );
  }, 120000);

  it('composes a sibling premium component with fresh live bindings', async () => {
    const baseline = await session.call<string>('serialize');
    const baselineTags = await session.call<string[]>('serializedTags');
    const baselineSfdt = JSON.parse(baseline) as {
      sections: Array<{
        blocks: unknown[];
        sectionFormat?: { breakCode?: string };
      }>;
    };
    expect(baselineSfdt.sections).toHaveLength(6);
    expect(
      baselineSfdt.sections.map((section) => section.sectionFormat?.breakCode)
    ).toEqual(Array(6).fill('NewPage'));
    const baselineInventory = await session.call<
      Array<{ anchor: string; kind: string; text: string }>
    >('inventory');
    expect(
      baselineInventory.find((entry) => entry.text === 'Operating Locations')
        ?.anchor
    ).toBe('4;0');
    expect(
      baselineInventory.find((entry) => entry.text === 'Premium Summary')
        ?.anchor
    ).toBe('5;0');
    const insert = async (id: string) =>
      session.call<any>(
        'applyEdits',
        [
          {
            op: 'insert_section',
            group: 'g01-add-live-cyber-premium',
            anchor: 'before:Operating Locations',
            sectionSpec: liveCyberPremiumSection
          }
        ],
        id
      );

    expect((await insert('add-live-cyber-premium')).outcomes).toEqual(['ok']);
    const pendingSfdt = JSON.parse(await session.call<string>('serialize')) as {
      sections: Array<{ sectionFormat?: { breakCode?: string } }>;
    };
    expect(pendingSfdt.sections).toHaveLength(7);
    expect(pendingSfdt.sections[4]?.sectionFormat?.breakCode).toBe('NewPage');
    const pendingInventory = await session.call<
      Array<{ anchor: string; kind: string; text: string }>
    >('inventory');
    expect(
      pendingInventory.find(
        (entry) => entry.text === 'Section 4 - Cyber Insurance'
      )?.anchor
    ).toMatch(/^4;0$/);
    expect(
      pendingInventory.find((entry) => entry.text === 'Operating Locations')
        ?.anchor
    ).toBe('5;0');
    expect(
      pendingInventory.find((entry) => entry.text === 'Premium Summary')?.anchor
    ).toBe('6;0');
    const componentHeadings = [
      '4.1 Coverage Schedule',
      '4.2 Endorsements',
      '4.3 Security Requirements',
      '4.4 Premium Detail'
    ].map(
      (text) => pendingInventory.find((entry) => entry.text === text)?.anchor
    );
    expect(componentHeadings).toHaveLength(4);
    expect(componentHeadings.every((anchor) => /^4;/.test(anchor ?? ''))).toBe(
      true
    );
    expect(
      componentHeadings.map((anchor) => Number(anchor?.split(';')[1]))
    ).toEqual(
      [...componentHeadings]
        .map((anchor) => Number(anchor?.split(';')[1]))
        .sort((left, right) => left - right)
    );
    const requirementsTable = await session.call<string>(
      'tableAnchorContaining',
      'Annual testing'
    );
    expect(
      await session.call<string[]>('tableRowTextsAt', requirementsTable)
    ).toEqual([
      'RequirementStatus',
      'EncryptionRequired',
      'Annual testingRequired'
    ]);
    const pendingTable = await session.call<string>(
      'tableAnchorContaining',
      'Endpoint protection'
    );
    expect(
      await session.call<string[]>('tableRowTextsAt', pendingTable)
    ).toEqual([
      'ItemUnitsRateLine total',
      'Endpoint protection2$850.00$1,700.00',
      'Monitoring3$425.00$1,275.00',
      'Incident response1$1,200.00$1,200.00',
      'Subsection subtotal$4,175.00'
    ]);
    expect(
      await session.call<Array<string | null>>('rowShadingAt', pendingTable)
    ).toEqual(['#001B49FF', null, '#E6E6E6FF', null, '#E6E6E6FF']);
    const pendingTags = await session.call<string[]>('serializedTags');
    expect(pendingTags.length).toBeGreaterThan(baselineTags.length);
    expect(
      pendingTags.some(
        (tag) => /^\[\[table=/.test(tag) && !baselineTags.includes(tag)
      )
    ).toBe(true);
    expect(
      pendingTags.some((tag) => tag.includes('cyber_insurance_subtotal'))
    ).toBe(true);

    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(baseline);

    expect((await insert('add-live-cyber-premium-accepted')).outcomes).toEqual([
      'ok'
    ]);
    await session.call('resolveGroups', true);
    const acceptedTable = await session.call<string>(
      'tableAnchorContaining',
      'Endpoint protection'
    );
    const edit = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'set_cell_text',
          group: 'g02-update-cyber-units',
          anchor: `${acceptedTable};1;1;0`,
          text: '4',
          literal: true
        }
      ],
      'update-cyber-units'
    );
    expect(edit.outcomes).toEqual(['ok']);
    expect(edit.revisions).toBeGreaterThan(0);
    await session.call('resolveGroups', true);
    expect(
      await session.call<string[]>('tableRowTextsAt', acceptedTable)
    ).toEqual([
      'ItemUnitsRateLine total',
      'Endpoint protection4$850.00$3,400.00',
      'Monitoring3$425.00$1,275.00',
      'Incident response1$1,200.00$1,200.00',
      'Subsection subtotal$5,875.00'
    ]);
  }, 120000);
});
