import { HeadlessSession, readFixture, startHeadless } from './headlessSession';

function textOf(node: any): string {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (!node || typeof node !== 'object') return '';
  return (
    (typeof node.text === 'string' ? node.text : '') +
    Object.values(node).map(textOf).join('')
  );
}

function findTable(node: any, needle: string | string[]): any {
  const needles = Array.isArray(needle) ? needle : [needle];
  if (Array.isArray(node)) {
    for (const entry of node) {
      const table = findTable(entry, needles);
      if (table) return table;
    }
    return undefined;
  }
  if (!node || typeof node !== 'object') return undefined;
  if (
    Array.isArray(node.rows) &&
    needles.every((candidate) => textOf(node).includes(candidate))
  )
    return node;
  for (const value of Object.values(node)) {
    const table = findTable(value, needles);
    if (table) return table;
  }
  return undefined;
}

function firstTextRun(node: any): any {
  if (Array.isArray(node)) {
    for (const entry of node) {
      const run = firstTextRun(entry);
      if (run) return run;
    }
    return undefined;
  }
  if (!node || typeof node !== 'object') return undefined;
  if (typeof node.text === 'string' && node.text) return node;
  for (const value of Object.values(node)) {
    const run = firstTextRun(value);
    if (run) return run;
  }
  return undefined;
}

function repeatedAlternativeHeadersFixture(): string {
  const sfdt = JSON.parse(readFixture('flagship-v4d.browser.sfdt.json'));
  const setCellText = (
    cell: any,
    text: string,
    characterFormat: Record<string, unknown> = {}
  ): void => {
    const paragraph = cell?.blocks?.[0];
    paragraph.inlines = [{ characterFormat, text }];
  };
  for (const [needle, headerRow] of [
    ['Fire and explosion', 0],
    ['PR-01', 1],
    ['Public liability', 0]
  ] as const) {
    const table = findTable(sfdt.sections, needle);
    setCellText(table.rows[headerRow].cells[1], 'Alternative 1', {
      bold: true,
      fontColor: '#FFFFFFFF'
    });
  }
  const policy = findTable(sfdt.sections, 'Fire and explosion');
  setCellText(policy.rows[policy.rows.length - 1].cells[1], '$10,000', {
    bold: true,
    fontColor: '#001B49FF'
  });
  return JSON.stringify(sfdt);
}

function tableCellRunFormat(
  serialized: string,
  tableNeedle: string | string[],
  row: number,
  column: number
): Record<string, unknown> {
  const sfdt = JSON.parse(serialized);
  const table = findTable(sfdt.sections, tableNeedle);
  return (
    firstTextRun(table?.rows?.[row]?.cells?.[column])?.characterFormat ?? {}
  );
}

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
    const [section, block] = source.split(';').map(Number);
    expect(pending).toBe(`${section};${block + 1}`);
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
    expect(accepted).toBe(source);
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

  it('inserts columns into two plain tables with the same header in one atomic group', async () => {
    await session.call('open', repeatedAlternativeHeadersFixture());
    const baseline = await session.call<string>('serialize');
    const policy = await session.call<string>(
      'tableAnchorContaining',
      'Fire and explosion'
    );
    const endorsements = await session.call<string>(
      'tableAnchorContaining',
      'PR-01'
    );

    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'insert_column',
          group: 'g01-add-alternative',
          anchor: `${policy};0;1;0`,
          expect: 'Alternative 1',
          position: 'after',
          resultRef: '@policy_alt2'
        },
        {
          op: 'insert_column',
          group: 'g01-add-alternative',
          anchor: `${endorsements};1;1;0`,
          expect: 'Alternative 1',
          position: 'after',
          resultRef: '@endorsement_alt2'
        }
      ],
      'plain-repeated-alternative-columns'
    );

    if (result.outcomes.some((outcome: string) => outcome !== 'ok'))
      throw new Error(JSON.stringify(result));
    expect(result.outcomes).toEqual(['ok', 'ok']);
    expect(result.groups).toBe(1);
    expect(
      await session.call<number>(
        'tableColumnCountAt',
        await session.call<string>(
          'tableAnchorContaining',
          'Fire and explosion'
        )
      )
    ).toBe(3);
    expect(
      await session.call<number>(
        'tableColumnCountAt',
        await session.call<string>('tableAnchorContaining', 'PR-01')
      )
    ).toBe(3);

    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(baseline);
  }, 120000);

  it('accepts separately stated occurrences of the same figure in distinct cells', async () => {
    await session.call('open', repeatedAlternativeHeadersFixture());
    const baseline = await session.call<string>('serialize');
    const policy = await session.call<string>(
      'tableAnchorContaining',
      'Fire and explosion'
    );
    const liability = await session.call<string>(
      'tableAnchorContaining',
      'Public liability'
    );
    const operations = [
      {
        op: 'insert_column',
        group: 'g01-add-alternative',
        anchor: `${policy};0;1;0`,
        expect: 'Alternative 1',
        position: 'after',
        resultRef: '@policy_alt2'
      },
      {
        op: 'set_cell_text',
        group: 'g01-add-alternative',
        anchor: '@policy_alt2;0;0',
        text: 'Alternative 2'
      },
      {
        op: 'set_cell_text',
        group: 'g01-add-alternative',
        anchor: '@policy_alt2;1;0',
        text: '$25,000',
        literal: true
      },
      {
        op: 'insert_column',
        group: 'g01-add-alternative',
        anchor: `${liability};0;1;0`,
        expect: 'Alternative 1',
        position: 'after',
        resultRef: '@liability_alt2'
      },
      {
        op: 'set_cell_text',
        group: 'g01-add-alternative',
        anchor: '@liability_alt2;0;0',
        text: 'Alternative 2'
      },
      {
        op: 'set_cell_text',
        group: 'g01-add-alternative',
        anchor: '@liability_alt2;1;0',
        text: '$25,000',
        literal: true
      }
    ];

    const result = await session.call<any>(
      'applyEdits',
      operations,
      'repeated-stated-figure-occurrences'
    );

    expect(result.outcomes).toEqual(operations.map(() => 'ok'));
    expect(result.groups).toBe(1);
    expect(
      await session.call<string[]>(
        'tableRowTextsAt',
        await session.call<string>(
          'tableAnchorContaining',
          'Fire and explosion'
        )
      )
    ).toEqual(expect.arrayContaining([expect.stringContaining('$25,000')]));
    expect(
      await session.call<string[]>(
        'tableRowTextsAt',
        await session.call<string>('tableAnchorContaining', 'Public liability')
      )
    ).toEqual(expect.arrayContaining([expect.stringContaining('$25,000')]));

    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(baseline);
  }, 120000);

  it('formats inserted-column text through its stable reference', async () => {
    await session.call('open', repeatedAlternativeHeadersFixture());
    const baseline = await session.call<string>('serialize');
    const policy = await session.call<string>(
      'tableAnchorContaining',
      'Fire and explosion'
    );
    const lastRow = 4;
    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'insert_column',
          group: 'g01-add-alternative',
          anchor: `${policy};0;1;0`,
          expect: 'Alternative 1',
          position: 'after',
          resultRef: '@policy_alt2'
        },
        {
          op: 'set_cell_text',
          group: 'g01-add-alternative',
          anchor: '@policy_alt2;0;0',
          text: 'Alternative 2'
        },
        {
          op: 'set_cell_text',
          group: 'g01-add-alternative',
          anchor: `@policy_alt2;${lastRow};0`,
          text: '$22,700.00',
          literal: true
        },
        {
          op: 'set_char_format',
          group: 'g01-add-alternative',
          anchor: '@policy_alt2;0;0',
          expect: 'Alternative 2',
          bold: true,
          fontColor: '#FFFFFFFF'
        },
        {
          op: 'set_char_format',
          group: 'g01-add-alternative',
          anchor: `@policy_alt2;${lastRow};0`,
          expect: '$22,700.00',
          bold: true,
          fontColor: '#001B49FF'
        }
      ],
      'insert-column-run-format'
    );

    if (result.outcomes.some((outcome: string) => outcome !== 'ok'))
      throw new Error(JSON.stringify(result));
    expect(result.outcomes).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    const pending = await session.call<string>('serialize');
    expect(tableCellRunFormat(pending, 'Alternative 2', 0, 2)).toMatchObject({
      bold: true,
      fontColor: '#FFFFFFFF'
    });
    expect(
      tableCellRunFormat(pending, 'Alternative 2', lastRow, 2)
    ).toMatchObject({ bold: true, fontColor: '#001B49FF' });

    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(baseline);
  }, 120000);

  it('keeps a lower created-column reference live when a later paste shifts its table', async () => {
    await session.call('open', repeatedAlternativeHeadersFixture());
    const baseline = await session.call<string>('serialize');
    const upper = await session.call<string>(
      'tableAnchorContaining',
      'Fire and explosion'
    );
    const lower = await session.call<string>(
      'tableAnchorContaining',
      'Public liability'
    );
    const operations = [
      {
        op: 'insert_column',
        group: 'g01-reverse-order',
        anchor: `${lower};0;1;0`,
        expect: 'Alternative 1',
        position: 'after',
        resultRef: '@lower_alt2'
      },
      {
        op: 'set_cell_text',
        group: 'g01-reverse-order',
        anchor: '@lower_alt2;0;0',
        text: 'Alternative 2'
      },
      {
        op: 'insert_column',
        group: 'g01-reverse-order',
        anchor: `${upper};0;1;0`,
        expect: 'Alternative 1',
        position: 'after',
        resultRef: '@upper_alt2'
      },
      {
        op: 'set_cell_text',
        group: 'g01-reverse-order',
        anchor: '@upper_alt2;0;0',
        text: 'Alternative 2'
      },
      {
        op: 'set_char_format',
        group: 'g01-reverse-order',
        anchor: '@lower_alt2;0;0',
        expect: 'Alternative 2',
        bold: true,
        fontColor: '#FFFFFFFF'
      },
      {
        op: 'set_char_format',
        group: 'g01-reverse-order',
        anchor: '@upper_alt2;0;0',
        expect: 'Alternative 2',
        bold: true,
        fontColor: '#FFFFFFFF'
      }
    ];

    const result = await session.call<any>(
      'applyEdits',
      operations,
      'plain-reverse-order-column-refs'
    );

    expect(result.outcomes).toEqual(operations.map(() => 'ok'));
    expect(result.groups).toBe(1);
    const pending = await session.call<string>('serialize');
    expect(
      tableCellRunFormat(pending, ['Public liability', 'Alternative 2'], 0, 2)
    ).toMatchObject({ bold: true, fontColor: '#FFFFFFFF' });
    expect(
      tableCellRunFormat(pending, ['Fire and explosion', 'Alternative 2'], 0, 2)
    ).toMatchObject({ bold: true, fontColor: '#FFFFFFFF' });

    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(baseline);
  }, 120000);

  it('keeps repeated-header table targets local across an interleaved multiline insert', async () => {
    await session.call('open', repeatedAlternativeHeadersFixture());
    const baseline = await session.call<string>('serialize');
    const upper = await session.call<string>(
      'tableAnchorContaining',
      'Fire and explosion'
    );
    const lower = await session.call<string>(
      'tableAnchorContaining',
      'Public liability'
    );
    const liabilityHeading = (
      await session.call<Array<{ anchor: string; kind: string; text: string }>>(
        'inventory'
      )
    ).find((entry) => entry.text === 'Section 2 - Liability')?.anchor;
    expect(liabilityHeading).toBeTruthy();
    const operations = [
      {
        op: 'insert_column',
        group: 'g01-interleaved-topology',
        anchor: `${upper};0;1;0`,
        expect: 'Alternative 1',
        position: 'after',
        resultRef: '@upper_alt2'
      },
      {
        op: 'set_cell_text',
        group: 'g01-interleaved-topology',
        anchor: '@upper_alt2;0;0',
        text: 'Alternative 2'
      },
      {
        op: 'insert_text',
        group: 'g01-interleaved-topology',
        anchor: liabilityHeading,
        expect: 'Section 2 - Liability',
        position: 'after',
        text: 'Underwriting note'
      },
      {
        op: 'insert_column',
        group: 'g01-interleaved-topology',
        anchor: `${lower};0;1;0`,
        expect: 'Alternative 1',
        position: 'after',
        resultRef: '@lower_alt2'
      },
      {
        op: 'set_cell_text',
        group: 'g01-interleaved-topology',
        anchor: '@lower_alt2;0;0',
        text: 'Alternative 2'
      },
      {
        op: 'set_char_format',
        group: 'g01-interleaved-topology',
        anchor: '@lower_alt2;0;0',
        expect: 'Alternative 2',
        bold: true,
        fontColor: '#FFFFFFFF'
      }
    ];

    const result = await session.call<any>(
      'applyEdits',
      operations,
      'plain-interleaved-topology'
    );

    expect(result.outcomes).toEqual(operations.map(() => 'ok'));
    expect(result.groups).toBe(1);
    const pending = await session.call<string>('serialize');
    expect(
      tableCellRunFormat(pending, ['Public liability', 'Alternative 2'], 0, 2)
    ).toMatchObject({ bold: true, fontColor: '#FFFFFFFF' });
    expect(
      findTable(JSON.parse(pending).sections, [
        'Fire and explosion',
        'Alternative 2'
      ])
    ).toBeTruthy();

    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(baseline);
  }, 120000);

  it('discards rolled-back paste positions before applying a later group', async () => {
    await session.call('open', repeatedAlternativeHeadersFixture());
    const baseline = await session.call<string>('serialize');
    const upper = await session.call<string>(
      'tableAnchorContaining',
      'Fire and explosion'
    );
    const lower = await session.call<string>(
      'tableAnchorContaining',
      'Public liability'
    );
    const operations = [
      {
        op: 'insert_column',
        group: 'g01-rolled-back',
        anchor: `${upper};0;1;0`,
        expect: 'Alternative 1',
        position: 'after',
        resultRef: '@discarded'
      },
      {
        op: 'set_cell_text',
        group: 'g01-rolled-back',
        anchor: '@discarded;99;0',
        text: 'Cannot land'
      },
      {
        op: 'insert_column',
        group: 'g02-survives',
        anchor: `${lower};0;1;0`,
        expect: 'Alternative 1',
        position: 'after',
        resultRef: '@survivor'
      },
      {
        op: 'set_cell_text',
        group: 'g02-survives',
        anchor: '@survivor;0;0',
        text: 'Alternative 2'
      },
      {
        op: 'set_char_format',
        group: 'g02-survives',
        anchor: '@survivor;0;0',
        expect: 'Alternative 2',
        bold: true,
        fontColor: '#FFFFFFFF'
      }
    ];

    const result = await session.call<any>(
      'applyEdits',
      operations,
      'plain-rollback-topology-ledger'
    );

    expect(result.outcomes.slice(0, 2)).toEqual([
      'change_set_failed',
      'anchor_not_found'
    ]);
    expect(result.outcomes.slice(2)).toEqual(['ok', 'ok', 'ok']);
    expect(result.groups).toBe(1);
    const pending = await session.call<string>('serialize');
    expect(
      tableCellRunFormat(pending, ['Public liability', 'Alternative 2'], 0, 2)
    ).toMatchObject({ bold: true, fontColor: '#FFFFFFFF' });
    expect(findTable(JSON.parse(pending).sections, 'Cannot land')).toBeFalsy();

    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(baseline);
  }, 120000);

  it.each(['paste-first', 'row-first'] as const)(
    'refuses an ambiguous cell write when table and row shifts are %s',
    async (order) => {
      await session.call('open', repeatedAlternativeHeadersFixture());
      const baseline = await session.call<string>('serialize');
      const upper = await session.call<string>(
        'tableAnchorContaining',
        'Fire and explosion'
      );
      const target = await session.call<string>(
        'tableAnchorContaining',
        'Public liability'
      );
      const paste = {
        op: 'insert_column',
        group: 'g01-composed-shifts',
        anchor: `${upper};0;1;0`,
        expect: 'Alternative 1',
        position: 'after',
        resultRef: '@upper_alt2'
      };
      const shiftRow = {
        op: 'insert_row',
        group: 'g01-composed-shifts',
        anchor: `${target};1;0;0`,
        above: false,
        count: 1
      };
      const write = {
        op: 'set_cell_text',
        group: 'g01-composed-shifts',
        anchor: `${target};3;1;0`,
        expect: 'Included',
        text: 'Changed'
      };
      const operations =
        order === 'paste-first'
          ? [paste, shiftRow, write]
          : [shiftRow, paste, write];

      const result = await session.call<any>(
        'applyEdits',
        operations,
        `plain-composed-shifts-${order}`
      );

      expect(result.outcomes).toEqual([
        'change_set_failed',
        'change_set_failed',
        'anchor_relocation_ambiguous'
      ]);
      expect(result.groups).toBe(0);
      expect(await session.call<string>('serialize')).toBe(baseline);
    },
    120000
  );

  it('preserves a successful row shift when a later topology group rolls back', async () => {
    await session.call('open', repeatedAlternativeHeadersFixture());
    const baseline = await session.call<string>('serialize');
    const upper = await session.call<string>(
      'tableAnchorContaining',
      'Fire and explosion'
    );
    const target = await session.call<string>(
      'tableAnchorContaining',
      'Public liability'
    );
    const liabilityHeading = (
      await session.call<Array<{ anchor: string; kind: string; text: string }>>(
        'inventory'
      )
    ).find((entry) => entry.text === 'Section 2 - Liability')?.anchor;
    expect(liabilityHeading).toBeTruthy();
    const operations = [
      {
        op: 'insert_row',
        group: 'g01-row-survives',
        anchor: `${target};1;0;0`,
        above: false,
        count: 1
      },
      {
        op: 'insert_text',
        group: 'g02-rolls-back',
        anchor: liabilityHeading,
        expect: 'Section 2 - Liability',
        position: 'after',
        text: 'Temporary note\nSecond line'
      },
      {
        op: 'insert_column',
        group: 'g02-rolls-back',
        anchor: `${upper};0;1;0`,
        expect: 'Alternative 1',
        position: 'after',
        resultRef: '@discarded'
      },
      {
        op: 'set_cell_text',
        group: 'g02-rolls-back',
        anchor: '@discarded;99;0',
        text: 'Cannot land'
      },
      {
        op: 'set_cell_text',
        group: 'g03-write-after-rollback',
        anchor: `${target};3;1;0`,
        expect: 'Included',
        text: 'Changed'
      }
    ];

    const result = await session.call<any>(
      'applyEdits',
      operations,
      'plain-rollback-preserves-row-shift'
    );

    expect(result.outcomes[0]).toBe('ok');
    expect(result.outcomes.slice(1, 4)).toEqual([
      'change_set_failed',
      'change_set_failed',
      'anchor_not_found'
    ]);
    expect(result.outcomes[4]).toBe('anchor_relocation_ambiguous');
    expect(result.groups).toBe(1);
    const liveTarget = await session.call<string>(
      'tableAnchorContaining',
      'Public liability'
    );
    const rows = await session.call<string[]>('tableRowTextsAt', liveTarget);
    expect(rows).toEqual(
      expect.arrayContaining([
        'Products liabilityIncluded',
        'Employers liabilityIncluded'
      ])
    );
    expect(rows).not.toContain('Products liabilityChanged');
    expect(rows).not.toContain('Employers liabilityChanged');
    expect(await session.call<string>('serialize')).not.toContain(
      'Temporary note'
    );

    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(baseline);
  }, 120000);

  it('applies one mixed bound and plain multi-table column batch', async () => {
    await session.call('open', repeatedAlternativeHeadersFixture());
    const baseline = await session.call<string>('serialize');
    const property = await session.call<string>(
      'tableAnchor',
      'property_premium'
    );
    const liability = await session.call<string>(
      'tableAnchor',
      'liability_premium'
    );
    const summary = await session.call<string>('tableAnchor', 'summary');
    const propertyOptions = await session.call<string>(
      'tableAnchorContaining',
      'Fire and explosion'
    );
    const liabilityOptions = await session.call<string>(
      'tableAnchorContaining',
      'Public liability'
    );
    const operations = [
      {
        op: 'insert_column',
        group: 'g01-add-alternative',
        anchor: `${propertyOptions};0;1;0`,
        expect: 'Alternative 1',
        position: 'after',
        resultRef: '@property_options_alt2'
      },
      {
        op: 'set_cell_text',
        group: 'g01-add-alternative',
        anchor: '@property_options_alt2;0;0',
        text: 'Alternative 2'
      },
      {
        op: 'insert_column',
        group: 'g01-add-alternative',
        anchor: `${liabilityOptions};0;1;0`,
        expect: 'Alternative 1',
        position: 'after',
        resultRef: '@liability_options_alt2'
      },
      {
        op: 'set_cell_text',
        group: 'g01-add-alternative',
        anchor: '@liability_options_alt2;0;0',
        text: 'Alternative 2'
      },
      {
        op: 'insert_column',
        group: 'g01-add-alternative',
        anchor: `${property};0;3;0`,
        position: 'after',
        resultRef: '@property_alt2'
      },
      {
        op: 'set_cell_text',
        group: 'g01-add-alternative',
        anchor: '@property_alt2;0;0',
        text: 'Alternative 2'
      },
      {
        op: 'insert_column',
        group: 'g01-add-alternative',
        anchor: `${liability};0;3;0`,
        position: 'after',
        resultRef: '@liability_alt2'
      },
      {
        op: 'set_cell_text',
        group: 'g01-add-alternative',
        anchor: '@liability_alt2;0;0',
        text: 'Alternative 2'
      },
      {
        op: 'insert_column',
        group: 'g01-add-alternative',
        anchor: `${summary};0;1;0`,
        position: 'after',
        resultRef: '@summary_alt2'
      },
      {
        op: 'set_cell_text',
        group: 'g01-add-alternative',
        anchor: '@summary_alt2;0;0',
        text: 'Alternative 2'
      }
    ];

    const result = await session.call<any>(
      'applyEdits',
      operations,
      'mixed-alternative-columns'
    );

    if (result.outcomes.some((outcome: string) => outcome !== 'ok'))
      throw new Error(JSON.stringify(result));
    expect(result.outcomes).toEqual(operations.map(() => 'ok'));
    expect(result.groups).toBe(1);
    expect(result.warnings).toEqual([]);
    const applied = result.executionTrace.applied.filter(
      (entry: any) => entry.op === 'insert_column'
    );
    expect(
      applied.filter((entry: any) => entry.route === 'engine')
    ).toHaveLength(3);
    expect(
      applied.filter((entry: any) => entry.route === 'editor')
    ).toHaveLength(2);
    expect(
      await session.call<number>('tableColumnCount', 'property_premium')
    ).toBe(5);
    expect(
      await session.call<number>('tableColumnCount', 'liability_premium')
    ).toBe(5);
    expect(await session.call<number>('tableColumnCount', 'summary')).toBe(3);
    expect(
      await session.call<number>(
        'tableColumnCountAt',
        await session.call<string>(
          'tableAnchorContaining',
          'Fire and explosion'
        )
      )
    ).toBe(3);
    expect(
      await session.call<number>(
        'tableColumnCountAt',
        await session.call<string>('tableAnchorContaining', 'Public liability')
      )
    ).toBe(3);

    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(baseline);

    const accepted = await session.call<any>(
      'applyEdits',
      operations,
      'mixed-alternative-columns-accept'
    );
    if (accepted.outcomes.some((outcome: string) => outcome !== 'ok'))
      throw new Error(JSON.stringify(accepted));
    await session.call('resolveGroups', true);
    expect(
      await session.call<number>('tableColumnCount', 'property_premium')
    ).toBe(5);
    expect(
      await session.call<number>('tableColumnCount', 'liability_premium')
    ).toBe(5);
    expect(await session.call<number>('tableColumnCount', 'summary')).toBe(3);
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

    const [sourceSection, sourceBlock] = source.split(';').map(Number);
    const pendingCopy = await session.call<string>(
      'tableAnchorContaining',
      'Storm and flood'
    );
    expect(pendingCopy).toBe(`${sourceSection};${sourceBlock + 2}`);

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
    expect(copy).toBe(`${sourceSection};${sourceBlock + 2}`);
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

  it('keeps one separator paragraph when inserting a table below another table', async () => {
    const baseline = await session.call<string>('serialize');
    const source = await session.call<string>(
      'tableAnchorContaining',
      'Fire and explosion'
    );
    const [section, block] = source.split(';').map(Number);
    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'insert_table',
          group: 'g01-add-review-table',
          anchor: `${section};${block + 2}`,
          expect: '1.2 Endorsements',
          position: 'before',
          rows: 2,
          columns: 2,
          initialCells: [
            ['Item', 'Notes'],
            ['Fire and explosion', 'Check limits']
          ]
        }
      ],
      'plain-add-review-table'
    );

    expect(result.outcomes).toEqual(['ok']);
    expect(result.groups).toBe(1);
    const pending = await session.call<string>(
      'tableAnchorContaining',
      'Check limits'
    );
    expect(pending).toBe(`${section};${block + 2}`);

    await session.call('resolveGroups', true);
    const accepted = await session.call<string>(
      'tableAnchorContaining',
      'Check limits'
    );
    expect(accepted).toBe(`${section};${block + 2}`);

    await session.call('open', readFixture('flagship-v4d.browser.sfdt.json'));
    const rejectSource = await session.call<string>(
      'tableAnchorContaining',
      'Fire and explosion'
    );
    const [rejectSection, rejectBlock] = rejectSource.split(';').map(Number);
    const rejected = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'insert_table',
          group: 'g01-add-review-table',
          anchor: `${rejectSection};${rejectBlock + 2}`,
          expect: '1.2 Endorsements',
          position: 'before',
          rows: 2,
          columns: 2,
          initialCells: [
            ['Item', 'Notes'],
            ['Fire and explosion', 'Check limits']
          ]
        }
      ],
      'plain-add-review-table-reject'
    );
    expect(rejected.outcomes).toEqual(['ok']);
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
