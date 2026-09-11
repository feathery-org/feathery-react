/**
 * An anchor counts blocks the way a READER sees them; the SFDT stores them the
 * way the document does. Those two numberings diverge, and the copy path has to
 * translate between them.
 *
 * From Ayesha's review. A block-level content control wrapping N blocks
 * contributes N addresses while occupying ONE raw slot, so indexing raw blocks
 * with an expanded number drifts by one per extra child. In the document below,
 * the anchor for "Four" is 0;3 while "Four" is raw block 2 - so a copy reaching
 * that far took "Five" instead, and the read-back compared the paste against
 * that same wrong clone and approved it.
 */
import { flattenSfdt } from '../syncfusionDocumentOps';

const wrapper = (...texts: string[]) => ({
  contentControlProperties: {
    lockContentControl: true,
    lockContents: false,
    tag: 'wrap',
    title: 'wrap',
    type: 'RichText',
    hasPlaceHolderText: false,
    multiline: true,
    isTemporary: false,
    color: '#00000000',
    appearance: 'BoundingBox'
  },
  blocks: texts.map((text) => ({ inlines: [{ text }] }))
});

const document = () => ({
  sections: [
    {
      blocks: [
        { inlines: [{ text: 'One' }] },
        wrapper('WrapA', 'WrapB'),
        { inlines: [{ text: 'Four' }] },
        { inlines: [{ text: 'Five' }] }
      ]
    }
  ]
});

describe('addresses versus raw block storage', () => {
  it('numbers a wrapperholding two blocks as two addresses', () => {
    const blocks = (flattenSfdt(document()) as any[]).filter(
      (block) => block.anchor.split(';').length === 2
    );

    // Five addresses over four raw blocks: the wrapper is transparent to a
    // reader, so its children are addressed individually.
    expect(blocks.map((block) => [block.anchor, block.text])).toEqual([
      ['0;0', 'One'],
      ['0;1', 'WrapA'],
      ['0;2', 'WrapB'],
      ['0;3', 'Four'],
      ['0;4', 'Five']
    ]);
    expect(document().sections[0].blocks).toHaveLength(4);
  });

  it('an address past a wrapper does not name the raw block of the same number', () => {
    // The property that makes translation necessary, stated once so nobody
    // re-derives it: beyond a multi-child wrapper the two numberings differ,
    // and code holding one must never index the other.
    const raw = document().sections[0].blocks;
    const rawIndexOfFour = raw.findIndex(
      (block: any) => !block.blocks && block.inlines[0].text === 'Four'
    );
    const addressOfFour = (flattenSfdt(document()) as any[]).find(
      (block) => block.text === 'Four'
    ).anchor;

    expect(addressOfFour).toBe('0;3');
    expect(rawIndexOfFour).toBe(2);
  });
});
