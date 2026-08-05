// ---------------------------------------------------------------------------
// A selection is the strongest statement of intent a user can make: they
// pointed at the text. These tests hold the selection path to that standard -
// every selection shape must land in ONE attempt, as a rejectable tracked
// change, and every shape that genuinely cannot be written must be refused by
// name with a remedy rather than failed silently or retried.
//
// The captain's live failure (2026-07-27 ~14:2x EDT, ai-services-3002.log line
// 26661): he selected the three-sentence "Our commitments to the client"
// paragraph and asked Robin to "make this into one statement". Robin sent
// replace_text at the right anchor with the right text three times and got
// `exact_match_range_not_found` every time, because the tool schema fills every
// field so `end` arrived as 0, and on the retries the model tried to count the
// characters and said 451 for a 457-character string. The `end` equality filter
// threw away a range SyncFusion had resolved perfectly.
// ---------------------------------------------------------------------------

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
  applyDocumentEdits,
  flattenSfdt,
  readSelection,
  LiveEditor
} from '../syncfusionDocumentOps';
import { DOCUMENT_EDITOR_CAPABILITIES } from '../../../capabilities/registry';

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

const jsdomGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = ((elt: Element) =>
  jsdomGetComputedStyle(elt)) as typeof window.getComputedStyle;

if (!(window.SVGElement.prototype as any).getBBox) {
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);
}

// --- harness ---------------------------------------------------------------

function makeRealDocumentEditor(sfdt: any): DocumentEditor {
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

function destroyRealDocumentEditor(editor: DocumentEditor): void {
  const element = editor.element;
  editor.destroy();
  element?.remove();
}

function realRevisions(editor: DocumentEditor): any[] {
  return Array.from({ length: editor.revisions.length }, (_, index) =>
    editor.revisions.get(index)
  );
}

function rejectEveryRealRevision(editor: DocumentEditor): void {
  for (const revision of realRevisions(editor)) revision.reject();
}

const blockTexts = (editor: DocumentEditor) =>
  flattenSfdt(JSON.parse(editor.serialize())).map((block) => block.text);

const revisionTypes = (editor: DocumentEditor) =>
  realRevisions(editor).map((revision) => String(revision.revisionType));

function para(text: string, styleName?: string) {
  return {
    inlines: text ? [{ text }] : [],
    paragraphFormat: styleName ? { styleName } : {}
  };
}

const cell = (text: string) => ({
  cellFormat: {},
  blocks: [{ inlines: [{ text }] }]
});

// --- the captain's document ------------------------------------------------

// Verbatim from context.selection.text in the live request body, minus the
// trailing paragraph mark. 457 characters; the model reported 451.
const COMMITMENT =
  'At Hilb Group, our commitment to clients extends well beyond the placement of coverage. We act as an ongoing advocate at every stage of the policy lifecycle, from pre-renewal strategy and market negotiation through claims advocacy and mid-term service requests. Our teams are structured so that you always have direct access to the people who know your account, and we hold ourselves to the clarity of the advice we give and the speed with which we respond.';

// Verbatim from the `replace` field of all three failed live attempts.
const ONE_STATEMENT =
  'At Hilb Group, we support clients throughout the policy lifecycle with proactive guidance, responsive service, and direct access to a team that knows their account.';

function onePargraphDoc() {
  return {
    sections: [
      {
        blocks: [
          para('Our commitments to the client', 'Heading 2'),
          para(COMMITMENT),
          para(''),
          para('A Long-Term Perspective', 'Heading 2')
        ]
      }
    ]
  };
}

// The shape "make this into one statement" actually implies: several sentences
// living in several paragraphs, to be collapsed into one.
const SENT_1 = 'We act as an advocate at every stage of the policy lifecycle.';
const SENT_2 =
  'Our teams are structured so you always reach the people who know your account.';
const SENT_3 = 'We hold ourselves to the speed with which we respond.';

function multiParagraphDoc() {
  return {
    sections: [
      {
        blocks: [
          para('Our commitments to the client', 'Heading 2'),
          para(SENT_1),
          para(SENT_2),
          para(SENT_3),
          para('A Long-Term Perspective', 'Heading 2'),
          para('Long term body text.')
        ]
      }
    ]
  };
}

function multiRunDoc() {
  return {
    sections: [
      {
        blocks: [
          para('Heading', 'Heading 1'),
          {
            paragraphFormat: {},
            inlines: [
              { text: 'Coverage is placed ', characterFormat: { bold: true } },
              { text: 'and then serviced ' },
              { text: 'for the whole term.', characterFormat: { italic: true } }
            ]
          },
          para('Tail.')
        ]
      }
    ]
  };
}

const MULTI_RUN_TEXT =
  'Coverage is placed and then serviced for the whole term.';

function tableDoc() {
  return {
    sections: [
      {
        blocks: [
          { inlines: [{ text: 'Location Schedule' }] },
          {
            tableFormat: {},
            rows: [
              {
                rowFormat: {},
                cells: [cell('Loc #'), cell('Address')]
              },
              {
                rowFormat: {},
                cells: [cell('0092'), cell('99 Old Rd, Toronto, Ontario')]
              }
            ]
          },
          { inlines: [{ text: 'End' }] }
        ]
      }
    ]
  };
}

// ---------------------------------------------------------------------------

describe('the root failure: a model-counted offset must not invalidate a resolved range', () => {
  it("real SDK: the captain's exact live payload (end: 0, the schema default) now lands in one attempt", () => {
    const ed = makeRealDocumentEditor(onePargraphDoc());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();

      // Byte-for-byte the first applyDocumentEdits input from the live turn.
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'make-commitment-one-statement-20260727',
        edits: [
          {
            op: 'replace_text',
            anchor: '0;1',
            find: COMMITMENT,
            replace: ONE_STATEMENT,
            text: '',
            above: false,
            count: 1,
            rows: 1,
            columns: 1,
            expect: COMMITMENT,
            start: 0,
            end: 0
          } as any
        ]
      });

      expect(result.results[0]).toMatchObject({ ok: true, op: 'replace_text' });
      expect(blockTexts(ed)[1]).toBe(ONE_STATEMENT);
      expect(revisionTypes(ed).sort()).toEqual(['Deletion', 'Insertion']);
      rejectEveryRealRevision(ed);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a miscounted end (451 for a 457-character find, as the retries sent) also lands', () => {
    const ed = makeRealDocumentEditor(onePargraphDoc());
    try {
      ed.enableTrackChanges = true;
      expect(COMMITMENT.length).toBe(457);
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'retry',
        edits: [
          {
            op: 'replace_text',
            anchor: '0;1',
            find: COMMITMENT,
            replace: ONE_STATEMENT,
            expect: COMMITMENT,
            start: 0,
            end: 451
          } as any
        ]
      });
      expect(result.results[0]).toMatchObject({ ok: true });
      expect(blockTexts(ed)[1]).toBe(ONE_STATEMENT);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: the expect guard still bites - a wrong expect is refused, nothing is written', () => {
    const ed = makeRealDocumentEditor(onePargraphDoc());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'wrong-expect',
        edits: [
          {
            op: 'replace_text',
            anchor: '0;1',
            find: COMMITMENT,
            replace: ONE_STATEMENT,
            expect: 'At Hilb Group, our commitment to clients is total.',
            start: 0,
            end: 0
          } as any
        ]
      });
      expect(result.results[0]).toMatchObject({
        ok: false,
        // Renamed, not relaxed: this is the model-supplied `expect`
        // compare-and-swap, which is what expect_mismatch names. The refusal
        // itself is unchanged - no revision, and the document is byte-identical.
        error: 'expect_mismatch'
      });
      expect(ed.revisions.length).toBe(0);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: relaxing the offset filter did NOT relax anchor scoping - a match in another block is not taken', () => {
    // The same sentence lives in 0;1 and 0;3, so both are real search hits and
    // the preflight's text_not_found check cannot help. The op names 0;3. The
    // block anchor - not the document-wide first hit - has to decide, or the
    // relaxed offset filter would silently rewrite the wrong paragraph.
    const shared = 'We respond quickly.';
    const ed = makeRealDocumentEditor({
      sections: [
        {
          blocks: [
            para('Heading', 'Heading 1'),
            para(shared),
            para('Middle.'),
            para(shared)
          ]
        }
      ]
    });
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'right-block-among-duplicates',
        edits: [
          {
            op: 'replace_text',
            anchor: '0;3',
            find: shared,
            replace: 'We answer within a day.',
            start: 0,
            end: 0
          } as any
        ]
      });
      expect(result.results[0]).toMatchObject({ ok: true });
      // The named block changed; its twin did not.
      expect(blockTexts(ed)[3]).toBe('We answer within a day.');
      expect(blockTexts(ed)[1]).toBe(shared);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: start still does its real job - it picks WHICH of three identical occurrences', () => {
    const sentence = 'Renewal notice. ';
    const ed = makeRealDocumentEditor({
      sections: [{ blocks: [para(`${sentence}${sentence}${sentence}`.trim())] }]
    });
    try {
      ed.enableTrackChanges = true;
      // The second occurrence starts at 16. `end` is deliberately the same
      // nonsense the live payload carried; it must not affect the outcome.
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'second-occurrence',
        edits: [
          {
            op: 'replace_text',
            anchor: '0;0',
            find: 'Renewal notice.',
            replace: 'SECOND.',
            start: 16,
            end: 0
          } as any
        ]
      });
      expect(result.results[0]).toMatchObject({ ok: true });
      expect(blockTexts(ed)[0]).toBe('Renewal notice. SECOND. Renewal notice.');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: with no start supplied the first occurrence is taken, as before', () => {
    const sentence = 'Renewal notice. ';
    const ed = makeRealDocumentEditor({
      sections: [{ blocks: [para(`${sentence}${sentence}${sentence}`.trim())] }]
    });
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'first-occurrence',
        edits: [
          {
            op: 'replace_text',
            anchor: '0;0',
            find: 'Renewal notice.',
            replace: 'FIRST.'
          } as any
        ]
      });
      expect(result.results[0]).toMatchObject({ ok: true });
      expect(blockTexts(ed)[0]).toBe('FIRST. Renewal notice. Renewal notice.');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

// ---------------------------------------------------------------------------
// A SyncFusion 34.1.31 fact this suite has to state rather than paper over.
//
// Replacing a range that starts at a paragraph's offset 0 but stops short of
// its end - a PREFIX replacement - leaves `characterFormat.bidi: false`
// written explicitly onto the surviving run after the revision is rejected.
// The text is restored exactly; only that one default-valued flag goes from
// inherited to explicit.
//
// It is the editor's own behaviour, not this module's: the probe below drives
// the public DocumentEditor API directly, with no repo code in the path, and it
// reproduces identically whether the range came from Search (the pre-existing
// replace_text route) or from selection offsets. So a prefix-shaped replacement
// asserts exact CONTENT restoration plus this pinned residue, and every other
// shape - whole block, multi-run, multi-paragraph, table cell - keeps its
// byte-for-byte assertion. If the residue ever grows past this one flag, this
// test fails.
// ---------------------------------------------------------------------------

describe("SyncFusion prefix-replacement residue is the editor's, and is pinned", () => {
  it('real SDK: a raw prefix replacement through the public API alone leaves exactly bidi:false', () => {
    const text = 'Alpha beta gamma delta epsilon.';
    const ed = makeRealDocumentEditor({
      sections: [{ blocks: [{ inlines: [{ text }] }] }]
    });
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      // No repo code: public Selection + public Editor only.
      ed.selection.select('0;0;0', '0;0;10');
      ed.editor.insertText('ALPHA');
      rejectEveryRealRevision(ed);
      const after = ed.serialize();
      expect(after).not.toBe(before);
      expect(
        after.replace('"cf":{"bi":false},"tlp":"Alpha', '"cf":{},"tlp":"Alpha')
      ).toBe(before);
      // Content itself is untouched.
      expect(blockTexts(ed)).toEqual([text]);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

describe("readSelection reports the selection's full extent", () => {
  it('real SDK: a multi-paragraph selection reports its end block, not just its start', () => {
    const ed = makeRealDocumentEditor(multiParagraphDoc());
    try {
      ed.selection.select('0;1;0', `0;3;${SENT_3.length}`);
      const selection = readSelection(ed as unknown as LiveEditor);
      expect(selection).toMatchObject({
        anchor: '0;1',
        endAnchor: '0;3',
        startOffset: '0;1;0',
        endOffset: `0;3;${SENT_3.length}`,
        isCollapsed: false,
        spansBlocks: true,
        truncated: false
      });
      expect(selection?.textLength).toBe(
        `${SENT_1}\r${SENT_2}\r${SENT_3}`.length
      );
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a single-block selection reports spansBlocks false', () => {
    const ed = makeRealDocumentEditor(onePargraphDoc());
    try {
      ed.selection.select('0;1;0', `0;1;${COMMITMENT.length}`);
      expect(readSelection(ed as unknown as LiveEditor)).toMatchObject({
        anchor: '0;1',
        endAnchor: '0;1',
        spansBlocks: false,
        textLength: COMMITMENT.length,
        truncated: false
      });
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a selection longer than the text limit is flagged truncated with its true length', () => {
    const long = 'Sentence about coverage and service. '.repeat(30).trim();
    const ed = makeRealDocumentEditor({
      sections: [{ blocks: [para(long)] }]
    });
    try {
      ed.selection.select('0;0;0', `0;0;${long.length}`);
      const selection = readSelection(ed as unknown as LiveEditor);
      expect(long.length).toBeGreaterThan(500);
      expect(selection).toMatchObject({
        truncated: true,
        textLength: long.length
      });
      expect(selection?.text).toHaveLength(500);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

describe('replace_selection: every selection shape lands in one attempt', () => {
  it('real SDK: a ghosted UI selection relocates the sent range by its content', () => {
    const shifted = onePargraphDoc();
    shifted.sections[0].blocks.splice(
      1,
      0,
      para('New context inserted before the selected paragraph.')
    );
    const ed = makeRealDocumentEditor(shifted);
    try {
      ed.enableTrackChanges = true;
      // The round was sent while COMMITMENT lived at 0;1. By apply time the
      // UI range is gone and a new paragraph has shifted that content to 0;2.
      ed.selection.select('0;0;0', '0;0;0');
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'ghost-selection-relocation',
        edits: [
          {
            op: 'replace_selection',
            anchor: '0;1',
            startOffset: '0;1;0',
            endOffset: `0;1;${COMMITMENT.length}`,
            replace: ONE_STATEMENT,
            expect: COMMITMENT
          }
        ]
      });

      expect(result.results[0]).toMatchObject({
        ok: true,
        op: 'replace_selection',
        anchor: '0;2',
        relocated: { from: '0;1', to: '0;2' }
      });
      expect(blockTexts(ed)[2]).toBe(ONE_STATEMENT);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a single-run selection (a sub-range of one paragraph)', () => {
    const ed = makeRealDocumentEditor(onePargraphDoc());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const sentence =
        'At Hilb Group, our commitment to clients extends well beyond the placement of coverage.';
      ed.selection.select('0;1;0', `0;1;${sentence.length}`);
      const selection = readSelection(ed as unknown as LiveEditor)!;

      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'single-run',
        edits: [
          {
            op: 'replace_selection',
            anchor: selection.anchor,
            startOffset: selection.startOffset,
            endOffset: selection.endOffset,
            replace: 'We do more than place coverage.',
            expect: selection.text
          } as any
        ]
      });

      expect(result.results[0]).toMatchObject({
        ok: true,
        op: 'replace_selection'
      });
      expect(blockTexts(ed)[1]).toBe(
        `We do more than place coverage.${COMMITMENT.slice(sentence.length)}`
      );
      expect(revisionTypes(ed).sort()).toEqual(['Deletion', 'Insertion']);
      rejectEveryRealRevision(ed);
      // A prefix-shaped range: exact content restoration, plus SyncFusion's own
      // bidi:false residue and nothing else. See the pinning test above.
      expect(blockTexts(ed)).toEqual([
        'Our commitments to the client',
        COMMITMENT,
        '',
        'A Long-Term Perspective'
      ]);
      expect(
        ed
          .serialize()
          .replace(
            `"cf":{"bi":false},"tlp":"${COMMITMENT}`,
            `"cf":{},"tlp":"${COMMITMENT}`
          )
      ).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it.each([
    [
      'without the selected paragraph mark',
      ['We guide clients before renewal.', 'We stay through claims.'],
      false
    ],
    [
      'with the selected paragraph mark',
      ['We guide clients before renewal.', 'We stay through claims.'],
      true
    ],
    [
      'into three paragraphs',
      [
        'We plan before renewal.',
        'We negotiate in the market.',
        'We stay through claims.'
      ],
      true
    ]
  ])(
    'real SDK: splits one selected paragraph %s and survives verification',
    (_label, parts, includeParagraphMark) => {
      const ed = makeRealDocumentEditor(onePargraphDoc());
      try {
        ed.enableTrackChanges = true;
        const before = ed.serialize();
        const expectedSelection = `${COMMITMENT}${
          includeParagraphMark ? '\r' : ''
        }`;
        const replacement = parts.join('\r');
        const result = applyDocumentEdits(ed as unknown as LiveEditor, {
          changeSetId: `paragraph-split-${parts.length}-${
            includeParagraphMark ? 'with-mark' : 'without-mark'
          }`,
          edits: [
            {
              op: 'replace_selection',
              anchor: '0;1',
              startOffset: '0;1;0',
              endOffset: `0;1;${expectedSelection.length}`,
              replace: replacement,
              expect: expectedSelection
            } as any
          ]
        });

        expect(result.results[0]).toMatchObject({ ok: true });
        expect(result.changeSet).toMatchObject({ status: 'applied' });
        expect(blockTexts(ed).slice(1, 1 + parts.length)).toEqual(parts);
        expect(blockTexts(ed)).not.toContain(COMMITMENT);
        expect(realRevisions(ed).length).toBeGreaterThan(0);

        rejectEveryRealRevision(ed);
        expect(ed.serialize()).toBe(before);
      } finally {
        destroyRealDocumentEditor(ed);
      }
    }
  );

  it('real SDK: a multi-run selection (bold + plain + italic in one paragraph)', () => {
    const ed = makeRealDocumentEditor(multiRunDoc());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      ed.selection.select('0;1;0', `0;1;${MULTI_RUN_TEXT.length}`);
      const selection = readSelection(ed as unknown as LiveEditor)!;
      expect(selection.text).toBe(MULTI_RUN_TEXT);

      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'multi-run',
        edits: [
          {
            op: 'replace_selection',
            anchor: selection.anchor,
            startOffset: selection.startOffset,
            endOffset: selection.endOffset,
            replace: 'Coverage is placed and serviced for the whole term.',
            expect: selection.text
          } as any
        ]
      });

      expect(result.results[0]).toMatchObject({ ok: true });
      expect(blockTexts(ed)[1]).toBe(
        'Coverage is placed and serviced for the whole term.'
      );
      expect(revisionTypes(ed).sort()).toEqual(['Deletion', 'Insertion']);
      rejectEveryRealRevision(ed);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it("THE CAPTAIN'S CASE, real SDK: several sentences spanning paragraph boundaries collapse to one statement in one attempt, rejectably", () => {
    const ed = makeRealDocumentEditor(multiParagraphDoc());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();

      // The user drags across three paragraphs and says "make this into one
      // statement". This is the selection the browser hands us.
      ed.selection.select('0;1;0', `0;3;${SENT_3.length}`);
      const selection = readSelection(ed as unknown as LiveEditor)!;
      expect(selection.spansBlocks).toBe(true);

      const oneStatement =
        'We advocate at every stage of the policy lifecycle, keep you with the people who know your account, and answer quickly.';

      // ONE attempt. Every field is copied from the selection context; nothing
      // is counted.
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'make-this-into-one-statement',
        edits: [
          {
            op: 'replace_selection',
            anchor: selection.anchor,
            startOffset: selection.startOffset,
            endOffset: selection.endOffset,
            replace: oneStatement,
            expect: selection.text,
            expectLength: selection.textLength
          } as any
        ]
      });

      expect(result.results[0]).toMatchObject({
        ok: true,
        op: 'replace_selection'
      });
      expect(result.changeSet).toMatchObject({ status: 'applied' });

      // The three sentences are gone and the one statement is there. The
      // emptied blocks are the paragraph marks still held as tracked deletions.
      const after = blockTexts(ed);
      expect(after.join('\n')).toContain(oneStatement);
      expect(after.join('\n')).not.toContain(SENT_1);
      expect(after.join('\n')).not.toContain(SENT_2);
      // Nothing outside the selection moved.
      expect(after[0]).toBe('Our commitments to the client');
      expect(after[after.length - 1]).toBe('Long term body text.');

      // Rejectable as a tracked change...
      expect(revisionTypes(ed).sort()).toEqual(['Deletion', 'Insertion']);
      expect(
        realRevisions(ed).every(
          (revision) => typeof revision.reject === 'function'
        )
      ).toBe(true);

      // ...and rejecting restores the document byte for byte.
      rejectEveryRealRevision(ed);
      expect(blockTexts(ed)).toEqual([
        'Our commitments to the client',
        SENT_1,
        SENT_2,
        SENT_3,
        'A Long-Term Perspective',
        'Long term body text.'
      ]);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a table-cell selection', () => {
    const ed = makeRealDocumentEditor(tableDoc());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const cellText = '99 Old Rd, Toronto, Ontario';
      ed.selection.select('0;1;1;1;0;0', `0;1;1;1;0;${cellText.length}`);
      const selection = readSelection(ed as unknown as LiveEditor)!;
      expect(selection).toMatchObject({
        anchor: '0;1;1;1;0',
        endAnchor: '0;1;1;1;0',
        spansBlocks: false
      });
      expect(selection.text).toBe(cellText);

      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'cell-selection',
        edits: [
          {
            op: 'replace_selection',
            anchor: selection.anchor,
            startOffset: selection.startOffset,
            endOffset: selection.endOffset,
            replace: '111 Bathurst St, Toronto, Ontario',
            expect: selection.text
          } as any
        ]
      });

      expect(result.results[0]).toMatchObject({ ok: true });
      expect(blockTexts(ed)).toContain('111 Bathurst St, Toronto, Ontario');
      expect(revisionTypes(ed).sort()).toEqual(['Deletion', 'Insertion']);
      rejectEveryRealRevision(ed);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: with no offsets supplied it rewrites the whole anchored block', () => {
    const ed = makeRealDocumentEditor(onePargraphDoc());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'no-offsets',
        edits: [
          {
            op: 'replace_selection',
            anchor: '0;1',
            // Schema-filled empties, exactly as a real tool call delivers them.
            startOffset: '',
            endOffset: '',
            replace: ONE_STATEMENT,
            expect: COMMITMENT
          } as any
        ]
      });
      expect(result.results[0]).toMatchObject({ ok: true });
      expect(blockTexts(ed)[1]).toBe(ONE_STATEMENT);
      rejectEveryRealRevision(ed);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a truncated expect is accepted only with a matching expectLength', () => {
    const long = 'Sentence about coverage and service. '.repeat(30).trim();
    const ed = makeRealDocumentEditor({
      sections: [{ blocks: [para(long)] }]
    });
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      ed.selection.select('0;0;0', `0;0;${long.length}`);
      const selection = readSelection(ed as unknown as LiveEditor)!;
      expect(selection.truncated).toBe(true);

      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'truncated-expect',
        edits: [
          {
            op: 'replace_selection',
            anchor: selection.anchor,
            startOffset: selection.startOffset,
            endOffset: selection.endOffset,
            replace: 'Coverage and service, in one sentence.',
            expect: selection.text,
            expectLength: selection.textLength
          } as any
        ]
      });
      expect(result.results[0]).toMatchObject({ ok: true });
      expect(blockTexts(ed)[0]).toBe('Coverage and service, in one sentence.');
      rejectEveryRealRevision(ed);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

describe('replace_selection refuses, by name and with a remedy, what it cannot write', () => {
  const refusal = (
    sfdt: any,
    edit: Record<string, unknown>
  ): { result: any; unchanged: boolean; revisions: number } => {
    const ed = makeRealDocumentEditor(sfdt);
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const out = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'refusal',
        edits: [edit as any]
      });
      return {
        result: out.results[0],
        unchanged: ed.serialize() === before,
        revisions: ed.revisions.length
      };
    } finally {
      destroyRealDocumentEditor(ed);
    }
  };

  it('real SDK: a selection spanning two table cells names the boundary and how to split it', () => {
    const { result, unchanged, revisions } = refusal(tableDoc(), {
      op: 'replace_selection',
      anchor: '0;1;1;0;0',
      startOffset: '0;1;1;0;0;0',
      endOffset: '0;1;1;1;0;27',
      replace: 'one cell now',
      expect: '0092\r99 Old Rd, Toronto, Ontario'
    });
    expect(result).toMatchObject({
      ok: false,
      error: 'selection_spans_table_boundary'
    });
    expect(result.details.join(' ')).toContain('one cell at a time');
    expect(result.details.join(' ')).toContain('0;1;1;0;0');
    expect(revisions).toBe(0);
    expect(unchanged).toBe(true);
  });

  it('real SDK: a selection running from the body into a table cell is refused the same way', () => {
    const { result, unchanged, revisions } = refusal(tableDoc(), {
      op: 'replace_selection',
      anchor: '0;0',
      startOffset: '0;0;0',
      endOffset: '0;1;1;1;0;27',
      replace: 'nope',
      expectLength: 10
    });
    expect(result).toMatchObject({
      ok: false,
      error: 'selection_spans_table_boundary'
    });
    expect(result.details.join(' ')).toContain('one cell at a time');
    expect(revisions).toBe(0);
    expect(unchanged).toBe(true);
  });

  it('real SDK: an op with no guard at all is refused with the live text and the remedy', () => {
    const { result, unchanged, revisions } = refusal(onePargraphDoc(), {
      op: 'replace_selection',
      anchor: '0;1',
      startOffset: '0;1;0',
      endOffset: `0;1;${COMMITMENT.length}`,
      replace: ONE_STATEMENT
    });
    expect(result).toMatchObject({
      ok: false,
      error: 'missing_selection_guard'
    });
    expect(result.details.join(' ')).toContain('expectLength');
    expect(revisions).toBe(0);
    expect(unchanged).toBe(true);
  });

  it('real SDK: a stale expect on the range is refused, and the refusal quotes the RANGE not the block', () => {
    const { result, unchanged, revisions } = refusal(multiParagraphDoc(), {
      op: 'replace_selection',
      anchor: '0;1',
      startOffset: '0;1;0',
      endOffset: `0;3;${SENT_3.length}`,
      replace: 'one statement',
      expect: 'Something the user never selected.'
    });
    expect(result).toMatchObject({ ok: false, error: 'stale_anchor' });
    // The compare-and-swap ran against the three-paragraph selection, so the
    // live text it reports carries the paragraph marks. A block-scoped guard
    // could only ever quote SENT_1 on its own.
    expect(result.details.join(' ')).toContain(`${SENT_1}\\r${SENT_2}`);
    expect(revisions).toBe(0);
    expect(unchanged).toBe(true);
  });

  it('real SDK: a wrong expectLength on a SUB-RANGE is refused, measured against the range', () => {
    // A 200-character prefix of a 457-character paragraph: the range's length
    // is 200, so only a range-scoped guard can judge this at all.
    const { result, unchanged, revisions } = refusal(onePargraphDoc(), {
      op: 'replace_selection',
      anchor: '0;1',
      startOffset: '0;1;0',
      endOffset: '0;1;200',
      replace: ONE_STATEMENT,
      expect: COMMITMENT.slice(0, 100),
      expectLength: 457 // the whole block, not the 200-character selection
    });
    expect(result).toMatchObject({ ok: false, error: 'stale_anchor' });
    expect(result.details.join(' ')).toContain('200 characters');
    expect(revisions).toBe(0);
    expect(unchanged).toBe(true);
  });

  it('real SDK: a prefix that does not match is refused even with the right length', () => {
    const { result, unchanged, revisions } = refusal(onePargraphDoc(), {
      op: 'replace_selection',
      anchor: '0;1',
      startOffset: '0;1;0',
      endOffset: '0;1;200',
      replace: ONE_STATEMENT,
      expect: 'At Hilb Group, our promise to clients',
      expectLength: 200
    });
    expect(result).toMatchObject({ ok: false, error: 'stale_anchor' });
    // Quotes exactly the 200-character range: a block-scoped guard would quote
    // the 457-character paragraph, whose excerpt runs well past character 200.
    const details = result.details.join(' ');
    expect(details).toContain(COMMITMENT.slice(0, 200));
    expect(details).not.toContain(COMMITMENT.slice(0, 240));
    expect(revisions).toBe(0);
    expect(unchanged).toBe(true);
  });

  it('real SDK: expectLength alone refuses a same-length concurrent content change', () => {
    const concurrentlyChanged = COMMITMENT.replace('commitment', 'dedication');
    expect(concurrentlyChanged).not.toBe(COMMITMENT);
    expect(concurrentlyChanged).toHaveLength(COMMITMENT.length);
    const changedDoc = onePargraphDoc();
    changedDoc.sections[0].blocks[1] = para(concurrentlyChanged);

    const { result, unchanged, revisions } = refusal(changedDoc, {
      op: 'replace_selection',
      anchor: '0;1',
      startOffset: '0;1;0',
      endOffset: `0;1;${concurrentlyChanged.length}`,
      replace: ONE_STATEMENT,
      // This is all a stale caller could prove from the earlier selection.
      // It matches the new content's length but pins none of its characters.
      expectLength: COMMITMENT.length
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'missing_selection_guard'
    });
    expect(result.details.join(' ')).toContain(
      'length alone does not pin content'
    );
    expect(revisions).toBe(0);
    expect(unchanged).toBe(true);
  });

  it('real SDK: a collapsed selection is refused with the remedy naming insert_text', () => {
    const { result, unchanged, revisions } = refusal(onePargraphDoc(), {
      op: 'replace_selection',
      anchor: '0;1',
      startOffset: '0;1;10',
      endOffset: '0;1;10',
      replace: 'nope',
      expectLength: 1
    });
    expect(result).toMatchObject({ ok: false, error: 'selection_empty' });
    expect(result.details.join(' ')).toContain('insert_text');
    expect(revisions).toBe(0);
    expect(unchanged).toBe(true);
  });

  it('real SDK: an endOffset naming a block that does not exist is refused as unresolvable', () => {
    const { result, unchanged, revisions } = refusal(onePargraphDoc(), {
      op: 'replace_selection',
      anchor: '0;1',
      startOffset: '0;1;0',
      endOffset: '0;97;4',
      replace: 'nope',
      expectLength: 5
    });
    expect(result).toMatchObject({
      ok: false,
      error: 'selection_range_unresolvable'
    });
    expect(revisions).toBe(0);
    expect(unchanged).toBe(true);
  });

  it("real SDK: a startOffset that disagrees with the op's anchor is refused, not silently preferred", () => {
    const { result, unchanged, revisions } = refusal(multiParagraphDoc(), {
      op: 'replace_selection',
      anchor: '0;1',
      startOffset: '0;2;0',
      endOffset: `0;2;${SENT_2.length}`,
      replace: 'nope',
      expect: SENT_2
    });
    expect(result).toMatchObject({
      ok: false,
      error: 'selection_anchor_mismatch'
    });
    expect(revisions).toBe(0);
    expect(unchanged).toBe(true);
  });

  it('real SDK: replace_selection with no replacement value is refused', () => {
    const { result, revisions } = refusal(onePargraphDoc(), {
      op: 'replace_selection',
      anchor: '0;1',
      startOffset: '0;1;0',
      endOffset: `0;1;${COMMITMENT.length}`,
      expect: COMMITMENT
    });
    expect(result).toMatchObject({ ok: false, error: 'missing_replace' });
    expect(revisions).toBe(0);
  });
});

describe('replace_selection is a declared capability', () => {
  it('is in the registry with its live anchor and parameter contract', () => {
    const entry = DOCUMENT_EDITOR_CAPABILITIES.find(
      (capability) => capability.op === 'replace_selection'
    );
    expect(entry).toEqual({
      op: 'replace_selection',
      params: {
        replace: 'string',
        startOffset: 'string?',
        endOffset: 'string?',
        expectLength: 'int>=0?'
      },
      requiresAnchor: true
    });
  });
});
