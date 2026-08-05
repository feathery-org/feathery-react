/**
 * How data identity survives inside the document: bookmark pairs.
 *
 * A bookmark is a pair of named zero-width markers that Word, Syncfusion, and
 * SFDT all round-trip losslessly — the same anchor the shipped token contract
 * uses (`ftk_<valueKey>`). Blocks get `fblk_<blockId>`. Everything the rest of
 * the system knows about anchors goes through this module, so switching to
 * block-level content controls later is a one-file change.
 */
import { TokenSpec, valueKey } from '../documentTokens/plan';

export const BLOCK_ANCHOR_PREFIX = 'fblk_';
const TOKEN_ANCHOR_PREFIX = 'ftk_';

export const blockBookmark = (blockId: string): string =>
  `${BLOCK_ANCHOR_PREFIX}${blockId}`;

export const tokenBookmark = (spec: TokenSpec): string =>
  `${TOKEN_ANCHOR_PREFIX}${valueKey(spec)}`;

export const blockIdFromBookmark = (name: string): string | null =>
  name.startsWith(BLOCK_ANCHOR_PREFIX)
    ? name.slice(BLOCK_ANCHOR_PREFIX.length)
    : null;

export const tokenKeyFromBookmark = (name: string): string | null =>
  name.startsWith(TOKEN_ANCHOR_PREFIX)
    ? name.slice(TOKEN_ANCHOR_PREFIX.length)
    : null;

/** SFDT inline for a bookmark start marker. */
export const bookmarkStart = (name: string): Record<string, any> => ({
  characterFormat: {},
  bookmarkType: 0,
  name
});

/** SFDT inline for a bookmark end marker. */
export const bookmarkEnd = (name: string): Record<string, any> => ({
  characterFormat: {},
  bookmarkType: 1,
  name
});

export const isBookmarkStart = (inline: any): boolean =>
  inline?.bookmarkType === 0 && typeof inline?.name === 'string';

export const isBookmarkEnd = (inline: any): boolean =>
  inline?.bookmarkType === 1 && typeof inline?.name === 'string';

export const bookmarkName = (inline: any): string | null =>
  typeof inline?.name === 'string' &&
  (inline.bookmarkType === 0 || inline.bookmarkType === 1)
    ? inline.name
    : null;
