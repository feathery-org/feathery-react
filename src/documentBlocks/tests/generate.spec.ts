import { generateSfdt } from '../sfdt/generate';
import { SAMPLE_DOCUMENT } from '../sampleDocument';
import { EMPTY_THEME } from '../types';

const gen = (data = SAMPLE_DOCUMENT, values = new Map<string, string>()) =>
  JSON.parse(generateSfdt(data, values));

describe('generateSfdt', () => {
  it('emits one SFDT section per data section', () => {
    const doc = gen();
    expect(doc.sections).toHaveLength(SAMPLE_DOCUMENT.sections.length);
    for (const section of doc.sections) {
      expect(section.blocks.length).toBeGreaterThan(0);
      expect(section.headersFooters).toEqual({});
    }
  });

  it('wraps every block in its fblk_ bookmark pair', () => {
    const text = JSON.stringify(gen());
    expect(text).toContain('"fblk_blk_title"');
    expect(text).toContain('"fblk_blk_pricing_tbl"');
    const starts = (text.match(/"bookmarkType":0/g) ?? []).length;
    const ends = (text.match(/"bookmarkType":1/g) ?? []).length;
    expect(starts).toBe(ends);
  });

  it('applies heading styles by block type', () => {
    const doc = gen();
    const para = doc.sections[0].blocks[0]; // blk_title, h1
    expect(para.paragraphFormat.styleName).toBe('Heading 1');
  });

  it('renders token values from the provided map inside ftk_ bookmarks', () => {
    const values = new Map([['customer_name', 'Acme Corp']]);
    const doc = gen(SAMPLE_DOCUMENT, values);
    const intro = doc.sections[0].blocks[1];
    const inlineTexts = intro.inlines.map((i: any) => i.text ?? '');
    expect(inlineTexts.join('')).toContain('Acme Corp');
    const names = intro.inlines.map((i: any) => i.name).filter(Boolean);
    expect(names).toContain('ftk_customer_name');
  });

  it('emits tables with header row and theme table format', () => {
    const themed = {
      ...SAMPLE_DOCUMENT,
      theme: {
        ...EMPTY_THEME,
        table: {
          tableFormat: { preferredWidthType: 'Percent', preferredWidth: 100 },
          headerRow: { characterFormat: { bold: true } },
          body: {}
        }
      }
    };
    const doc = gen(themed);
    const table = doc.sections[1].blocks.find((b: any) => b.rows);
    expect(table.rows).toHaveLength(3);
    expect(table.tableFormat.preferredWidthType).toBe('Percent');
    const headerRun = table.rows[0].cells[0].blocks[0].inlines.find(
      (i: any) => typeof i.text === 'string'
    );
    expect(headerRun.characterFormat.bold).toBe(true);
  });
});
