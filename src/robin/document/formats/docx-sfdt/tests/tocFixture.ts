/**
 * A Word table of contents written into the committed flagship, as Word writes one: a TOC field
 * whose result is one paragraph per heading (a HYPERLINK to the heading's `_Toc` bookmark when the
 * code has `\h`, a tab, a PAGEREF of the same bookmark), every page number stale ("99"). Two
 * shapes beside the private corpus's style-based contents (`\t "Title,1"` with hyperlinks):
 *
 *   levels   `TOC \o "1-1" \h \z`: the Heading 1 paragraphs, hyperlinked
 *   styles   `TOC \t "Heading 2,1"`: the Heading 2 paragraphs, no hyperlinks
 *
 * Every entry's text is italic and the first heading's paragraph mark is in another font, so a
 * rebuild that took an entry's format from its heading would show. Options give the shapes the
 * review of the rebuild named: another code, a title before the field in its first paragraph, body
 * hyperlinks whose code holds "toc" before and after the contents, the contents locked in a
 * content control.
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

export interface TocOptions {
  /** The field code instead of the shape's. */
  code?: string;
  /** Text before the field's begin in its first paragraph. */
  prefix?: string;
  /** A body hyperlink to a site whose name holds "toc", before and after the contents. */
  bodyLinks?: boolean;
  /** The contents inside a block content control whose contents are locked. */
  locked?: boolean;
  /** The second heading starts with a cross-reference bookmark before its own `_Toc` one. */
  refFirst?: boolean;
}

const ITALIC = { italic: true };
export const SITE = 'https://www.stockton-insurance.com';

const link = (text: string) => [
  begin(),
  run(`HYPERLINK "${SITE}"`),
  separator(),
  run(text),
  end()
];

/** The flagship with a contents table of `shape` after its first paragraph. */
export function withToc(shape: TocShape, options: TocOptions = {}): string {
  const { style, links } = SHAPES[shape];
  const code = options.code ?? SHAPES[shape].code;
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
      if (n === 1) block.characterFormat = { fontFamily: 'Georgia', fontSize: 18 };
      if (n === 2 && options.refFirst)
        block.inlines = [
          { bookmarkType: 0, name: '_Ref9000001' },
          ...block.inlines,
          { bookmarkType: 1, name: '_Ref9000001' }
        ];
      headings.push({ name, text });
    }
  const paragraphs: Array<Record<string, unknown>> = headings.map((h, k) => ({
    paragraphFormat: { styleName: 'TOC 1' },
    inlines: [
      ...(k === 0 && options.prefix ? [run(options.prefix)] : []),
      ...(k === 0 ? [begin(), run(code), separator()] : []),
      ...(links
        ? [begin(), run(`HYPERLINK \\l "${h.name}"`), separator()]
        : []),
      { ...run(h.text), characterFormat: ITALIC },
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
  const blocks: Array<Record<string, unknown>> = options.locked
    ? [
        {
          contentControlProperties: {
            lockContentControl: false,
            lockContents: true,
            tag: '',
            color: '#00000000',
            title: '',
            type: 'RichText',
            hasPlaceHolderText: false,
            multiline: false,
            isTemporary: false,
            isChecked: false,
            uncheckedState: { font: 'MS Gothic', value: '☐' },
            checkedState: { font: 'MS Gothic', value: '☒' },
            contentControlListItems: []
          },
          blocks: paragraphs
        }
      ]
    : paragraphs;
  const around = (text: string) => ({
    paragraphFormat: { styleName: 'Normal' },
    inlines: [run(`${text} `), ...link('our site')]
  });
  doc.sections[0].blocks.splice(
    1,
    0,
    ...(options.bodyLinks ? [around('Before the contents:')] : []),
    ...blocks,
    ...(options.bodyLinks ? [around('After the contents:')] : [])
  );
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
