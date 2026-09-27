// Unapproved assistant edits stay in F as live tracked changes; approved ones
// are baked into the content. applyHunks must mark the still-tracked ones so the
// viewer can outline them apart from approved edits, and countPendingGroups must
// count them (a replace counting once).
import {
  destroyRealDocumentEditor,
  docWith,
  makeRealDocumentEditor,
  para,
  textRun
} from '../../bindings/tests/realEditorHarness';
import {
  applyHunks,
  countPendingGroups,
  diffSession,
  editGroupKey
} from './index';

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

  it('preserves pending metadata after the display SFDT opens in Syncfusion', () => {
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
    const editor = makeRealDocumentEditor(display);
    try {
      const live = ((editor as any).revisions?.changes ?? []).filter(
        (revision: any) => revision.author === 'robin'
      );
      expect(live.length).toBeGreaterThan(0);
      expect(
        live.some((revision: any) => {
          try {
            return JSON.parse(revision.customData ?? '{}').pending === true;
          } catch {
            return false;
          }
        })
      ).toBe(true);
    } finally {
      destroyRealDocumentEditor(editor);
    }
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

describe('applyHunks approved-Robin re-attribution (durable robinRuns)', () => {
  const base = docWith(para(textRun('Hello ')));
  // An ACCEPTED Robin insertion: the text is in F but there is no live revision.
  const acceptedFinal = docWith(para(textRun('Hello '), textRun('world')));

  const authorsOf = (display: any): string[] =>
    (display.revisions ?? []).map((r: any) => r.author);

  it('does not mark an accepted suggestion pending because identical text is still pending elsewhere', () => {
    const start = docWith(
      para(textRun('First ')),
      para(textRun('Second same words'))
    );
    const final = {
      ...docWith(
        para(textRun('First same words')),
        para(textRun('Second '), { text: 'same words', revisionIds: ['other'] })
      ),
      revisions: [
        { author: 'Robin', revisionType: 'Insertion', revisionId: 'other' }
      ]
    };
    const changes = diffSession(
      start,
      [{ sfdt: final, author: 'robin' }],
      'confirmed'
    );
    changes.confirmed = true;
    changes.attribution = 'slices';
    const display = applyHunks(final, changes);
    expect(countPendingGroups(display)).toBe(0);
  });

  it('keeps an accepted Robin edit coloured as Robin even when the diff mis-credits it to the viewer', () => {
    // The diff runs with the F slice tagged 'you' (the mis-attribution), and the
    // edit is accepted (no live revision to rescue it) — but the change list
    // carries Robin's captured run, so it must re-attribute to 'robin'.
    const changes = diffSession(
      base,
      [{ sfdt: clone(acceptedFinal), author: 'you' }],
      's'
    );
    changes.robinRuns = [{ kind: 'ins', text: 'world' }];
    const display = applyHunks(clone(acceptedFinal), changes);

    expect(authorsOf(display)).toContain('robin');
    // Approved, not suggested: no pending group (no dashed ring).
    expect(countPendingGroups(display)).toBe(0);
  });

  it('keeps the Robin tracked-change group after the edit is accepted and restored', () => {
    const changes = diffSession(
      base,
      [{ sfdt: clone(acceptedFinal), author: 'you' }],
      's'
    );
    // This is persisted in the version's changes artifact while the live Robin
    // revision still exists. A restored version must retain the same group key.
    changes.robinRuns = [
      { kind: 'ins', text: 'world', group: 'add-premium-table' }
    ];
    const display = applyHunks(clone(acceptedFinal), changes);
    const robinRevision = (display.revisions ?? []).find(
      (revision: any) => revision.author === 'robin'
    );

    expect(editGroupKey(robinRevision)).toBe('add-premium-table');
  });

  it('without robinRuns the same accepted edit stays mis-credited (guards the gap it fixes)', () => {
    const changes = diffSession(
      base,
      [{ sfdt: clone(acceptedFinal), author: 'you' }],
      's'
    );
    const display = applyHunks(clone(acceptedFinal), changes);

    // No durable run: the accepted edit keeps the diff's (wrong) 'you' author.
    expect(authorsOf(display)).toContain('you');
    expect(authorsOf(display)).not.toContain('robin');
  });

  it('a live pending revision still wins over robinRuns (stays pending)', () => {
    // Same text, but still tracked in F: the live match must take precedence and
    // mark it pending, not fall through to the approved (no-ring) path.
    const pendingFinal = {
      ...docWith(
        para(textRun('Hello '), { text: 'world', revisionIds: ['r1'] })
      ),
      revisions: [
        { author: 'Robin', revisionType: 'Insertion', revisionId: 'r1' }
      ]
    };
    const changes = diffSession(
      base,
      [{ sfdt: clone(pendingFinal), author: 'you' }],
      's'
    );
    changes.robinRuns = [{ kind: 'ins', text: 'world' }];
    const display = applyHunks(clone(pendingFinal), changes);

    expect(authorsOf(display)).toContain('robin');
    expect(countPendingGroups(display)).toBe(1);
  });

  it('does not tint a genuine user edit that robinRuns does not mention', () => {
    const changes = diffSession(
      base,
      [{ sfdt: clone(acceptedFinal), author: 'you' }],
      's'
    );
    changes.robinRuns = [{ kind: 'ins', text: 'something else entirely' }];
    const display = applyHunks(clone(acceptedFinal), changes);

    expect(authorsOf(display)).toContain('you');
    expect(authorsOf(display)).not.toContain('robin');
  });

  it('does not attribute a short common-word edit from a longer Robin run', () => {
    const start = docWith(para(textRun('Hello world')));
    const final = docWith(para(textRun('Hello the')));
    const changes = diffSession(start, [{ sfdt: final, author: 'you' }], 's');
    changes.robinRuns = [{ kind: 'ins', text: 'there' }];
    const display = applyHunks(clone(final), changes);

    expect(authorsOf(display)).not.toContain('robin');
  });
});
