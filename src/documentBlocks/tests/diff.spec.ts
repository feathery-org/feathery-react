import { absorbDocEdits } from '../diff';
import { generateSfdt } from '../sfdt/generate';
import { parseSfdt } from '../sfdt/parse';
import { SAMPLE_DOCUMENT } from '../sampleDocument';

const RENDERED = new Map([
  ['customer_name', 'Acme Corp'],
  ['retainer', '$1,500.00'],
  ['total', '$1,620.00']
]);

const roundTrip = () => parseSfdt(generateSfdt(SAMPLE_DOCUMENT, RENDERED));

describe('absorbDocEdits', () => {
  it('is a no-op on an unedited round-trip', () => {
    const { data, events, tokenEdits } = absorbDocEdits(
      SAMPLE_DOCUMENT,
      roundTrip(),
      RENDERED
    );
    expect(events).toEqual([]);
    expect(tokenEdits.size).toBe(0);
    expect(data.sections).toEqual(SAMPLE_DOCUMENT.sections);
  });

  it('absorbs edited paragraph text, preserving the token spec', () => {
    const parsed = roundTrip();
    parsed.sections[0][1].runs = [
      { kind: 'text', text: 'Now prepared for ' },
      { kind: 'token', key: 'customer_name', text: 'Acme Corp' },
      { kind: 'text', text: '.' }
    ];
    const { data, events } = absorbDocEdits(SAMPLE_DOCUMENT, parsed, RENDERED);
    const intro = data.sections[0].blocks[1];
    expect(intro.content![0]).toEqual({ kind: 'text', text: 'Now prepared for ' });
    expect(intro.content![1]).toEqual(SAMPLE_DOCUMENT.sections[0].blocks[1].content![1]);
    expect(events).toEqual([{ type: 'blockChanged', blockId: 'blk_intro' }]);
  });

  it('reports an edited token value without treating it as content', () => {
    const parsed = roundTrip();
    (parsed.sections[0][1].runs![1] as any).text = 'Bravo Inc';
    const { events, tokenEdits } = absorbDocEdits(SAMPLE_DOCUMENT, parsed, RENDERED);
    expect(tokenEdits.get('customer_name')).toBe('Bravo Inc');
    expect(events).toContainEqual({
      type: 'tokenEdited',
      key: 'customer_name',
      text: 'Bravo Inc'
    });
  });

  it('drops a block deleted in the document', () => {
    const parsed = roundTrip();
    parsed.sections[0] = parsed.sections[0].filter((b) => b.id !== 'blk_scope_p');
    const { data, events } = absorbDocEdits(SAMPLE_DOCUMENT, parsed, RENDERED);
    expect(data.sections[0].blocks.map((b) => b.id)).not.toContain('blk_scope_p');
    expect(events).toContainEqual({ type: 'blockDeleted', blockId: 'blk_scope_p' });
  });

  it('adopts an unanchored paragraph at its position with a fresh id', () => {
    const parsed = roundTrip();
    parsed.sections[0].splice(2, 0, {
      id: null,
      kind: 'paragraph',
      styleName: 'Heading 2',
      runs: [{ kind: 'text', text: 'New heading typed in the doc' }]
    });
    const { data, events } = absorbDocEdits(SAMPLE_DOCUMENT, parsed, RENDERED);
    const adopted = data.sections[0].blocks[2];
    expect(adopted.type).toBe('h2');
    expect(adopted.id).toMatch(/^blk_a\d+$/);
    expect(adopted.content).toEqual([
      { kind: 'text', text: 'New heading typed in the doc' }
    ]);
    expect(events).toContainEqual({ type: 'blockAdopted', blockId: adopted.id });
  });

  it('absorbs a cell edit in a table', () => {
    const parsed = roundTrip();
    parsed.sections[1].find((b) => b.kind === 'table')!.cells![1][0] = [
      { kind: 'text', text: 'Design retainer (monthly)' }
    ];
    const { data, events } = absorbDocEdits(SAMPLE_DOCUMENT, parsed, RENDERED);
    const table = data.sections[1].blocks.find((b) => b.type === 'table')!;
    expect(table.rows![1][0].content).toEqual([
      { kind: 'text', text: 'Design retainer (monthly)' }
    ]);
    expect(events).toContainEqual({ type: 'blockChanged', blockId: 'blk_pricing_tbl' });
  });
});
