import {
  applyHunks,
  diffSession,
  normalizeForDiff,
  trackedAuthorKeys
} from './index';
import { getBlock } from './ir';

const shape = (id: number, ...paragraphs: string[]) => ({
  shapeId: id,
  autoShapeType: 'Rectangle',
  textFrame: {
    blocks: paragraphs.map((text) => ({ inlines: [{ text }] }))
  }
});

const doc = (...blocks: any[]) => ({ sections: [{ blocks }] });
const para = (...inlines: any[]) => ({
  inlines: inlines.map((i) => (typeof i === 'string' ? { text: i } : i))
});

const diff = (from: any, to: any, author = 'robin') =>
  diffSession(from, [{ sfdt: to, author }], 'session');

// The box's paragraph in a display document whose first block holds the shape.
const boxParagraph = (display: any, block = 0) =>
  getBlock(display, [
    0,
    'blocks',
    block,
    'inlines',
    1,
    'textFrame',
    'blocks',
    0
  ]);

describe('text boxes in version history diffs', () => {
  it('counts and attributes an edit inside a text box', () => {
    const before = doc(para('Intro ', shape(7, 'Premium Summary')));
    const after = doc(para('Intro ', shape(7, 'Premium Overview')));

    const changes = diff(before, after);

    expect(changes.changeCount).toBeGreaterThan(0);
    expect(changes.authors).toEqual(['robin']);
    const display = applyHunks(after, changes);
    expect(trackedAuthorKeys(display)).toEqual(['robin']);
    // The highlight lands inside the box, not in the body paragraph.
    expect(
      boxParagraph(display).inlines.some((i: any) => i.revisionIds?.length)
    ).toBe(true);
  });

  it('finds nothing to diff when the text box is unchanged', () => {
    const same = doc(para('Intro ', shape(7, 'Premium Summary')));
    expect(diff(same, same).changeCount).toBe(0);
  });

  it('keeps a box aligned when a paragraph is added above it', () => {
    const before = doc(para('Intro ', shape(7, 'Box text')));
    const after = doc(
      para('A new opening line'),
      para('Intro ', shape(7, 'Box text edited'))
    );

    const changes = diff(before, after, 'you');

    // One added paragraph and one in-box edit; the box is not re-added whole.
    expect(changes.hunks.filter((h) => h.type === 'ins_block')).toHaveLength(1);
    expect(changes.hunks.some((h) => h.type === 'del_block')).toBe(false);
    const display = applyHunks(after, changes);
    expect(
      boxParagraph(display, 1).inlines.some((i: any) => i.revisionIds?.length)
    ).toBe(true);
  });

  it('does not spill a deleted shape’s text into the body', () => {
    const before = doc(
      para('Intro ', shape(7, 'Gone with the box')),
      para('End')
    );
    const after = doc(para('Intro '), para('End'));

    const changes = diff(before, after, 'you');
    const display = applyHunks(after, changes);

    const bodyText = JSON.stringify(display.sections[0].blocks);
    expect(bodyText).not.toContain('Gone with the box');
    expect(changes.hunks.some((h) => h.type === 'del_block')).toBe(false);
  });

  it('treats pending tracked changes inside a text box like body text', () => {
    const pending = {
      sections: [
        {
          blocks: [
            para('Intro ', {
              shapeId: 7,
              textFrame: {
                blocks: [
                  {
                    inlines: [
                      { text: 'kept ' },
                      { text: 'removed', revisionIds: ['d1'] },
                      { text: 'added', revisionIds: ['i1'] }
                    ]
                  }
                ]
              }
            })
          ]
        }
      ],
      revisions: [
        { revisionId: 'd1', revisionType: 'Deletion' },
        { revisionId: 'i1', revisionType: 'Insertion' }
      ]
    };

    const normalized = normalizeForDiff(pending);
    const inlines = boxParagraph(normalized).inlines;
    expect(inlines.map((i: any) => i.text)).toEqual(['kept ', 'added']);
    expect(inlines.some((i: any) => i.revisionIds)).toBe(false);
  });
});
