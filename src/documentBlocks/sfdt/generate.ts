/**
 * DocumentData → SFDT JSON. Pure: no editor, no DOM. The inverse of parse.ts;
 * the round-trip test in parse.spec.ts is the contract between them.
 *
 * Generation never computes a token value — it renders what tokens.ts already
 * resolved. That keeps one evaluator in the system (documentTokens/plan).
 */
import {
  Block,
  BlockFormats,
  BlockType,
  Cell,
  DocumentData,
  Inline,
  Theme
} from '../types';
import {
  blockBookmark,
  bookmarkEnd,
  bookmarkStart,
  tokenBookmark
} from '../anchors';
import { valueKey } from '../../documentTokens/plan';

const HEADING_STYLES: Record<BlockType, string> = {
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  paragraph: 'Normal',
  table: 'Normal'
};

const textRun = (text: string, characterFormat: Record<string, any>) => ({
  characterFormat: { ...characterFormat },
  text
});

/** Inline[] → SFDT inlines, tokens wrapped in their ftk_ bookmark pair. */
const inlinesFor = (
  content: Inline[],
  characterFormat: Record<string, any>,
  tokenValues: Map<string, string>
): Record<string, any>[] => {
  const out: Record<string, any>[] = [];
  for (const inline of content) {
    if (inline.kind === 'text') {
      if (inline.text.length > 0) out.push(textRun(inline.text, characterFormat));
      continue;
    }
    const name = tokenBookmark(inline.spec);
    const rendered = tokenValues.get(valueKey(inline.spec)) ?? '';
    out.push(bookmarkStart(name));
    // No empty run between adjacent markers: Syncfusion drops empty runs, and
    // parse treats adjacent markers as an empty token value by design.
    if (rendered.length > 0) out.push(textRun(rendered, characterFormat));
    out.push(bookmarkEnd(name));
  }
  return out;
};

const paragraphFor = (
  block: Block,
  formats: BlockFormats,
  tokenValues: Map<string, string>
): Record<string, any> => {
  const characterFormat = { ...(formats.characterFormat ?? {}) };
  const anchor = blockBookmark(block.id);
  return {
    paragraphFormat: {
      styleName: HEADING_STYLES[block.type],
      ...(formats.paragraphFormat ?? {})
    },
    characterFormat,
    inlines: [
      bookmarkStart(anchor),
      ...inlinesFor(block.content ?? [], characterFormat, tokenValues),
      bookmarkEnd(anchor)
    ]
  };
};

const cellFor = (
  cell: Cell,
  formats: BlockFormats & { cellFormat?: Record<string, any> },
  tokenValues: Map<string, string>,
  leadingInlines: Record<string, any>[],
  trailingInlines: Record<string, any>[]
): Record<string, any> => ({
  blocks: [
    {
      paragraphFormat: { ...(formats.paragraphFormat ?? {}) },
      characterFormat: { ...(formats.characterFormat ?? {}) },
      inlines: [
        ...leadingInlines,
        ...inlinesFor(cell.content, formats.characterFormat ?? {}, tokenValues),
        ...trailingInlines
      ]
    }
  ],
  cellFormat: { ...(formats.cellFormat ?? {}) }
});

const tableFor = (
  block: Block,
  theme: Theme,
  tokenValues: Map<string, string>
): Record<string, any> => {
  const anchor = blockBookmark(block.id);
  const rows = (block.rows ?? []).map((row, rowIndex) => {
    const formats = rowIndex === 0 ? theme.table.headerRow : theme.table.body;
    return {
      rowFormat: { isHeader: rowIndex === 0 },
      cells: row.map((cell, cellIndex) => {
        // The block anchor opens AND closes inside the first cell's first
        // paragraph — a bookmark spanning cells does not survive Syncfusion's
        // serializer.
        const isAnchorCell = rowIndex === 0 && cellIndex === 0;
        return cellFor(
          cell,
          formats,
          tokenValues,
          isAnchorCell ? [bookmarkStart(anchor)] : [],
          isAnchorCell ? [bookmarkEnd(anchor)] : []
        );
      })
    };
  });
  return {
    rows,
    grid: (block.rows?.[0] ?? []).map(() => 1),
    tableFormat: { ...(theme.table.tableFormat ?? {}) }
  };
};

const blockFor = (
  block: Block,
  theme: Theme,
  tokenValues: Map<string, string>
): Record<string, any> =>
  block.type === 'table'
    ? tableFor(block, theme, tokenValues)
    : paragraphFor(block, theme[block.type], tokenValues);

export const generateSfdt = (
  data: DocumentData,
  tokenValues: Map<string, string>
): string => {
  const sections = data.sections.map((section) => ({
    sectionFormat: {},
    blocks: section.blocks.map((b) => blockFor(b, data.theme, tokenValues)),
    headersFooters: {}
  }));
  return JSON.stringify({ optimizeSfdt: false, sections });
};
