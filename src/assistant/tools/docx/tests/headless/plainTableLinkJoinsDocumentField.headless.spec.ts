import { HeadlessSession, startHeadless } from './headlessSession';

const cell = (text: string) => ({
  blocks: [{ inlines: [{ text }] }],
  cellFormat: {
    columnSpan: 1,
    preferredWidth: 160,
    preferredWidthType: 'Point'
  }
});
const row = (texts: string[]) => ({
  rowFormat: { isHeader: false },
  cells: texts.map(cell)
});

// A policy section's plain premium table above a summary that already shows
// the same premium as a document-level live value: the shape of linking a new
// section's premium to its summary row.
function policyAndSummary(
  policyPremium: string,
  summaryTag = '[[name=collectible_premium|type=currency|value=700]]'
): string {
  return JSON.stringify({
    optimizeSfdt: false,
    sections: [
      {
        sectionFormat: { pageWidth: 612, pageHeight: 792 },
        blocks: [
          { inlines: [{ text: 'Collectible Suite Policy' }] },
          {
            rows: [
              row(['Item', 'Premium']),
              row(['Total Policy Premium', policyPremium]),
              row(['Fees', ''])
            ],
            grid: [160, 160],
            tableFormat: { preferredWidthType: 'Auto' },
            columnCount: 2
          },
          { inlines: [{ text: 'Premium Summary' }] },
          {
            rows: [
              row(['Coverage', 'Premium']),
              row(['Collectible Suite Policy', summaryTag])
            ],
            grid: [160, 160],
            tableFormat: { preferredWidthType: 'Auto' },
            columnCount: 2
          },
          { inlines: [{ text: 'End' }] }
        ]
      }
    ]
  });
}

const link = (expect: string) => ({
  op: 'create_binding',
  group: 'g01-link-premium',
  anchor: '0;1;1;1;0',
  expect,
  kind: 'input',
  name: 'collectible_premium',
  valueType: 'currency:USD:2'
});

describe('linking a plain cell to an existing document value', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  it('joins the existing value instead of creating a second, row-scoped one', async () => {
    await session.call('open', policyAndSummary('$700'), 1, true);
    const result = await session.call<any>(
      'applyEdits',
      [link('$700')],
      'link-premium'
    );

    expect(result.outcomes).toEqual(['ok']);
    const tags = (await session.call<string[]>('serializedTags')).filter(
      (tag) => tag.includes('name=collectible_premium')
    );
    expect(tags).toHaveLength(2);
    expect(tags.some((tag) => tag.includes('row='))).toBe(false);
    await session.call('resolveGroups', true);
    expect(
      await session.call<string[]>(
        'tableRowTextsAt',
        await session.call<string>('tableAnchorContaining', 'Fees')
      )
    ).toEqual(['ItemPremium', 'Total Policy Premium$700.00', 'Fees']);

    const summary = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'set_cell_text',
          group: 'g02-raise',
          anchor: `${await session.call<string>(
            'tableAnchorContaining',
            'Coverage'
          )};1;1;0`,
          text: '$800',
          literal: true
        }
      ],
      'raise-premium'
    );
    expect(summary.outcomes).toEqual(['ok']);
    await session.call('resolveGroups', true);
    expect(
      await session.call<string[]>(
        'tableRowTextsAt',
        await session.call<string>('tableAnchorContaining', 'Fees')
      )
    ).toContain('Total Policy Premium$800.00');
  }, 120000);

  it('refuses to join when the cell shows a different amount', async () => {
    await session.call('open', policyAndSummary('$650'), 1, true);
    const before = await session.call<string>('serialize');
    const result = await session.call<any>(
      'applyEdits',
      [link('$650')],
      'link-mismatch'
    );

    expect(result.outcomes).toEqual(['binding_value_conflict']);
    expect(await session.call<string>('serialize')).toBe(before);
  }, 120000);

  it('joins into a blank cell, showing the existing value', async () => {
    await session.call('open', policyAndSummary(''), 1, true);
    const result = await session.call<any>(
      'applyEdits',
      [{ ...link(''), expect: undefined }],
      'link-blank'
    );

    expect(result.outcomes).toEqual(['ok']);
    await session.call('resolveGroups', true);
    expect(
      await session.call<string[]>(
        'tableRowTextsAt',
        await session.call<string>('tableAnchorContaining', 'Fees')
      )
    ).toEqual(['ItemPremium', 'Total Policy Premium$700.00', 'Fees']);
  }, 120000);

  it('joins a cell whose pending overwrite already shows the value', async () => {
    await session.call(
      'open',
      policyAndSummary(
        '$700',
        '[[name=collectible_premium|type=currency|value=800]]'
      ),
      1,
      true
    );
    const raised = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'set_cell_text',
          group: 'g01-raise',
          anchor: '0;1;1;1;0',
          text: '$800',
          literal: true
        }
      ],
      'raise-section'
    );
    expect(raised.outcomes).toEqual(['ok']);
    const result = await session.call<any>(
      'applyEdits',
      [link('$800')],
      'link-pending'
    );

    expect(result.outcomes).toEqual(['ok']);
    await session.call('resolveGroups', true);
    expect(
      await session.call<string[]>(
        'tableRowTextsAt',
        await session.call<string>('tableAnchorContaining', 'Fees')
      )
    ).toEqual(['ItemPremium', 'Total Policy Premium$800.00', 'Fees']);
  }, 120000);

  it('inherits a shared definition rather than splitting it', async () => {
    await session.call(
      'open',
      policyAndSummary(
        '$700',
        '[[name=collectible_premium|type=currency|global=true|value=700]]'
      ),
      1,
      true
    );
    const result = await session.call<any>(
      'applyEdits',
      [link('$700')],
      'link-global'
    );

    expect(result.outcomes).toEqual(['ok']);
    const tags = (await session.call<string[]>('serializedTags')).filter(
      (tag) => tag.includes('name=collectible_premium')
    );
    expect(tags).toHaveLength(2);
    expect(tags.every((tag) => tag.includes('global=true'))).toBe(true);
  }, 120000);
});
