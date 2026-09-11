// Stepping/counting buckets: one per logical edit. A replace's delete+insert
// share a bucket, and ALL of the assistant's revisions collapse into ONE bucket
// (a session holds at most one Robin turn, and that turn is one logical edit).
import { docWith, para, textRun } from '../../bindings/tests/realEditorHarness';
import {
  applyHunks,
  countEditGroups,
  diffSession,
  editGroupKey
} from './index';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('edit groups (version-bar count + steppers)', () => {
  it('collapses a whole Robin turn into one edit group', () => {
    // Robin edits two separate paragraphs in one turn.
    const base = docWith(
      para(textRun('First paragraph.')),
      para(textRun('Second paragraph.'))
    );
    const final = docWith(
      para(textRun('First paragraph, amended.')),
      para(textRun('Second paragraph, also amended.'))
    );
    const changes = diffSession(
      clone(base),
      [{ sfdt: clone(final), author: 'robin' }],
      's'
    );
    // The diff produced several hunks, but they present as ONE edit.
    expect(changes.hunks.length).toBeGreaterThan(1);
    const display = applyHunks(clone(final), changes);
    expect(countEditGroups(display)).toBe(1);
  });

  it('keeps separate user edits as separate groups, a replace as one', () => {
    const base = docWith(
      para(textRun('Alpha one.')),
      para(textRun('Beta two.'))
    );
    // A replace in the first paragraph and an insertion in the second.
    const final = docWith(
      para(textRun('Alpha ONE.')),
      para(textRun('Beta two three.'))
    );
    const changes = diffSession(
      clone(base),
      [{ sfdt: clone(final), author: 'you' }],
      's'
    );
    const display = applyHunks(clone(final), changes);
    expect(countEditGroups(display)).toBe(2);
  });

  it('collapses Robin but not the user in a mixed session', () => {
    const base = docWith(
      para(textRun('Paragraph one is here.')),
      para(textRun('Paragraph two is here.')),
      para(textRun('Paragraph three is here.'))
    );
    // Slice 1: the user edits paragraph 1. Slice 2 (F): Robin edits 2 and 3.
    const mid = docWith(
      para(textRun('Paragraph one is here now.')),
      para(textRun('Paragraph two is here.')),
      para(textRun('Paragraph three is here.'))
    );
    const final = docWith(
      para(textRun('Paragraph one is here now.')),
      para(textRun('Paragraph two is here, says Robin.')),
      para(textRun('Paragraph three is here, says Robin.'))
    );
    const changes = diffSession(
      clone(base),
      [
        { sfdt: clone(mid), author: 'you' },
        { sfdt: clone(final), author: 'robin' }
      ],
      's'
    );
    const display = applyHunks(clone(final), changes);
    const robinRevs = (display.revisions ?? []).filter(
      (r: any) => editGroupKey(r) === 'robin-turn'
    );
    expect(robinRevs.length).toBeGreaterThan(0);
    // 1 user edit + 1 collapsed Robin turn.
    expect(countEditGroups(display)).toBe(2);
  });

  it('ignores revisions that are not ours', () => {
    expect(editGroupKey({ author: 'Robin', customData: undefined })).toBeNull();
    expect(
      editGroupKey({ author: 'x', customData: '{"source":"other"}' })
    ).toBeNull();
  });
});
