// Deleting rows that are THEMSELVES an unaccepted insertion.
//
// The captain's reproduction, in two turns: "add 10 mock rows to Coverages and
// Limits" worked, then "delete the mock coverage 3 to 7" removed ONE row of the
// five and reported that it had not gone through cleanly. Two defects in one
// request, and this spec pins both, plus the messages that described neither
// honestly.
//
//   1. SyncFusion does not mark content that is itself an unaccepted insertion as
//      deleted - it WITHDRAWS it, because it was never in the document a reviewer
//      had agreed to. No Deletion revision exists, so the structural branch of
//      `assertTrackedMutation` refused - AFTER the row was already gone, with a
//      rollback that rejects revisions and so had nothing to put back. The engine
//      reported "nothing was written" over a document it had permanently changed.
//
//   2. A row set was one op per row. The first withdrawal physically removes its
//      row, every row below it shifts, and the next op has to re-resolve its
//      anchor by text - which empty, freshly-inserted rows cannot be told apart
//      by. So op 2 onwards died on `anchor_relocation_ambiguous` and four of the
//      captain's five rows stayed behind. One `deleteRow` over a spanning
//      selection is the fix, and it is also what makes the whole set ONE card.
//
// What is asserted throughout is the OUTCOME, never a revision count as a proxy
// for it: the rows the user ends up with, what accept and reject each produce,
// and that reject restores the pristine rows wherever a revision still exists.
// A withdrawal deliberately has no such promise - there is nothing left to reject
// - which is exactly why the count travels back on the result.
import 'jest-canvas-mock';
import {
  DocumentEditor,
  Editor,
  EditorHistory,
  ImageResizer,
  Search,
  Selection,
  SfdtExport
} from '@syncfusion/ej2-documenteditor';

import { DOCUMENT_EDITOR_CAPABILITIES } from '../../../capabilities/registry';
import { listRevisionGroups } from '../../../../utils/documentEditorPrimitives';
import {
  applyDocumentEdits,
  flattenSfdt,
  EditOp,
  LiveEditor
} from '../syncfusionDocumentOps';

DocumentEditor.Inject(
  Editor,
  Selection,
  SfdtExport,
  EditorHistory,
  ImageResizer,
  Search
);

if (!window.crypto?.getRandomValues) {
  Object.defineProperty(window, 'crypto', {
    value: {
      getRandomValues: (array: Uint8Array) =>
        require('crypto').randomFillSync(array)
    }
  });
}
if (!(window.SVGElement.prototype as any).getBBox) {
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);
}

function makeEditor(sfdt: any): DocumentEditor {
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '700px';
  document.body.appendChild(host);
  const editor = new DocumentEditor({
    isReadOnly: false,
    enableEditor: true,
    enableSelection: true,
    enableImageResizer: true,
    enableSearch: true,
    enableSfdtExport: true,
    enableEditorHistory: true
  });
  editor.appendTo(host);
  editor.open(JSON.stringify(sfdt));
  return editor;
}

function destroyEditor(editor: DocumentEditor): void {
  const element = editor.element;
  editor.destroy();
  element?.remove();
}

const para = (text: string) => ({ inlines: text ? [{ text }] : [] });

const cell = (text: string) => ({
  cellFormat: {},
  blocks: [{ inlines: [{ text }] }]
});

/** One header row over `dataRows` data rows, the captain's schedule shape. */
const scheduleTable = (dataRows: number) => ({
  tableFormat: { allowAutoFit: true },
  rows: [
    { rowFormat: { isHeader: true }, cells: [cell('Line'), cell('Carrier')] },
    ...Array.from({ length: dataRows }, (_, index) => ({
      rowFormat: {},
      cells: [cell(`Line ${index}`), cell(`Carrier ${index}`)]
    }))
  ]
});

// A paragraph FOLLOWS the table, so the document-tail-table refusal - a separate
// rule about a separate SyncFusion defect - cannot fire and confuse a result here.
const fixture = (dataRows = 3) => ({
  sections: [
    {
      blocks: [
        para('Coverage Schedule'), // 0;0
        para('All lines are listed below.'), // 0;1
        scheduleTable(dataRows), // 0;2
        para('Confirm by Friday.') // 0;3
      ]
    }
  ]
});

/** Two tables with nothing between them - the shape the span corruption needs. */
const adjacentTablesFixture = () => ({
  sections: [
    {
      blocks: [
        para('Coverage Schedule'), // 0;0
        scheduleTable(3), // 0;1
        scheduleTable(3), // 0;2 - immediately after, no paragraph between
        para('Confirm by Friday.') // 0;3
      ]
    }
  ]
});

const apply = (editor: DocumentEditor, edits: EditOp[], changeSetId: string) =>
  applyDocumentEdits(editor as unknown as LiveEditor, { edits, changeSetId });

/** Every row of one table, as "[cell|cell]", in document order. */
const rowTextsOf = (editor: DocumentEditor, tableAnchor: string): string[] => {
  const byRow = new Map<string, string[]>();
  for (const block of flattenSfdt(JSON.parse(editor.serialize())).filter(
    (candidate) =>
      candidate.kind === 'table_cell' &&
      candidate.anchor.startsWith(`${tableAnchor};`)
  )) {
    const key = block.anchor.split(';').slice(0, 3).join(';');
    byRow.set(key, [...(byRow.get(key) ?? []), block.text]);
  }
  return Array.from(byRow.values()).map((texts) => `[${texts.join('|')}]`);
};

/** The table under test in the single-table fixtures. */
const rowTexts = (editor: DocumentEditor): string[] =>
  rowTextsOf(editor, '0;2');

/** Track changes on, authored by the assistant - the only way it ever writes. */
const asRobin = (editor: DocumentEditor): DocumentEditor => {
  editor.enableTrackChanges = true;
  editor.currentUser = 'Robin';
  return editor;
};

/** Every live revision's type, in order - "what the review rail is showing". */
const revisionTypes = (editor: DocumentEditor): string[] =>
  Array.from({ length: editor.revisions.length }, (_, index) =>
    String((editor.revisions as any).get(index)?.revisionType ?? '')
  );

/** Reject every revision on a COPY, so the caller keeps its live editor. */
const rowsAfterRejectingAll = (editor: DocumentEditor): string[] => {
  const copy = makeEditor(JSON.parse(editor.serialize()));
  try {
    copy.revisions.rejectAll();
    return rowTexts(copy);
  } finally {
    destroyEditor(copy);
  }
};

/** Accept every revision on a COPY, same reason. */
const rowsAfterAcceptingAll = (editor: DocumentEditor): string[] => {
  const copy = makeEditor(JSON.parse(editor.serialize()));
  try {
    copy.revisions.acceptAll();
    return rowTexts(copy);
  } finally {
    destroyEditor(copy);
  }
};

describe('one pending-inserted row, deleted', () => {
  // The single-row face of the captain's report: the engine used to answer
  // untracked_write here, over a document from which it had already removed the
  // row, and its rollback could not put the row back because a withdrawal leaves
  // no revision to reject.
  it('reports ok, says the insertion was withdrawn, and leaves the pristine rows', () => {
    const editor = asRobin(makeEditor(fixture()));
    try {
      const pristine = rowTexts(editor);
      expect(
        apply(
          editor,
          [{ op: 'insert_row', anchor: '0;2;1;0;0', above: false, count: 1 }],
          'add-one'
        ).results[0]
      ).toMatchObject({ ok: true });
      expect(rowTexts(editor)).toHaveLength(pristine.length + 1);

      const result = apply(
        editor,
        [{ op: 'delete_row', anchor: '0;2;2;0;0' }],
        'remove-one'
      ).results[0];

      expect(result).toMatchObject({
        ok: true,
        op: 'delete_row',
        withdrewPendingInsertion: 1
      });
      expect(result.error).toBeUndefined();
      // The row is gone, and what is left is exactly the document before the
      // insertion - so there is nothing for a reviewer to decide about it.
      expect(rowTexts(editor)).toEqual(pristine);
      expect(rowsAfterRejectingAll(editor)).toEqual(pristine);
      expect(rowsAfterAcceptingAll(editor)).toEqual(pristine);
    } finally {
      destroyEditor(editor);
    }
  });
});

describe("the captain's request: five of ten pending rows, in one op", () => {
  // "add 10 mock rows" then "delete the mock coverage 3 to 7". Five rows, one
  // `delete_row` carrying the whole set - which is the only shape that can work,
  // because the first withdrawal moves every row the later ones were aimed at.
  const addTenThenDeleteFive = (editor: DocumentEditor) => {
    expect(
      apply(
        editor,
        [{ op: 'insert_row', anchor: '0;2;1;0;0', above: false, count: 10 }],
        'add-ten'
      ).results[0]
    ).toMatchObject({ ok: true });
    // Rows 2..11 are the ten pending insertions. Take five out of the MIDDLE of
    // them, so pending rows remain both above and below the deleted run.
    return apply(
      editor,
      [{ op: 'delete_row', anchor: '0;2;0;0;0', rows: [4, 5, 6, 7, 8] }],
      'remove-five'
    ).results[0];
  };

  it('removes all five, not one, and accounts for them as withdrawals', () => {
    const editor = asRobin(makeEditor(fixture()));
    try {
      const pristine = rowTexts(editor);
      const before = rowTexts(editor).length;

      const result = addTenThenDeleteFive(editor);

      expect(result).toMatchObject({
        ok: true,
        op: 'delete_row',
        withdrewPendingInsertion: 5
      });
      // Every one of the five: ten added, five removed, five left pending.
      expect(rowTexts(editor)).toHaveLength(before + 5);
      expect(rowsAfterRejectingAll(editor)).toEqual(pristine);
      expect(rowsAfterAcceptingAll(editor)).toHaveLength(before + 5);
    } finally {
      destroyEditor(editor);
    }
  });

  it('is ONE write, so the five rows never became five refusals', () => {
    const editor = asRobin(makeEditor(fixture()));
    try {
      addTenThenDeleteFive(editor);
      // The whole run went down in a single deleteRow. Row by row, the second op
      // onwards failed to re-resolve its anchor and the change set rolled back,
      // which is what left four of the captain's five rows in the document.
      expect(rowTexts(editor).filter((row) => row === '[|]')).toHaveLength(5);
    } finally {
      destroyEditor(editor);
    }
  });
});

describe('a mixed row set: pending insertions and original rows together', () => {
  // The shape the report measured as R9. SyncFusion already does the right thing
  // with it - withdraw the pending rows, mark the original ones deleted, ONE
  // revision - but only when the whole set goes down in one write.
  it('lands as one card: pending rows withdrawn, original rows tracked-deleted', () => {
    const editor = asRobin(makeEditor(fixture(6)));
    try {
      const pristine = rowTexts(editor);
      apply(
        editor,
        [{ op: 'insert_row', anchor: '0;2;1;0;0', above: false, count: 3 }],
        'add-three'
      );
      expect(revisionTypes(editor)).toEqual(['Insertion']);
      // Rows 2,3,4 are pending insertions; rows 5,6 are the original Line 1 and
      // Line 2. One selection, one write, over both kinds at once.
      const result = apply(
        editor,
        [{ op: 'delete_row', anchor: '0;2;0;0;0', rows: [2, 3, 4, 5, 6] }],
        'remove-mixed'
      ).results[0];

      expect(result).toMatchObject({
        ok: true,
        op: 'delete_row',
        withdrewPendingInsertion: 3
      });
      // ONE card, not five and not one per kind: the three withdrawals author no
      // revision of their own and the two tracked deletions fold into a single
      // one. The earlier Insertion is gone too, because withdrawing all three of
      // its rows consumed the whole of it - which is why this asserts what the
      // rail SHOWS rather than a count delta, and the delta here is zero.
      expect(revisionTypes(editor)).toEqual(['Deletion']);
      // The two original rows are still in place, marked, awaiting a decision.
      expect(rowTexts(editor)).toHaveLength(pristine.length);
      // Reject restores the pristine rows; accept takes the two originals out.
      expect(rowsAfterRejectingAll(editor)).toEqual(pristine);
      expect(rowsAfterAcceptingAll(editor)).toEqual(
        pristine.filter(
          (row) => !row.includes('Line 1|') && !row.includes('Line 2|')
        )
      );
    } finally {
      destroyEditor(editor);
    }
  });
});

describe('what the relaxation did NOT loosen', () => {
  // The control for principle 11: an ordinary row delete must still be a real
  // tracked deletion whose reject restores the document BYTE for byte. The
  // withdrawal case cannot promise that - there is no revision left to reject -
  // so this is where the byte-exact promise is pinned.
  it('an original row is still a tracked deletion that rejects byte-exact', () => {
    const editor = makeEditor(fixture());
    try {
      const pristine = editor.serialize();
      asRobin(editor);
      const result = apply(
        editor,
        [{ op: 'delete_row', anchor: '0;2;2;0;0' }],
        'ordinary'
      ).results[0];

      expect(result).toMatchObject({ ok: true, op: 'delete_row' });
      // Nothing was withdrawn, so the field is absent rather than zero.
      expect(result.withdrewPendingInsertion).toBeUndefined();
      editor.revisions.rejectAll();
      editor.enableTrackChanges = false;
      expect(editor.serialize()).toBe(pristine);
    } finally {
      destroyEditor(editor);
    }
  });

  // A write that genuinely did nothing must still be refused, or the relaxation
  // would have turned the assertion into a rubber stamp. This is the case the
  // new message is now allowed to describe accurately.
  it('a write that changed nothing is still refused, and says so honestly', () => {
    const editor = asRobin(makeEditor(fixture()));
    try {
      const before = editor.serialize();
      // A body paragraph is not a table row, so there is no row to delete.
      const result = apply(
        editor,
        [{ op: 'delete_row', anchor: '0;1' }],
        'nothing-to-do'
      ).results[0];

      expect(result).toMatchObject({ ok: false, error: 'untracked_write' });
      // It no longer blames SyncFusion for a rule we chose, no longer claims a
      // missing revision is the problem, and now names the read that fixes it.
      expect(result.message).toContain('changed nothing');
      expect(result.message).toContain('table_facts');
      expect(result.message).not.toContain('SyncFusion did not create');
      expect(editor.serialize()).toBe(before);
    } finally {
      destroyEditor(editor);
    }
  });

  // The row set is read off the table, so a row the table does not have is named
  // rather than silently skipped or applied to whatever sits at that index.
  it('refuses a row the table does not have, and writes nothing', () => {
    const editor = asRobin(makeEditor(fixture()));
    try {
      const before = editor.serialize();
      const result = apply(
        editor,
        [{ op: 'delete_row', anchor: '0;2;0;0;0', rows: [1, 99] }],
        'no-such-row'
      ).results[0];

      expect(result).toMatchObject({ ok: false, error: 'row_not_found' });
      expect(result.message).toContain('99');
      expect(editor.serialize()).toBe(before);
      expect(editor.revisions.length).toBe(0);
    } finally {
      destroyEditor(editor);
    }
  });

  // `relocateBlockRange`'s docstring records that deleting a row which is itself
  // an unaccepted insertion once "writes rowSpan back into a DIFFERENT table".
  // Relaxing the assertion is what lets that call through, so this is checked
  // rather than assumed, in the shape it needs: two tables with no paragraph
  // between them.
  //
  // Measured, and the reason this asserts the OUTCOME rather than the span
  // numbers: in this shape SyncFusion does leave `rwsp` 0 and -1 on the withdrawn
  // rows' remnants, but that residue is inert - the neighbouring table is
  // untouched, and both accept and reject produce exactly the right rows in both
  // tables. A test keyed to the span value would have failed while nothing the
  // user can see was wrong, which is the opposite of what a regression test is
  // for. One `deleteRow` over the whole run is also strictly better here than one
  // per row, which leaves two empty rows behind on accept.
  it('leaves the neighbouring table untouched, and accept and reject both correct', () => {
    const editor = asRobin(makeEditor(adjacentTablesFixture()));
    try {
      const pristineNeighbour = rowTextsOf(editor, '0;1');
      const pristineTarget = rowTextsOf(editor, '0;2');
      apply(
        editor,
        [{ op: 'insert_row', anchor: '0;2;1;0;0', above: false, count: 3 }],
        'span-add'
      );
      const result = apply(
        editor,
        [{ op: 'delete_row', anchor: '0;2;0;0;0', rows: [2, 3, 4] }],
        'span-remove'
      ).results[0];

      expect(result).toMatchObject({ ok: true, withdrewPendingInsertion: 3 });
      // The whole insertion was withdrawn, so both directions land on pristine -
      // and neither may disturb the table next door.
      for (const resolve of ['accept', 'reject'] as const) {
        const copy = makeEditor(JSON.parse(editor.serialize()));
        try {
          expect(() =>
            resolve === 'accept'
              ? copy.revisions.acceptAll()
              : copy.revisions.rejectAll()
          ).not.toThrow();
          expect(rowTextsOf(copy, '0;1')).toEqual(pristineNeighbour);
          expect(rowTextsOf(copy, '0;2')).toEqual(pristineTarget);
        } finally {
          destroyEditor(copy);
        }
      }
    } finally {
      destroyEditor(editor);
    }
  });

  // Scattered rows are ordinary - `split_table` already accepts them, so the
  // model will send them here too. Each contiguous run is one write, taken
  // highest first so a withdrawal cannot move a row a later run still needs.
  it('deletes a scattered row set without touching the rows between', () => {
    const editor = asRobin(makeEditor(fixture(6)));
    try {
      const pristine = rowTexts(editor);
      const result = apply(
        editor,
        [{ op: 'delete_row', anchor: '0;2;0;0;0', rows: [1, 4, 5] }],
        'scattered'
      ).results[0];

      expect(result).toMatchObject({ ok: true, op: 'delete_row' });
      expect(rowsAfterRejectingAll(editor)).toEqual(pristine);
      // Exactly Line 0, Line 3 and Line 4 leave; every other row survives.
      expect(rowsAfterAcceptingAll(editor)).toEqual(
        pristine.filter(
          (row) =>
            !row.startsWith('[Line 0|') &&
            !row.startsWith('[Line 3|') &&
            !row.startsWith('[Line 4|')
        )
      );
    } finally {
      destroyEditor(editor);
    }
  });
});

// A pending row somebody ELSE authored, inside the rows Robin is asked to remove.
//
// SyncFusion only WITHDRAWS content whose insertion revision belongs to the current
// user, so a delete over another author's pending row authors a Deletion beside it:
// her card survives and rejecting ours alone restores the document. That is what
// makes `withdrewPendingInsertion` unambiguous - the count cannot include somebody
// else's row - and why `relocation_source_has_pending_review` belongs on the ops
// that FOLD what they move into their own card and not on a row or table delete.
// Untested until now, which is how a review came to report it as data loss.
const HUMAN = 'Dana Reviewer';

/** A row inserted by a HUMAN, through the editor the way a reviewer would. */
const withHumanRow = (): DocumentEditor => {
  const editor = makeEditor(fixture(4));
  editor.enableTrackChanges = true;
  editor.currentUser = HUMAN;
  // Six parts: a five-part cell anchor has no offset and SyncFusion throws
  // reading `nextSplitWidget` rather than selecting.
  editor.selection.select('0;2;2;0;0;0', '0;2;2;0;0;0');
  (editor.editor as any).insertRow(false, 1);
  editor.currentUser = 'Robin';
  editor.enableTrackChanges = false;
  return editor;
};

/** How many pending revisions the document states are HERS. */
const humanRevisions = (editor: DocumentEditor): number => {
  const sfdt = JSON.parse(editor.serialize());
  return (sfdt.revisions ?? sfdt.r ?? []).filter(
    (entry: any) => String(entry.author ?? entry.a ?? '') === HUMAN
  ).length;
};

describe("another author's pending row, inside the rows Robin is asked to remove", () => {
  // `{rows: [2,3,4]}` over `[header][Line 0][Line 1][hers][Line 2][Line 3]` - an
  // ordinary contiguous request, and rows 2..4 are what `table_facts` reports. Her
  // row is row 3, in the middle of it.
  it('survives the row set, and rejecting OUR card alone restores the document', () => {
    const editor = withHumanRow();
    try {
      expect(humanRevisions(editor)).toBe(1);
      const before = editor.serialize();
      const result = apply(
        editor,
        [{ op: 'delete_row', anchor: '0;2;0;0;0', rows: [2, 3, 4] }],
        'robin-row-set'
      ).results[0];

      expect(result).toMatchObject({ ok: true, op: 'delete_row' });
      // Absent, not zero: nothing was physically taken out. A withdrawal is what
      // the report expected, and it cannot happen to an insertion that is not ours.
      expect(result.withdrewPendingInsertion).toBeUndefined();
      expect(humanRevisions(editor)).toBe(1);

      // Rejecting only our group - `rejectAll` would reject hers too, by
      // definition, which is why it is not the discriminating read.
      for (const group of listRevisionGroups(editor as unknown as LiveEditor))
        if (!(group as any).items.some((item: any) => item.author === HUMAN))
          (group as any).items[0].revision.reject();
      expect(editor.serialize()).toBe(before);
      expect(humanRevisions(editor)).toBe(1);
      expect(rowTexts(editor)).toEqual([
        '[Line|Carrier]',
        '[Line 0|Carrier 0]',
        '[Line 1|Carrier 1]',
        '[|]',
        '[Line 2|Carrier 2]',
        '[Line 3|Carrier 3]'
      ]);
    } finally {
      destroyEditor(editor);
    }
  });

  // Enumerated over the registry, not over the two ops that were looked at: the
  // tail-table guard was wired per op twice, so nothing failed when a third op
  // reached the same content. Required is the PROPERTY - refuse, or leave her
  // change to review - so an op registered next year is covered when it is
  // registered. Her revision is read rather than the bytes: a refused op still
  // passes through the executor's relayout, which re-fragments runs into equal text.
  it.each(
    DOCUMENT_EDITOR_CAPABILITIES.filter(
      (entry) =>
        entry.requiresAnchor &&
        Object.values(entry.params).every((type) => type.endsWith('?'))
    ).map((entry) => entry.op)
  )('%s at her row leaves her change to review', (op) => {
    const editor = withHumanRow();
    try {
      apply(editor, [{ op, anchor: '0;2;3;0;0' } as EditOp], `foreign-${op}`);
      expect(humanRevisions(editor)).toBe(1);
    } finally {
      destroyEditor(editor);
    }
  });

  // The control that stops the two above from being vacuous: a count that cannot
  // go down proves nothing. Withdrawing her row is possible, just not through
  // anything the engine does, because the engine applies every change tracked.
  it('the measurement can see a loss, so a passing case means something', () => {
    const editor = withHumanRow();
    try {
      editor.enableTrackChanges = false;
      editor.selection.select('0;2;3;0;0;0', '0;2;3;0;0;0');
      (editor.editor as any).deleteRow();
      expect(humanRevisions(editor)).toBe(0);
    } finally {
      destroyEditor(editor);
    }
  });
});
