import { generateSfdt } from '../sfdt/generate';
import { parseSfdt } from '../sfdt/parse';
import { SAMPLE_DOCUMENT } from '../sampleDocument';

const VALUES = new Map([
  ['customer_name', 'Acme Corp'],
  ['retainer', '$1,500.00'],
  ['total', '$1,620.00']
]);

describe('parseSfdt', () => {
  it('round-trips the sample document: every block id, in order', () => {
    const parsed = parseSfdt(generateSfdt(SAMPLE_DOCUMENT, VALUES));
    const ids = parsed.sections.flat().map((b) => b.id);
    expect(ids).toEqual(
      SAMPLE_DOCUMENT.sections.flatMap((s) => s.blocks.map((b) => b.id))
    );
  });

  it('round-trips paragraph text and token values', () => {
    const parsed = parseSfdt(generateSfdt(SAMPLE_DOCUMENT, VALUES));
    const intro = parsed.sections[0][1];
    expect(intro.runs).toEqual([
      { kind: 'text', text: 'Prepared for ' },
      { kind: 'token', key: 'customer_name', text: 'Acme Corp' },
      { kind: 'text', text: '. All totals recalculate automatically.' }
    ]);
  });

  it('round-trips table cells with tokens', () => {
    const parsed = parseSfdt(generateSfdt(SAMPLE_DOCUMENT, VALUES));
    const table = parsed.sections[1].find((b) => b.kind === 'table')!;
    expect(table.id).toBe('blk_pricing_tbl');
    expect(table.cells![1][1]).toEqual([
      { kind: 'token', key: 'retainer', text: '$1,500.00' }
    ]);
  });

  it('parses an unanchored paragraph with id null', () => {
    const doc = JSON.parse(generateSfdt(SAMPLE_DOCUMENT, VALUES));
    doc.sections[0].blocks.push({
      paragraphFormat: { styleName: 'Normal' },
      characterFormat: {},
      inlines: [{ characterFormat: {}, text: 'typed below everything' }]
    });
    const parsed = parseSfdt(JSON.stringify(doc));
    const last = parsed.sections[0][parsed.sections[0].length - 1];
    expect(last.id).toBeNull();
    expect(last.runs).toEqual([{ kind: 'text', text: 'typed below everything' }]);
  });

  it('treats adjacent token markers as an empty token value', () => {
    const parsed = parseSfdt(generateSfdt(SAMPLE_DOCUMENT, new Map()));
    const intro = parsed.sections[0][1];
    const token = intro.runs!.find((r) => r.kind === 'token') as any;
    expect(token.text).toBe('');
  });
});
