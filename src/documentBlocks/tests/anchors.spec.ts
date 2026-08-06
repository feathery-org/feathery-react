import {
  blockBookmark,
  tokenBookmark,
  bookmarkStart,
  bookmarkEnd,
  isBookmarkStart,
  bookmarkName,
  blockIdFromBookmark,
  tokenKeyFromBookmark
} from '../anchors';

describe('anchors', () => {
  it('round-trips a block id through its bookmark name', () => {
    expect(blockIdFromBookmark(blockBookmark('blk_title'))).toBe('blk_title');
    expect(blockIdFromBookmark('ftk_total')).toBeNull();
    expect(blockIdFromBookmark('unrelated')).toBeNull();
  });

  it('names a token bookmark by value key, matching the shipped contract', () => {
    expect(tokenBookmark({ id: 'total', format: { kind: 'text' } })).toBe('ftk_total');
    expect(tokenBookmark({ id: 'qty', index: 2, format: { kind: 'number' } })).toBe('ftk_qty__2');
    expect(tokenKeyFromBookmark('ftk_qty__2')).toBe('qty__2');
    expect(tokenKeyFromBookmark('fblk_x')).toBeNull();
  });

  it('emits SFDT bookmark inlines the parser can recognize', () => {
    const start = bookmarkStart('fblk_a');
    const end = bookmarkEnd('fblk_a');
    expect(isBookmarkStart(start)).toBe(true);
    expect(isBookmarkStart(end)).toBe(false);
    expect(bookmarkName(start)).toBe('fblk_a');
    expect(bookmarkName({ text: 'plain run' })).toBeNull();
  });
});
