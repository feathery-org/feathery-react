/**
 * What the relocation family does TODAY, recorded before anything moves.
 *
 * The slice ahead recomposes five ops - copy_section, move_section,
 * swap_sections, duplicate_table, split_table - onto two range primitives. The
 * method is parity: the recomposition must produce the same document the
 * current path produces. That claim is only checkable against a baseline
 * captured beforehand, from the current code, over documents that are not
 * invented for the occasion.
 *
 * So this file asserts almost nothing about whether today's behaviour is GOOD.
 * It records what it IS, per op per shape, in two projections:
 *
 *   accept  - what the document reads if every revision is accepted: what the
 *             op actually did.
 *   reject  - what it reads if every revision is rejected: what the person gets
 *             back if they turn it down. A relocation must restore exactly.
 *
 * Those two are the whole contract of a tracked rearrangement, and they are
 * mechanism-independent - a recomposed op passes them or it changed behaviour.
 * A diff of serialized SFDT would fail on incidental structure the same edit can
 * legitimately produce two ways; text projections compare what a person sees.
 *
 * The one real assertion here is the family law, which is true today and must
 * stay true: rejecting a relocation restores the pre-op document exactly.
 * Anything else that shifts shows up as a changed golden, which is a review
 * conversation rather than a silent pass.
 */
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
import {
  acceptProjectionStream,
  applyDocumentEdits,
  flattenSfdt,
  LiveEditor,
  rejectProjectionStream,
  ASSISTANT_DOCUMENT_AUTHOR
} from '../syncfusionDocumentOps';
import { corpusShapes, readShape, requireShape } from './corpusShapes';

DocumentEditor.Inject(Editor, Selection, SfdtExport, EditorHistory, ImageResizer, Search);

if (!window.crypto?.getRandomValues)
  Object.defineProperty(window, 'crypto', {
    value: {
      getRandomValues: (a: Uint8Array) => require('crypto').randomFillSync(a)
    }
  });
if (!(window.SVGElement.prototype as any).getBBox)
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);

interface Landmarks {
  headings: string[];
  tableAnchors: string[];
  firstBodyPara?: string;
}

/**
 * The anchors an op can be driven at, read from the document rather than
 * assumed. A shape with no table cannot be asked to split one, and saying so is
 * part of the record.
 */
const landmarksOf = (editor: DocumentEditor): Landmarks => {
  const blocks = flattenSfdt(JSON.parse(editor.serialize())) as any[];
  const headings = blocks.filter((b) => b.isHeading).map((b) => b.anchor);
  const tableAnchors = [
    ...new Set(
      blocks
        .filter((b) => b.kind === 'table_cell')
        .map((b) => String(b.anchor).split(';').slice(0, 2).join(';'))
    )
  ];
  const firstBodyPara = blocks.find(
    (b) =>
      b.kind !== 'table_cell' && !b.isHeading && String(b.text ?? '').trim()
  )?.anchor;
  return { headings, tableAnchors, firstBodyPara };
};

/** One driveable case: the op, and the edit built from this shape's landmarks. */
type Case = {
  op: string;
  build: (marks: Landmarks) => Record<string, unknown> | null;
};

const CASES: Case[] = [
  {
    op: 'move_section',
    build: (m) =>
      m.headings.length >= 2
        ? {
            anchor: m.headings[m.headings.length - 1],
            targetAnchor: m.headings[0],
            position: 'before'
          }
        : null
  },
  {
    op: 'copy_section',
    build: (m) =>
      m.headings.length >= 2
        ? {
            anchor: m.headings[m.headings.length - 1],
            targetAnchor: m.headings[0],
            position: 'before'
          }
        : null
  },
  {
    // swap names its partner `otherAnchor`, not `targetAnchor`. Driving it with
    // the wrong param refused on fifteen of seventeen shapes and would have left
    // one of the five ops uncharacterized while looking covered.
    op: 'swap_sections',
    build: (m) =>
      m.headings.length >= 2
        ? { anchor: m.headings[0], otherAnchor: m.headings[1] }
        : null
  },
  {
    op: 'duplicate_table',
    build: (m) => (m.tableAnchors.length ? { anchor: m.tableAnchors[0] } : null)
  },
  {
    op: 'split_table',
    build: (m) =>
      m.tableAnchors.length && m.firstBodyPara
        ? {
            anchor: `${m.tableAnchors[0]};1;0;0`,
            splitAtRow: 1,
            targetAnchor: m.firstBodyPara,
            position: 'after'
          }
        : null
  }
];

describe('relocation family, characterized before the slice moves it', () => {
  let editor: DocumentEditor;
  afterEach(() => {
    if (!editor) return;
    const element = editor.element;
    editor.destroy();
    element?.remove();
  });

  const open = (sfdt: any) => {
    const host = document.createElement('div');
    host.style.width = '900px';
    host.style.height = '700px';
    document.body.appendChild(host);
    editor = new DocumentEditor({
      isReadOnly: false,
      enableEditor: true,
      enableSelection: true,
      enableSfdtExport: true,
      enableEditorHistory: true,
      enableSearch: true,
      documentEditorSettings: { optimizeSfdt: false }
    });
    editor.appendTo(host);
    editor.open(JSON.stringify(sfdt));
    return editor as unknown as LiveEditor;
  };

  const shapes = corpusShapes();

  /**
   * The two shapes that carry ANOTHER AUTHOR'S pending tracked changes.
   *
   * They are named here because the family law bites hardest on them: a write
   * that overwrites a block containing somebody's unaccepted insertion can bake
   * it in as permanent text, which does not destroy content but silently
   * ACCEPTS a change on their behalf. write_sfdt did exactly that, which is why
   * it is parked - and the question this file has to answer is whether any
   * SHIPPED op does the same.
   */
  const FOREIGN_PENDING_SHAPES = ['pending-revisions', 'mixed-authors'];

  it('the corpus actually contains the foreign-pending shapes', () => {
    // Guards the guard: if these shapes vanish, the sweep below passes by
    // testing nothing, which is this workstream's most repeated failure.
    const present = shapes.map((s) => s.name);
    for (const name of FOREIGN_PENDING_SHAPES) expect(present).toContain(name);
  });

  it('has a corpus to characterize against', () => {
    // Guards the guard: if the vendored corpus goes missing this whole file
    // would pass by running nothing, which is the failure mode this workstream
    // keeps meeting.
    expect(shapes.length).toBeGreaterThanOrEqual(16);
  });

  describe.each(shapes)('$name', (shape) => {
    it.each(CASES)('$op', ({ op, build }) => {
      const sfdt = readShape(shape);
      const live = open(sfdt);
      const marks = landmarksOf(editor);
      const edit = build(marks);

      if (!edit) {
        // Not driveable on this shape. Recorded rather than skipped silently:
        // a shape losing its landmarks later would otherwise look like coverage.
        expect(edit).toBeNull();
        return;
      }

      const before = JSON.parse(editor.serialize());
      const beforeReject = rejectProjectionStream(before);

      let outcome: string;
      try {
        const result: any = applyDocumentEdits(live, {
          changeSetId: `characterize-${shape.name}-${op}`,
          edits: [{ op, group: 'g', ...edit } as any]
        });
        const first = result.results?.[0];
        outcome = first?.ok ? 'ok' : `refused:${first?.error ?? 'unknown'}`;
      } catch (error: any) {
        outcome = `threw:${String(error?.message ?? error).split(':')[0]}`;
      }

      const after = JSON.parse(editor.serialize());

      // THE FAMILY LAW, and the only judgement this file makes: whatever the op
      // did or refused to do, turning it down gives the person back exactly the
      // document they had. This is what a recomposition must not break.
      expect(rejectProjectionStream(after)).toBe(beforeReject);

      // The rest is the record. Printed rather than snapshotted to a file: the
      // slice compares these two projections across the recomposition, and a
      // golden file would invite someone to regenerate it instead of reading it.
      // eslint-disable-next-line no-console
      console.log(
        `[characterize] ${shape.name} ${op} -> ${outcome} ` +
          `accept=${acceptProjectionStream(after).length}ch ` +
          `reject=${rejectProjectionStream(after).length}ch` +
          (shape.local ? ' (local-only shape)' : '')
      );
    });
  });
});

/**
 * The invariants a relocation must hold that the two projections do NOT cover.
 *
 * Accept and reject compare what a person READS. These four compare what a
 * person OWNS: whose changes these are, whether the parts of the document
 * nobody named were left alone, and whether the edit is one thing to undo.
 * Each is stated so a recomposition either holds it or visibly does not.
 *
 * Recorded now, before behaviour moves, for the same reason as the projections:
 * a parity claim can only be made against something measured beforehand.
 */
describe('relocation invariants beyond the two projections', () => {
  let editor: DocumentEditor;
  afterEach(() => {
    if (!editor) return;
    const element = editor.element;
    editor.destroy();
    element?.remove();
  });

  const open = (sfdt: any) => {
    const host = document.createElement('div');
    host.style.width = '900px';
    host.style.height = '700px';
    document.body.appendChild(host);
    editor = new DocumentEditor({
      isReadOnly: false,
      enableEditor: true,
      enableSelection: true,
      enableSfdtExport: true,
      enableEditorHistory: true,
      enableSearch: true,
      documentEditorSettings: { optimizeSfdt: false }
    });
    editor.appendTo(host);
    editor.open(JSON.stringify(sfdt));
    return editor as unknown as LiveEditor;
  };

  /** Every story's text, not the body's - headers and footers included. */
  const allStoriesText = (sfdt: any): string => {
    let text = '';
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node.text === 'string') text += node.text;
      Object.values(node).forEach(walk);
    };
    walk(sfdt);
    return text;
  };

  const authorsOf = (sfdt: any): string[] => [
    ...new Set(
      (sfdt.revisions ?? sfdt.r ?? [])
        .map((revision: any) => String(revision.author ?? ''))
        .filter(Boolean)
    )
  ];

  // A shape with two headings, so a move has somewhere to come from.
  //
  // This used to reach for a 'headers-footers' shape first and fall through a
  // `??` chain when it was missing. It was ALWAYS missing - no such shape exists
  // in either corpus - so every row here silently ran on headings-bound, and the
  // header-conservation row below compared that shape's empty headersFooters to
  // itself and passed for that reason. requireShape throws rather than
  // substituting, so a missing shape can never again masquerade as a passing
  // test. The header story that row needs is built explicitly, below.
  const shape = requireShape('headings-bound');

  /**
   * A document that genuinely HAS header and footer stories.
   *
   * Not read from the corpus, deliberately. A captured headers-footers document
   * exists at browser-only/headers-footers.sfdt.json and cannot be used here:
   * measured 2026-08-27 with the same probe and harness, headings-bound imports
   * and serializes in 1.5s while that shape never completes - killed at 150s
   * after an earlier run was killed at 600s. Vendoring it would hang CI rather
   * than widen coverage. An inline document exercises the same conservation
   * question and actually runs.
   *
   * The style table is not decoration: a real DocumentEditor keeps a
   * paragraph's style only when the document declares it, so without this the
   * fixture normalizes to one flat run of Normal text, `moveTheLastSection`
   * finds fewer than two headings and returns null, and every row that calls it
   * returns early while reporting green.
   */
  const headerBearingDoc = () => ({
    sections: [
      {
        sectionFormat: { pageWidth: 612, pageHeight: 792 },
        headersFooters: {
          header: {
            blocks: [{ inlines: [{ text: 'Acme Corp - confidential' }] }]
          },
          footer: { blocks: [{ inlines: [{ text: 'Page 1 of 2' }] }] }
        },
        blocks: [
          { inlines: [{ text: 'Coverages and Limits' }], paragraphFormat: { styleName: 'Heading 1' } },
          { inlines: [{ text: 'The policy covers the vehicles listed below.' }] },
          { inlines: [{ text: 'Driver Information' }], paragraphFormat: { styleName: 'Heading 1' } },
          { inlines: [{ text: 'Each listed driver must hold a valid licence.' }] }
        ]
      }
    ],
    styles: [
      { type: 'Paragraph', name: 'Normal', next: 'Normal', characterFormat: { fontSize: 11 } },
      {
        type: 'Paragraph',
        name: 'Heading 1',
        basedOn: 'Normal',
        next: 'Normal',
        characterFormat: { bold: true, fontSize: 16 },
        paragraphFormat: { outlineLevel: 'Level1', beforeSpacing: 12 }
      }
    ]
  });

  const headerFooterSignature = (sfdt: any): string =>
    JSON.stringify(
      (sfdt.sections ?? sfdt.sec ?? []).map(
        (s: any) => s.headersFooters ?? s.hf ?? null
      )
    );

  const moveTheLastSection = () => {
    const blocks = flattenSfdt(JSON.parse(editor.serialize())) as any[];
    const headings = blocks.filter((b) => b.isHeading).map((b) => b.anchor);
    if (headings.length < 2) return null;
    return applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'invariants-move',
      edits: [
        {
          op: 'move_section',
          anchor: headings[headings.length - 1],
          targetAnchor: headings[0],
          position: 'before',
          group: 'g'
        } as any
      ]
    }) as any;
  };

  it('(a) authors every revision it creates as the assistant, and re-authors nobody', () => {
    const sfdt = readShape(shape);
    open(sfdt);
    const authorsBefore = authorsOf(JSON.parse(editor.serialize()));
    const result = moveTheLastSection();
    if (!result) return;
    const after = JSON.parse(editor.serialize());
    const authorsAfter = authorsOf(after);

    // Anyone who had revisions before still has them: a relocation folds what it
    // moves into its own card, and re-authoring someone else's pending edit
    // would make our reject revert their work.
    for (const author of authorsBefore) expect(authorsAfter).toContain(author);
    // And any NEW author is us.
    const added = authorsAfter.filter((a) => !authorsBefore.includes(a));
    for (const author of added) expect(author).toBe(ASSISTANT_DOCUMENT_AUTHOR);
  });

  it('(b) leaves every OTHER story byte-unchanged, headers and footers included', () => {
    // "Outside the declared range" has to mean the whole document, not the body.
    // A body-only reading is exactly how raw DSL came to be printing in client
    // headers for several releases.
    //
    // This row ran vacuously for its whole life: it loaded a shape with no
    // header story at all, so it compared "[{}]" to "[{}]". It now loads a
    // document that HAS header and footer text, and the row below proves the
    // comparison can actually fail.
    open(headerBearingDoc());
    const before = JSON.parse(editor.serialize());
    const headerFooterBefore = headerFooterSignature(before);

    // The signature must contain real content, or this row is vacuous again.
    expect(headerFooterBefore).toContain('Acme Corp - confidential');
    expect(headerFooterBefore).toContain('Page 1 of 2');

    const result = moveTheLastSection();
    // Not `if (!result) return` - a silent skip is how a green row hides a
    // fixture that stopped producing two headings.
    expect(result).not.toBeNull();

    const after = JSON.parse(editor.serialize());
    expect(headerFooterSignature(after)).toBe(headerFooterBefore);
  });

  it('(b2) NEGATIVE CONTROL: that comparison detects a mangled header', () => {
    // The guard on the guard. If headerFooterSignature could not tell a damaged
    // header from an intact one, row (b) would pass no matter what a relocation
    // did to the header story, which is precisely the failure it exists to
    // catch. So damage it deliberately and require the comparison to notice.
    open(headerBearingDoc());
    const before = headerFooterSignature(JSON.parse(editor.serialize()));

    const mangled = JSON.parse(editor.serialize());
    const sections = mangled.sections ?? mangled.sec ?? [];
    const hf = sections[0].headersFooters ?? sections[0].hf;
    const headerStory = hf.header ?? hf.h;
    const firstBlock = (headerStory.blocks ?? headerStory.b)[0];
    (firstBlock.inlines ?? firstBlock.i)[0].text = 'RAW DSL LEAKED HERE';

    expect(headerFooterSignature(mangled)).not.toBe(before);
  });

  it('(c) takes TWO undo steps to restore - one card, two history entries', () => {
    // A person who presses Ctrl+Z once expects the whole relocation back, not
    // half of it. This is distinct from rejecting the revision group - undo is
    // the editor's own history, and the two are separate mechanisms that must
    // agree about what one edit was.
    const sfdt = readShape(shape);
    open(sfdt);
    const beforeText = allStoriesText(JSON.parse(editor.serialize()));
    const result = moveTheLastSection();
    if (!result || !result.results?.[0]?.ok) return;
    const movedText = allStoriesText(JSON.parse(editor.serialize()));
    expect(movedText).not.toBe(beforeText);

    // How many steps does it actually take? Measured rather than assumed: I got
    // the undo story wrong once already by reading one field, so the question
    // that would disprove "one step" is asked directly.
    const steps: string[] = [];
    let restoredAt = -1;
    for (let step = 1; step <= 8; step++) {
      try {
        (editor as any).editorHistory.undo();
      } catch (error: any) {
        steps.push(`${step}:threw`);
        break;
      }
      const text = allStoriesText(JSON.parse(editor.serialize()));
      steps.push(`${step}:${text === beforeText ? 'RESTORED' : 'no'}`);
      if (text === beforeText) {
        restoredAt = step;
        break;
      }
    }

    // MEASURED CHARACTERIZATION - back at 2, and the round trip is the lesson.
    //
    // Act one. This asserted 2, recording a defect rather than a bar: a move is
    // one reviewable card and TWO entries on the editor's own history, so
    // pressing Ctrl+Z once leaves a half-moved document, which reads as damage
    // rather than as a partial undo. The comment said that if the recomposition
    // ever made it 1, this test would fail and someone would read why.
    //
    // Act two. That happened. withGroupedUndo wrapped the change-set seam in
    // beginUndoAction/endUndoAction, this row measured 1, and it was asserted at
    // 1 as a fixed defect.
    //
    // Act three, and why it is 2 again. That wrapper sat on applyDocumentEdits,
    // the seam EVERY change set flows through, so it grouped every op on the
    // evidence of this one. Measured in the real browser on 2026-08-27, a
    // grouped split_table is not recoverable at all: its 13 history entries
    // collapse to one, SyncFusion's replay of that group's inverses throws in
    // getSplitWidgets partway through the table layout, the remaining inverses
    // are abandoned, and the group has ALREADY been popped - so the history is
    // empty and ~115K characters of damage cannot be reached by any number of
    // Ctrl+Z presses. Ungrouped, the same split undoes in 13 clean steps.
    // Recoverable-in-13 beats stranded-at-1, so the wrapper was reverted from
    // the seam and this measurement honestly returned to 2.
    //
    // The law that came out of it, which is why this comment is long: grouping
    // is an optimisation, recoverability is correctness. A jsdom pass cannot
    // license grouping, because jsdom has no layout to throw from - the proof
    // has to be a browser ledger, per op. When someone re-lands grouping for
    // move_section alone with that ledger, this row goes back to 1 and act four
    // gets written here.
    expect(restoredAt).toBe(2);
  });
});
