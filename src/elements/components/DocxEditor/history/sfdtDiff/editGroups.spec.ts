// Stepping/counting buckets: one per CONTIGUOUS block of edits (not per turn).
// A replace's delete+insert share a bucket; consecutive same-author block
// insertions coalesce into one bucket (so a whole table steps as one edit);
// separate edits — assistant or human — are separate buckets.
import {
  cellText,
  destroyRealDocumentEditor,
  docWith,
  makeRealDocumentEditor,
  para,
  row,
  table,
  textRun
} from '../../bindings/tests/realEditorHarness';
import {
  applyHunks,
  countEditGroups,
  diffSession,
  editGroupKey
} from './index';
import { stepperRevisions } from '../stepperRevisions';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('edit groups (version-bar count + steppers)', () => {
  it('keeps a deleted table as a table in the version preview', () => {
    const base = docWith(
      para(textRun('Before the table.')),
      table(
        row(cellText('Item'), cellText('Qty')),
        row(cellText('Design work'), cellText('12'))
      )
    );
    const final = docWith(para(textRun('Before the table.')));

    const changes = diffSession(
      clone(base),
      [{ sfdt: clone(final), author: 'robin' }],
      'deleted-table'
    );
    const display = applyHunks(clone(final), changes);

    expect(display.sections[0].blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rows: expect.any(Array) })
      ])
    );
  });

  it('steps a whole inserted table (all its cells) as one edit', () => {
    // Robin inserts a 2x2 table. It flattens to one hunk per cell, but every
    // cell shares the table's top-level block index, so it steps as ONE edit.
    const base = docWith(para(textRun('Before the table.')));
    const final = docWith(
      para(textRun('Before the table.')),
      table(
        row(cellText('A1'), cellText('B1')),
        row(cellText('A2'), cellText('B2'))
      )
    );
    const changes = diffSession(
      clone(base),
      [{ sfdt: clone(final), author: 'robin' }],
      's'
    );
    const display = applyHunks(clone(final), changes);
    // The table produced several hunks (one per cell)...
    expect(changes.hunks.length).toBeGreaterThan(1);
    // ...but they present as ONE edit, under a single group key.
    expect(countEditGroups(display)).toBe(1);
    const keys = new Set(
      (display.revisions ?? [])
        .map((r: any) => editGroupKey(r))
        .filter((k: string | null): k is string => k != null)
    );
    expect(keys.size).toBe(1);
  });

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

  it('does not count a trailing blank inserted line as its own edit', () => {
    // Duplicating a table leaves an empty paragraph after it. The blank line is
    // a paragraph-mark-only revision — not steppable — so it must not inflate
    // the "N edits" label either: one table + one blank line = ONE edit.
    const base = docWith(para(textRun('Intro.')));
    const final = docWith(
      para(textRun('Intro.')),
      table(row(cellText('A1'), cellText('B1'))),
      para() // the blank paragraph the duplication leaves behind
    );
    const changes = diffSession(
      clone(base),
      [{ sfdt: clone(final), author: 'robin' }],
      's'
    );
    const display = applyHunks(clone(final), changes);
    expect(countEditGroups(display)).toBe(1);
  });

  it('steps onto a user line after an inserted blank paragraph', () => {
    const base = docWith(para(textRun('Before.')));
    const final = docWith(
      para(textRun('Before.')),
      para(),
      para(textRun('second edit while editng the table'))
    );
    const changes = diffSession(
      clone(base),
      [{ sfdt: clone(final), author: 'you' }],
      's'
    );
    expect(changes.hunks).toEqual([
      expect.objectContaining({ type: 'ins_block', count: 2 })
    ]);
    const display = applyHunks(clone(final), changes);
    const blocks = display.sections[0].blocks;
    const blankId = blocks[1].characterFormat.revisionIds[0];
    const lineId = blocks[2].inlines[0].revisionIds[0];
    const blankRevision = display.revisions.find(
      (revision: any) => revision.revisionId === blankId
    );
    const lineRevision = display.revisions.find(
      (revision: any) => revision.revisionId === lineId
    );
    expect(lineId).not.toBe(blankId);
    expect(editGroupKey(lineRevision)).not.toBe(editGroupKey(blankRevision));
    expect(countEditGroups(display)).toBe(1);

    // Syncfusion exposes the loaded text revision through changes, even when
    // its separate revisions array contains only the blank paragraph mark.
    const editor = makeRealDocumentEditor(display);
    try {
      const navigable = stepperRevisions(editor);
      const target = navigable.find((revision: any) =>
        (revision.range ?? []).some(
          (range: any) => range.text === 'second edit while editng the table'
        )
      );
      expect(target).toBeDefined();
      expect(editGroupKey(target)).toBe(editGroupKey(lineRevision));
      expect(() =>
        editor.selection.selectRevision(target, undefined, undefined, true)
      ).not.toThrow();
    } finally {
      destroyRealDocumentEditor(editor);
    }
  });

  it('still counts a version whose only change is a blank line', () => {
    // Nothing but a blank-line insertion: fall back to counting the group so
    // the version doesn't claim "0 edits" while showing a change.
    const base = docWith(para(textRun('Intro.')));
    const final = docWith(para(textRun('Intro.')), para());
    const changes = diffSession(
      clone(base),
      [{ sfdt: clone(final), author: 'you' }],
      's'
    );
    const display = applyHunks(clone(final), changes);
    expect(countEditGroups(display)).toBe(1);
  });

  it('ignores revisions that are not ours', () => {
    expect(editGroupKey({ author: 'Robin', customData: undefined })).toBeNull();
    expect(
      editGroupKey({ author: 'x', customData: '{"source":"other"}' })
    ).toBeNull();
  });
});
