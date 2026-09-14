// Stepping/counting buckets: one per CONTIGUOUS block of edits (not per turn).
// A replace's delete+insert share a bucket; consecutive same-author block
// insertions coalesce into one bucket (so a whole table steps as one edit);
// separate edits — assistant or human — are separate buckets.
import { docWith, para, textRun } from '../../bindings/tests/realEditorHarness';
import {
  applyHunks,
  countEditGroups,
  diffSession,
  editGroupKey
} from './index';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('edit groups (version-bar count + steppers)', () => {
  it('treats a contiguous block Robin inserted as one edit group', () => {
    // Robin appends two CONSECUTIVE new paragraphs — one contiguous block, the
    // way an inserted table would be. They coalesce into a single ins_block hunk
    // and step as ONE edit.
    const base = docWith(para(textRun('Intro.')));
    const final = docWith(
      para(textRun('Intro.')),
      para(textRun('Robin line one.')),
      para(textRun('Robin line two.'))
    );
    const changes = diffSession(
      clone(base),
      [{ sfdt: clone(final), author: 'robin' }],
      's'
    );
    const display = applyHunks(clone(final), changes);
    expect(countEditGroups(display)).toBe(1);
  });

  it('steps two separate Robin edits as two groups (no turn collapse)', () => {
    // Robin edits two SEPARATE paragraphs — non-contiguous, so two steps.
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
    expect(changes.hunks.length).toBeGreaterThan(1);
    const display = applyHunks(clone(final), changes);
    expect(countEditGroups(display)).toBe(2);
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

  it('groups a mixed session per edit block: user + each Robin block', () => {
    const base = docWith(
      para(textRun('Paragraph one is here.')),
      para(textRun('Paragraph two is here.')),
      para(textRun('Paragraph three is here.'))
    );
    // Slice 1: the user edits paragraph 1. Slice 2 (F): Robin edits 2 and 3
    // (two separate, non-contiguous paragraphs).
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
    // Robin's edits are attributed to Robin (not collapsed to a turn constant).
    const robinRevs = (display.revisions ?? []).filter(
      (r: any) => r.author === 'robin' && editGroupKey(r) != null
    );
    expect(robinRevs.length).toBeGreaterThan(0);
    // 1 user edit + 2 separate Robin paragraph edits.
    expect(countEditGroups(display)).toBe(3);
  });

  it('ignores revisions that are not ours', () => {
    expect(editGroupKey({ author: 'Robin', customData: undefined })).toBeNull();
    expect(
      editGroupKey({ author: 'x', customData: '{"source":"other"}' })
    ).toBeNull();
  });
});
