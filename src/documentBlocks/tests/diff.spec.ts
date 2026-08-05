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
    expect(intro.content![0]).toEqual({
      kind: 'text',
      text: 'Now prepared for '
    });
    expect(intro.content![1]).toEqual(
      SAMPLE_DOCUMENT.sections[0].blocks[1].content![1]
    );
    expect(events).toEqual([{ type: 'blockChanged', blockId: 'blk_intro' }]);
  });

  it('reports an edited token value without treating it as content', () => {
    const parsed = roundTrip();
    (parsed.sections[0][1].runs![1] as any).text = 'Bravo Inc';
    const { events, tokenEdits } = absorbDocEdits(
      SAMPLE_DOCUMENT,
      parsed,
      RENDERED
    );
    expect(tokenEdits.get('customer_name')).toBe('Bravo Inc');
    expect(events).toContainEqual({
      type: 'tokenEdited',
      key: 'customer_name',
      text: 'Bravo Inc'
    });
  });

  it('drops a block deleted in the document', () => {
    const parsed = roundTrip();
    parsed.sections[0] = parsed.sections[0].filter(
      (b) => b.id !== 'blk_scope_p'
    );
    const { data, events } = absorbDocEdits(SAMPLE_DOCUMENT, parsed, RENDERED);
    expect(data.sections[0].blocks.map((b) => b.id)).not.toContain(
      'blk_scope_p'
    );
    expect(events).toContainEqual({
      type: 'blockDeleted',
      blockId: 'blk_scope_p'
    });
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
    expect(events).toContainEqual({
      type: 'blockAdopted',
      blockId: adopted.id
    });
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
    expect(events).toContainEqual({
      type: 'blockChanged',
      blockId: 'blk_pricing_tbl'
    });
  });

  it('folds an extra parsed section into the last data section', () => {
    const parsed = roundTrip();
    parsed.sections.push([
      {
        id: null,
        kind: 'paragraph',
        styleName: 'Normal',
        runs: [{ kind: 'text', text: 'Appendix' }]
      }
    ]);
    const { data, events } = absorbDocEdits(SAMPLE_DOCUMENT, parsed, RENDERED);
    expect(data.sections.length).toBe(SAMPLE_DOCUMENT.sections.length);
    const lastSection = data.sections[data.sections.length - 1];
    const adopted = lastSection.blocks[lastSection.blocks.length - 1];
    expect(adopted.content).toEqual([{ kind: 'text', text: 'Appendix' }]);
    expect(events).toContainEqual({
      type: 'blockAdopted',
      blockId: adopted.id
    });
  });

  it('drops a section entirely missing from the parsed document', () => {
    const parsed = roundTrip();
    parsed.sections.pop();
    const { data, events } = absorbDocEdits(SAMPLE_DOCUMENT, parsed, RENDERED);
    expect(data.sections[1].blocks).toEqual([]);
    expect(events).toContainEqual({
      type: 'blockDeleted',
      blockId: 'blk_pricing_h'
    });
    expect(events).toContainEqual({
      type: 'blockDeleted',
      blockId: 'blk_pricing_tbl'
    });
  });

  it('reorders matched blocks to follow the document order', () => {
    const parsed = roundTrip();
    const section0 = parsed.sections[0];
    const hIdx = section0.findIndex((b) => b.id === 'blk_scope_h');
    const pIdx = section0.findIndex((b) => b.id === 'blk_scope_p');
    [section0[hIdx], section0[pIdx]] = [section0[pIdx], section0[hIdx]];
    const { data } = absorbDocEdits(SAMPLE_DOCUMENT, parsed, RENDERED);
    const ids = data.sections[0].blocks.map((b) => b.id);
    expect(ids.indexOf('blk_scope_p')).toBeLessThan(ids.indexOf('blk_scope_h'));
    const prevScopeH = SAMPLE_DOCUMENT.sections[0].blocks.find(
      (b) => b.id === 'blk_scope_h'
    );
    const prevScopeP = SAMPLE_DOCUMENT.sections[0].blocks.find(
      (b) => b.id === 'blk_scope_p'
    );
    expect(data.sections[0].blocks.find((b) => b.id === 'blk_scope_h')).toBe(
      prevScopeH
    );
    expect(data.sections[0].blocks.find((b) => b.id === 'blk_scope_p')).toBe(
      prevScopeP
    );
  });

  it('keeps an extra parsed table row text-only even if its token key resolves globally', () => {
    const parsed = roundTrip();
    const table = parsed.sections[1].find((b) => b.kind === 'table')!;
    table.cells!.push([
      [{ kind: 'text', text: 'Design retainer (extra)' }],
      [{ kind: 'token', key: 'retainer', text: '$1,500.00' }]
    ]);
    const { data } = absorbDocEdits(SAMPLE_DOCUMENT, parsed, RENDERED);
    const dataTable = data.sections[1].blocks.find((b) => b.type === 'table')!;
    expect(dataTable.rows![3][1].content).toEqual([
      { kind: 'text', text: '$1,500.00' }
    ]);
  });

  it('adopts an unanchored table at its position with a fresh id', () => {
    const parsed = roundTrip();
    parsed.sections[1].push({
      id: null,
      kind: 'table',
      cells: [
        [
          [{ kind: 'text', text: 'A' }],
          [{ kind: 'text', text: 'B' }]
        ]
      ]
    });
    const { data, events } = absorbDocEdits(SAMPLE_DOCUMENT, parsed, RENDERED);
    const blocks = data.sections[1].blocks;
    const adopted = blocks[blocks.length - 1];
    expect(adopted.type).toBe('table');
    expect(adopted.id).toMatch(/^blk_a\d+$/);
    expect(events).toContainEqual({
      type: 'blockAdopted',
      blockId: adopted.id
    });
  });

  it('keeps the later occurrence when the same token key is edited in two places', () => {
    const parsed = roundTrip();
    (parsed.sections[0][1].runs![1] as any).text = 'Bravo Inc';
    parsed.sections[0][3].runs = [
      { kind: 'token', key: 'customer_name', text: 'Charlie Co' },
      { kind: 'text', text: ' also agrees.' }
    ];
    const { events, tokenEdits } = absorbDocEdits(
      SAMPLE_DOCUMENT,
      parsed,
      RENDERED
    );
    expect(tokenEdits.get('customer_name')).toBe('Charlie Co');
    const tokenEditedEvents = events.filter(
      (e) => e.type === 'tokenEdited' && (e as any).key === 'customer_name'
    );
    expect(tokenEditedEvents).toEqual([
      { type: 'tokenEdited', key: 'customer_name', text: 'Charlie Co' }
    ]);
  });
});
