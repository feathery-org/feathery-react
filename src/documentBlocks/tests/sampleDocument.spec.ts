import { SAMPLE_DOCUMENT } from '../sampleDocument';
import { blockIds, allInlines } from '../types';

describe('sample document', () => {
  it('has unique block ids across all sections', () => {
    const ids = blockIds(SAMPLE_DOCUMENT);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
  });

  it('contains every block type at least once', () => {
    const types = SAMPLE_DOCUMENT.sections.flatMap((s) =>
      s.blocks.map((b) => b.type)
    );
    for (const t of ['h1', 'h2', 'h3', 'paragraph', 'table']) {
      expect(types).toContain(t);
    }
  });

  it('contains at least one field-backed and one computed token', () => {
    const inlines = SAMPLE_DOCUMENT.sections
      .flatMap((s) => s.blocks)
      .flatMap((b) => allInlines(b));
    const tokens = inlines.filter((i) => i.kind === 'token');
    expect(tokens.some((t: any) => t.spec.source)).toBe(true);
    expect(tokens.some((t: any) => t.spec.formula)).toBe(true);
  });
});
