/**
 * The Components document: one sample per block type, styled with the
 * editor's own toolbar. Its serialized formats ARE the theme — extraction
 * reads them back and generate re-applies them to every instance.
 */
import { BlockFormats, Theme } from './types';
import { bookmarkEnd, bookmarkStart, bookmarkName, isBookmarkStart } from './anchors';

const SAMPLE_ANCHORS = ['cmp_h1', 'cmp_h2', 'cmp_h3', 'cmp_paragraph', 'cmp_table'] as const;

const SAMPLE_TEXT: Record<string, { style: string; text: string }> = {
  cmp_h1: { style: 'Heading 1', text: 'Heading 1 — top-level title' },
  cmp_h2: { style: 'Heading 2', text: 'Heading 2 — section heading' },
  cmp_h3: { style: 'Heading 3', text: 'Heading 3 — subsection heading' },
  cmp_paragraph: { style: 'Normal', text: 'Paragraph — body copy sample. Style this text and every paragraph follows.' }
};

const sampleParagraph = (anchor: string, formats: BlockFormats) => ({
  paragraphFormat: {
    styleName: SAMPLE_TEXT[anchor].style,
    ...(formats.paragraphFormat ?? {})
  },
  characterFormat: {},
  inlines: [
    bookmarkStart(anchor),
    { characterFormat: { ...(formats.characterFormat ?? {}) }, text: SAMPLE_TEXT[anchor].text },
    bookmarkEnd(anchor)
  ]
});

const sampleCell = (
  text: string,
  formats: BlockFormats & { cellFormat?: Record<string, any> },
  extra: Record<string, any>[] = []
) => ({
  blocks: [
    {
      paragraphFormat: { ...(formats.paragraphFormat ?? {}) },
      characterFormat: {},
      inlines: [...extra, { characterFormat: { ...(formats.characterFormat ?? {}) }, text }]
    }
  ],
  cellFormat: { ...(formats.cellFormat ?? {}) }
});

const sampleTable = (theme: Theme) => ({
  rows: [
    {
      rowFormat: { isHeader: true },
      cells: [
        sampleCell('Header', theme.table.headerRow, [bookmarkStart('cmp_table')]),
        sampleCell('Header', theme.table.headerRow)
      ]
    },
    {
      rowFormat: { isHeader: false },
      cells: [
        sampleCell('Body cell', theme.table.body),
        sampleCell('Body cell', theme.table.body)
      ]
    }
  ],
  grid: [1, 1],
  tableFormat: { ...(theme.table.tableFormat ?? {}) }
});

export const componentsSfdt = (theme: Theme): string => {
  const typeOf: Record<string, BlockFormats> = {
    cmp_h1: theme.h1,
    cmp_h2: theme.h2,
    cmp_h3: theme.h3,
    cmp_paragraph: theme.paragraph
  };
  const blocks: Record<string, any>[] = [];
  for (const anchor of SAMPLE_ANCHORS) {
    if (anchor === 'cmp_table') {
      blocks.push(sampleTable(theme));
      // close the table anchor in a trailing paragraph — a bookmark cannot
      // end inside a different cell than it starts in.
      blocks.push({
        paragraphFormat: { styleName: 'Normal' },
        characterFormat: {},
        inlines: [bookmarkEnd('cmp_table')]
      });
    } else {
      blocks.push(sampleParagraph(anchor, typeOf[anchor]));
    }
  }
  return JSON.stringify({
    optimizeSfdt: false,
    sections: [{ sectionFormat: {}, blocks, headersFooters: {} }]
  });
};

const stripStyleName = (pf?: Record<string, any>): Record<string, any> | undefined => {
  if (!pf) return undefined;
  const { styleName, ...rest } = pf;
  return rest;
};

const firstRunFormat = (para: any): Record<string, any> | undefined => {
  for (const inline of para?.inlines ?? []) {
    if (typeof inline.text === 'string') return inline.characterFormat ?? {};
  }
  return undefined;
};

const anchorsIn = (block: any): string[] => {
  const names: string[] = [];
  const walk = (paras: any[]) => {
    for (const p of paras)
      for (const i of p.inlines ?? []) {
        const n = bookmarkName(i);
        if (n && isBookmarkStart(i)) names.push(n);
      }
  };
  if (block.rows) {
    for (const row of block.rows) for (const cell of row.cells ?? []) walk(cell.blocks ?? []);
  } else {
    walk([block]);
  }
  return names;
};

export const extractTheme = (sfdt: string): Theme => {
  const doc = JSON.parse(sfdt);
  const theme: Theme = { h1: {}, h2: {}, h3: {}, paragraph: {}, table: { headerRow: {}, body: {} } };
  const keyOf: Record<string, 'h1' | 'h2' | 'h3' | 'paragraph'> = {
    cmp_h1: 'h1',
    cmp_h2: 'h2',
    cmp_h3: 'h3',
    cmp_paragraph: 'paragraph'
  };

  for (const section of doc.sections ?? []) {
    for (const block of section.blocks ?? []) {
      const anchors = anchorsIn(block);
      for (const anchor of anchors) {
        if (keyOf[anchor] && !block.rows) {
          theme[keyOf[anchor]] = {
            paragraphFormat: stripStyleName(block.paragraphFormat),
            characterFormat: firstRunFormat(block)
          };
        }
        if (anchor === 'cmp_table' && block.rows) {
          const headerCell = block.rows[0]?.cells?.[0];
          const bodyCell = block.rows[1]?.cells?.[0];
          theme.table = {
            tableFormat: block.tableFormat ?? {},
            headerRow: {
              characterFormat: firstRunFormat(headerCell?.blocks?.[0]),
              paragraphFormat: stripStyleName(headerCell?.blocks?.[0]?.paragraphFormat),
              cellFormat: headerCell?.cellFormat ?? {}
            },
            body: {
              characterFormat: firstRunFormat(bodyCell?.blocks?.[0]),
              paragraphFormat: stripStyleName(bodyCell?.blocks?.[0]?.paragraphFormat),
              cellFormat: bodyCell?.cellFormat ?? {}
            }
          };
        }
      }
    }
  }
  return theme;
};
