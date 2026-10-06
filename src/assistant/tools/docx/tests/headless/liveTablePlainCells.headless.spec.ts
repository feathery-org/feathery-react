import { buildCostsFixture } from '../../../../../elements/components/DocxEditor/bindings/core/tests/fixtures/costsFixture';
import { HeadlessSession, startHeadless } from './headlessSession';

// A live table (bound inputs, a row formula and a sum) that also carries a row
// of unbound placeholder cells, the shape of a proposal column left to fill.
function withPlaceholderRow(): string {
  const sfdt: any = buildCostsFixture();
  const table = sfdt.sections[0].blocks[2].blocks[0];
  const row = JSON.parse(JSON.stringify(table.rows[1]));
  row.cells = row.cells.map((cell: any) => ({
    ...cell,
    blocks: [{ ...cell.blocks[0], inlines: [{ text: '—' }] }]
  }));
  table.rows.push(row);
  return JSON.stringify(sfdt);
}

const textAt = (inventory: any[], anchor: string): string | undefined =>
  inventory.find((entry) => entry.anchor === anchor)?.text;

describe('unbound cells of a live table', () => {
  let session: HeadlessSession;

  beforeAll(async () => {
    session = await startHeadless();
  }, 120000);

  afterAll(async () => {
    await session?.close();
  });

  it('fills every placeholder and the marker cell in one change set, keeping every binding', async () => {
    await session.call('open', withPlaceholderRow());
    const baseline = await session.call<string>('serialize');
    const tags = await session.call<string[]>('serializedTags');
    const formulas = await session.call<Record<string, string>>(
      'formulaValues'
    );
    const writes: Array<[string, string]> = [
      ['0;2;0;0;0', 'Line item'],
      ['0;2;6;0;0', 'Alternative 2'],
      ['0;2;6;1;0', 'Cincinnati'],
      ['0;2;6;2;0', 'Homeowners'],
      ['0;2;6;3;0', 'Included']
    ];

    const result = await session.call<any>(
      'applyEdits',
      writes.map(([anchor, text]) => ({
        op: 'set_cell_text',
        group: 'g01-fill-alternative',
        anchor,
        text
      })),
      'fill-alternative'
    );

    expect(result.outcomes).toEqual(writes.map(() => 'ok'));
    const inventory = await session.call<any[]>('inventory');
    for (const [anchor, text] of writes)
      expect(textAt(inventory, anchor)).toBe(text);
    expect(textAt(inventory, '0;2;0;1;0')).toBe('Qty');
    expect(await session.call<string[]>('serializedTags')).toEqual(tags);
    expect(await session.call('formulaValues')).toEqual(formulas);

    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(baseline);
  }, 120000);

  it('writes a ranged edit exactly in a non-first paragraph inside a binding wrapper', async () => {
    // Only a wrapper's first block hosts its start marker, so later paragraphs,
    // in the marker cell or under a block-level wrapper, keep exact offsets.
    const sfdt: any = JSON.parse(withPlaceholderRow());
    const blocks = sfdt.sections[0].blocks;
    const markerCell = blocks[2].blocks[0].rows[0].cells[0];
    markerCell.blocks.push({ inlines: [{ text: 'per policy' }] });
    blocks.splice(4, 0, {
      contentControlProperties: { ...blocks[2].contentControlProperties },
      blocks: [
        { inlines: [{ text: 'Wrapped first' }] },
        { inlines: [{ text: 'Wrapped second line' }] }
      ]
    });
    await session.call('open', JSON.stringify(sfdt));
    const tags = await session.call<string[]>('serializedTags');
    const before = await session.call<any[]>('inventory');
    const second = before.find((entry) => entry.text === 'Wrapped second line');
    expect(textAt(before, '0;2;0;0;1')).toBe('per policy');
    expect(second).toBeDefined();

    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'replace_text',
          anchor: '0;2;0;0;1',
          find: 'policy',
          replace: 'quote'
        },
        {
          op: 'replace_text',
          anchor: second.anchor,
          find: 'second',
          replace: 'next'
        }
      ],
      'ranged-in-wrapper'
    );

    expect(result.outcomes).toEqual(['ok', 'ok']);
    const after = await session.call<any[]>('inventory');
    expect(textAt(after, '0;2;0;0;0')).toBe('Item');
    expect(textAt(after, '0;2;0;0;1')).toBe('per quote');
    expect(textAt(after, second.anchor)).toBe('Wrapped next line');
    expect(await session.call<string[]>('serializedTags')).toEqual(tags);
  }, 120000);

  it('writes the same cell twice in one change set, the second write winning', async () => {
    await session.call('open', withPlaceholderRow());
    const baseline = await session.call<string>('serialize');
    const result = await session.call<any>(
      'applyEdits',
      [
        {
          op: 'set_cell_text',
          group: 'g01',
          anchor: '0;6;3;0;0',
          text: 'Net amount'
        },
        { op: 'set_cell_text', group: 'g01', anchor: '0;6;3;0;0', text: 'Net' }
      ],
      'write-twice'
    );

    expect(result.outcomes).toEqual(['ok', 'ok']);
    expect(textAt(await session.call<any[]>('inventory'), '0;6;3;0;0')).toBe(
      'Net'
    );
    await session.call('resolveGroups', false);
    expect(await session.call<string>('serialize')).toBe(baseline);
  }, 120000);
});
