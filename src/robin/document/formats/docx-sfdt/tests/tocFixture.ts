/**
 * A Word table of contents written into the committed flagship, as Word writes one: a TOC field
 * whose result is one paragraph per heading (a HYPERLINK to the heading's `_Toc` bookmark when the
 * code has `\h`, a tab, a PAGEREF of the same bookmark), every page number stale ("99"). Two
 * shapes beside the private corpus's style-based contents (`\t "Title,1"` with hyperlinks):
 *
 *   levels   `TOC \o "1-1" \h \z`: the Heading 1 paragraphs, hyperlinked
 *   styles   `TOC \t "Heading 2,1"`: the Heading 2 paragraphs, no hyperlinks
 */
import fs from 'fs';
import path from 'path';

export const flagship = fs.readFileSync(
  path.join(__dirname, 'corpus', 'flagship-v4b.sfdt.json'),
  'utf8'
);

export type TocShape = 'levels' | 'styles';

const SHAPES: Record<TocShape, { code: string; style: string; links: boolean }> = {
  levels: { code: ' TOC \\o "1-1" \\h \\z ', style: 'Heading 1', links: true },
  styles: { code: ' TOC \\t "Heading 2,1" ', style: 'Heading 2', links: false }
};

const begin = () => ({ fieldType: 0, hasFieldEnd: true });
const separator = () => ({ fieldType: 2 });
const end = () => ({ fieldType: 1 });
const run = (text: string) => ({ text });

/** The flagship with a contents table of `shape` after its first paragraph. */
export function withToc(shape: TocShape): string {
  const { code, style, links } = SHAPES[shape];
  const doc = JSON.parse(flagship);
  const headings: Array<{ name: string; text: string }> = [];
  let n = 0;
  for (const section of doc.sections)
    for (const block of section.blocks) {
      if (block.paragraphFormat?.styleName !== style) continue;
      const text = (block.inlines ?? [])
        .map((i: { text?: string }) => i.text ?? '')
        .join('');
      if (!text.trim()) continue;
      n += 1;
      const name = `_Toc9000${String(n).padStart(5, '0')}`;
      block.inlines = [
        { bookmarkType: 0, name },
        ...block.inlines,
        { bookmarkType: 1, name }
      ];
      headings.push({ name, text });
    }
  const paragraphs = headings.map((h, k) => ({
    paragraphFormat: { styleName: 'TOC 1' },
    inlines: [
      ...(k === 0 ? [begin(), run(code), separator()] : []),
      ...(links
        ? [begin(), run(`HYPERLINK \\l "${h.name}"`), separator()]
        : []),
      run(h.text),
      run('\t'),
      begin(),
      run(` PAGEREF ${h.name} \\h `),
      separator(),
      run('99'),
      end(),
      ...(links ? [end()] : [])
    ]
  }));
  paragraphs.push({ paragraphFormat: { styleName: 'Normal' }, inlines: [end()] });
  doc.sections[0].blocks.splice(1, 0, ...paragraphs);
  if (!doc.styles.some((s: { name: string }) => s.name === 'TOC 1'))
    doc.styles.push({
      name: 'TOC 1',
      type: 'Paragraph',
      paragraphFormat: { afterSpacing: 5 },
      characterFormat: {},
      basedOn: 'Normal',
      next: 'Normal'
    });
  return JSON.stringify(doc);
}
