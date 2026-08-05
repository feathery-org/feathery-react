/**
 * SFDT JSON → the shapes diff.ts compares against DocumentData.
 *
 * Reads only what sync needs: block identity, style, text, token values.
 * Formatting is deliberately ignored — the theme owns formatting, and reading
 * it back would make every bold word a data change.
 *
 * Tolerant by construction: unknown inline kinds (images, fields, comments)
 * are skipped, not thrown on, so a user's manual insertions cannot break sync.
 */
import {
  blockIdFromBookmark,
  bookmarkName,
  isBookmarkEnd,
  isBookmarkStart,
  tokenKeyFromBookmark
} from '../anchors';

export type ParsedInlineRun =
  | { kind: 'text'; text: string }
  | { kind: 'token'; key: string; text: string };

export type ParsedBlock = {
  id: string | null;
  kind: 'paragraph' | 'table';
  styleName?: string;
  runs?: ParsedInlineRun[];
  cells?: ParsedInlineRun[][][];
};

export type ParsedDoc = { sections: ParsedBlock[][] };

/** Fold one paragraph's inlines into runs; reports any block anchor found. */
const runsOf = (
  inlines: any[]
): { runs: ParsedInlineRun[]; anchor: string | null } => {
  const runs: ParsedInlineRun[] = [];
  let anchor: string | null = null;
  let openToken: { key: string; text: string } | null = null;

  const pushText = (text: string) => {
    const last = runs[runs.length - 1];
    if (last && last.kind === 'text') {
      runs[runs.length - 1] = { kind: 'text', text: last.text + text };
    } else {
      runs.push({ kind: 'text', text });
    }
  };

  for (const inline of inlines ?? []) {
    const name = bookmarkName(inline);
    if (name !== null) {
      const blockId = blockIdFromBookmark(name);
      if (blockId !== null) {
        if (isBookmarkStart(inline)) anchor = anchor ?? blockId;
        continue; // block markers are identity, not content
      }
      const tokenKey = tokenKeyFromBookmark(name);
      if (tokenKey !== null) {
        if (isBookmarkStart(inline)) {
          openToken = { key: tokenKey, text: '' };
        } else if (isBookmarkEnd(inline) && openToken?.key === tokenKey) {
          runs.push({ kind: 'token', key: openToken.key, text: openToken.text });
          openToken = null;
        }
        continue;
      }
      continue; // foreign bookmark (user/Word) — identity we don't own
    }
    if (typeof inline?.text === 'string') {
      if (openToken) openToken.text += inline.text;
      else if (inline.text.length > 0) pushText(inline.text);
    }
    // anything else (images, fields, comments) is skipped
  }
  // A start with no end (torn by an edit): surface what was typed as a token
  // still, so the value is not silently lost.
  if (openToken) {
    runs.push({ kind: 'token', key: openToken.key, text: openToken.text });
  }
  return { runs, anchor };
};

const parseParagraph = (block: any): ParsedBlock => {
  const { runs, anchor } = runsOf(block.inlines);
  return {
    id: anchor,
    kind: 'paragraph',
    styleName: block.paragraphFormat?.styleName ?? 'Normal',
    runs
  };
};

const parseTable = (block: any): ParsedBlock => {
  let anchor: string | null = null;
  const cells: ParsedInlineRun[][][] = (block.rows ?? []).map((row: any) =>
    (row.cells ?? []).map((cell: any) => {
      const cellRuns: ParsedInlineRun[] = [];
      (cell.blocks ?? []).forEach((para: any, i: number) => {
        const { runs, anchor: found } = runsOf(para.inlines);
        if (found && !anchor) anchor = found;
        if (i > 0) cellRuns.push({ kind: 'text', text: '\n' });
        cellRuns.push(...runs);
      });
      return cellRuns;
    })
  );
  return { id: anchor, kind: 'table', cells };
};

export const parseSfdt = (sfdt: string): ParsedDoc => {
  const doc = JSON.parse(sfdt);
  const sections: ParsedBlock[][] = (doc.sections ?? []).map((section: any) =>
    (section.blocks ?? []).map((block: any) =>
      block.rows ? parseTable(block) : parseParagraph(block)
    )
  );
  return { sections };
};
