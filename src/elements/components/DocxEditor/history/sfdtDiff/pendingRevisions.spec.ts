// Unapproved assistant edits stay in F as live tracked changes; approved ones
// are baked into the content. applyHunks must mark the still-tracked ones so the
// viewer can outline them apart from approved edits, and countPendingGroups must
// count them (a replace counting once).
import { docWith, para, textRun } from '../../bindings/tests/realEditorHarness';
import { applyHunks, countPendingGroups, diffSession } from './index';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const pendingCustomData = (display: any): any[] =>
  (display.revisions ?? [])
    .map((r: any) => {
      try {
        return JSON.parse(r.customData ?? '{}');
      } catch {
        return {};
      }
    })
    .filter((cd: any) => cd.source === 'history');

describe('applyHunks pending (unapproved) assistant edits', () => {
  const base = docWith(para(textRun('Hello ')));

  it('marks an insertion still tracked in F as pending', () => {
    // F carries "world" as a LIVE Insertion revision (not yet accepted).
    const final = {
      ...docWith(
        para(textRun('Hello '), { text: 'world', revisionIds: ['r1'] })
      ),
      revisions: [
        { author: 'Robin', revisionType: 'Insertion', revisionId: 'r1' }
      ]
    };

    const changes = diffSession(
      base,
      [{ sfdt: clone(final), author: 'robin' }],
      's'
    );
    const display = applyHunks(clone(final), changes);

    const ours = pendingCustomData(display);
    expect(ours.length).toBeGreaterThan(0);
    expect(ours.some((cd) => cd.pending)).toBe(true);
    expect(countPendingGroups(display)).toBe(1);
  });

  it('does NOT mark the same edit pending once it is accepted (no live revision)', () => {
    // Identical content, but the insertion has been accepted: F has no revision.
    const final = docWith(para(textRun('Hello '), textRun('world')));

    const changes = diffSession(
      base,
      [{ sfdt: clone(final), author: 'robin' }],
      's'
    );
    const display = applyHunks(clone(final), changes);

    const ours = pendingCustomData(display);
    expect(ours.length).toBeGreaterThan(0);
    expect(ours.some((cd) => cd.pending)).toBe(false);
    expect(countPendingGroups(display)).toBe(0);
  });

  it('re-attributes a still-tracked edit to its real author, not the viewer', () => {
    // The live revision is authored 'Robin' (the assistant), but the diff runs
    // with the F slice tagged 'you' — the exact mis-attribution seen live. The
    // display revision must come out authored 'robin', so it renders red.
    const final = {
      ...docWith(
        para(textRun('Hello '), { text: 'world', revisionIds: ['r1'] })
      ),
      revisions: [
        { author: 'Robin', revisionType: 'Insertion', revisionId: 'r1' }
      ]
    };

    const changes = diffSession(
      base,
      [{ sfdt: clone(final), author: 'you' }],
      's'
    );
    const display = applyHunks(clone(final), changes);

    // Only our synthetic revisions survive (no orphaned 'Robin'/'you' originals).
    const authors = (display.revisions ?? []).map((r: any) => r.author);
    expect(authors).toContain('robin');
    expect(authors).not.toContain('Robin');
    // And it is flagged pending.
    expect(countPendingGroups(display)).toBe(1);
  });

  it('counts a replace (delete + insert) as one pending group', () => {
    // "Hello there" → "Hello world", with both halves still tracked in F.
    const start = docWith(para(textRun('Hello '), textRun('there')));
    const final = {
      ...docWith(
        para(
          textRun('Hello '),
          { text: 'there', revisionIds: ['d1'] },
          { text: 'world', revisionIds: ['i1'] }
        )
      ),
      revisions: [
        { author: 'Robin', revisionType: 'Deletion', revisionId: 'd1' },
        { author: 'Robin', revisionType: 'Insertion', revisionId: 'i1' }
      ]
    };

    const changes = diffSession(
      start,
      [{ sfdt: clone(final), author: 'robin' }],
      's'
    );
    const display = applyHunks(clone(final), changes);

    // Both the strikethrough and the rewrite are pending, but they share a group.
    expect(countPendingGroups(display)).toBe(1);
  });
});
