// The `expect` compare-and-swap guard: what it actually detects, including the
// distinction between an omitted expectation and an expected empty value.
//
// Live evidence (captain's session, 2026-07-27, `data/hilb-live-perf/report.md`
// sections 3-4): every `stale_anchor` in a 30-minute window but ONE was this
// guard refusing an edit that was perfectly correct. The one true positive was a
// document that had genuinely reverted between the read and the write.
//
// There is no anchor-revision map anywhere in this module, so `stale_anchor`
// never was positional-drift detection. The name cost three separate
// investigations, and worse, it told the model to "re-read the inventory and
// retry with a corrected anchor" (ai-services prompt) - advice that cannot
// possibly help when the anchor was right all along, so the model burned round
// trips re-reading unchanged content. Turn E3 took 6 round trips (~57s) for an
// edit whose minimum is 2, and the identical edit succeeded the moment `expect`
// happened to arrive without its paragraph mark.
//
// The two regressions this suite pins:
//
//  1. A whole-paragraph selection's text ENDS WITH A PARAGRAPH MARK. `readSelection`
//     returns `editor.selection.text` verbatim, and for a whole-paragraph drag
//     SyncFusion includes the trailing `\r`. Inventory text never does. So a model
//     that faithfully copies the selection it was handed into `expect` can never
//     satisfy the guard - the designed zero-read fast path for "rewrite this"
//     could not validate.
//
//  2. `expect: ""` was relaxed into "no expectation". For `set_cell_text`,
//     which has no `find` check, this removed the only content CAS and allowed a
//     stale empty-cell read to overwrite content inserted by another actor.
//
// The guard itself must survive: it exists so an edit cannot land on content that
// moved under it. These tests pin that it still bites.
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
  const host = editor.element;
  editor.destroy();
  host?.remove();
}

const PARAGRAPH =
  'At Hilb Group, our commitment to clients extends well beyond the placement of coverage.';

const baseDoc = () => ({
  sections: [
    {
      blocks: [
        { inlines: [{ text: 'Our commitments to the client' }] },
        { inlines: [{ text: PARAGRAPH }] },
        { inlines: [{ text: 'A Long-Term Perspective' }] }
      ]
    }
  ]
});

// A table whose reference row carries real content - the shape `insert_row`
// targets, and the shape an `expect: ""` placeholder collided with live.
const tableDoc = () => {
  const cell = (text: string) => ({
    cellFormat: {},
    blocks: [{ inlines: [{ text }] }]
  });
  return {
    sections: [
      {
        blocks: [
          { inlines: [{ text: 'Location Schedule' }] },
          {
            tableFormat: {},
            rows: [
              { rowFormat: {}, cells: [cell('Location'), cell('Premium')] },
              { rowFormat: {}, cells: [cell('Cleveland'), cell('$41,250.00')] }
            ]
          },
          { inlines: [{ text: 'End' }] }
        ]
      }
    ]
  };
};

const textAt = (ed: DocumentEditor, anchor: string): string | undefined =>
  flattenSfdt(JSON.parse(ed.serialize())).find((b) => b.anchor === anchor)?.text;

const withEditor = (sfdt: any, run: (ed: DocumentEditor) => void) => {
  const ed = makeRealDocumentEditor(sfdt);
  try {
    ed.enableTrackChanges = false;
    run(ed);
  } finally {
    destroyRealDocumentEditor(ed);
  }
};

// ---------------------------------------------------------------------------
// Misfire 1: the paragraph mark a selection carries
// ---------------------------------------------------------------------------
describe("misfire 1: a selection's own text could never satisfy the guard", () => {
  it('a whole-paragraph selection really does carry a trailing paragraph mark', () => {
    withEditor(baseDoc(), (ed) => {
      // Select the whole paragraph INCLUDING its mark, exactly as a user drag does.
      ed.selection.select('0;1;0', `0;1;${PARAGRAPH.length + 1}`);
      const selection = readSelection(ed as unknown as LiveEditor);

      // This is the bug's raw material: what the client hands the model ends in
      // \r, and what the guard compares against never does.
      expect(selection?.text).toBe(`${PARAGRAPH}\r`);
      expect(textAt(ed, '0;1')).toBe(PARAGRAPH);
      expect(selection?.text).not.toBe(textAt(ed, '0;1'));
    });
  });

  it("THE CAPTAIN'S E3 TURN: the selection text as `expect` now lands in one attempt", () => {
    withEditor(baseDoc(), (ed) => {
      ed.selection.select('0;1;0', `0;1;${PARAGRAPH.length + 1}`);
      const selection = readSelection(ed as unknown as LiveEditor);
      const before = ed.serialize();

      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'make-commitment-one-statement',
        edits: [
          {
            op: 'replace_text',
            anchor: '0;1',
            find: PARAGRAPH,
            replace: 'At Hilb Group, we support clients throughout the lifecycle.',
            // Copied verbatim from the selection the client delivered - mark and all.
            expect: selection?.text
          }
        ]
      });

      expect(result.results[0]).toMatchObject({ ok: true, op: 'replace_text' });
      expect(result.changeSet.status).toBe('applied');
      expect(textAt(ed, '0;1')).toContain('we support clients throughout');

      // Tracked and fully reversible: rejecting restores the document byte for byte.
      const revisions = (ed as any).revisions;
      const created = Array.from(
        { length: revisions.length },
        (_, i) => revisions.changes[i] ?? revisions[i]
      ).filter(Boolean);
      expect(created.length).toBeGreaterThan(0);
      for (const revision of [...created].reverse()) revision.reject();
      expect(ed.serialize()).toBe(before);
    });
  });

  it('normalisation is limited to the paragraph mark - a trailing SPACE is still a real difference', () => {
    withEditor(baseDoc(), (ed) => {
      const before = ed.serialize();

      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'trailing-space-is-content',
        edits: [
          {
            op: 'replace_text',
            anchor: '0;1',
            find: PARAGRAPH,
            replace: 'Rewritten.',
            // A trailing space is CONTENT, not a paragraph mark. Accepting this
            // would be weakening the guard, not un-breaking it.
            expect: `${PARAGRAPH} `
          }
        ]
      });

      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'expect_mismatch'
      });
      expect(ed.serialize()).toBe(before);
    });
  });
});

// ---------------------------------------------------------------------------
// Expected empty is not the same as no expectation
// ---------------------------------------------------------------------------
describe('an empty `expect` remains a strict compare-and-swap value', () => {
  it('a stale expected-empty structural target is refused byte-for-byte', () => {
    withEditor(tableDoc(), (ed) => {
      const before = ed.serialize();
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'add-location-row',
        edits: [
          {
            op: 'insert_row',
            anchor: '0;1;1;0;0',
            expect: ''
          }
        ]
      });

      expect(result.results[0]).toMatchObject({
        ok: false,
        op: 'insert_row',
        error: 'expect_mismatch'
      });
      expect(ed.serialize()).toBe(before);
    });
  });

  it('set_cell_text refuses expect empty at a now-populated cell, but omission permits the write', () => {
    withEditor(tableDoc(), (ed) => {
      const before = ed.serialize();
      const stale = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'stale-empty-cell',
        edits: [
          {
            op: 'set_cell_text',
            anchor: '0;1;1;0;0',
            text: 'Detroit',
            expect: ''
          }
        ]
      });

      expect(stale.results[0]).toMatchObject({
        ok: false,
        op: 'set_cell_text',
        error: 'expect_mismatch'
      });
      expect(ed.serialize()).toBe(before);
      expect(textAt(ed, '0;1;1;0;0')).toBe('Cleveland');

      const unguarded = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'explicitly-unguarded-cell',
        edits: [
          {
            op: 'set_cell_text',
            anchor: '0;1;1;0;0',
            text: 'Detroit'
          }
        ]
      });
      expect(unguarded.results[0]).toMatchObject({
        ok: true,
        op: 'set_cell_text'
      });
      expect(textAt(ed, '0;1;1;0;0')).toBe('Detroit');
    });
  });

  it('an empty `expect` on a genuinely empty block still passes, as it always did', () => {
    withEditor(
      {
        sections: [
          { blocks: [{ inlines: [{ text: 'Heading' }] }, { inlines: [] }] }
        ]
      },
      (ed) => {
        const result = applyDocumentEdits(ed as unknown as LiveEditor, {
          changeSetId: 'fill-the-empty-block',
          edits: [
            {
              op: 'insert_text',
              anchor: '0;1',
              position: 'after',
              text: 'Filled.',
              expect: ''
            }
          ]
        });

        expect(result.results[0]).toMatchObject({ ok: true });
      }
    );
  });
});

// ---------------------------------------------------------------------------
// The name
// ---------------------------------------------------------------------------
describe('the error names what it actually detects', () => {
  it('a wrong `expect` reports expect_mismatch, never stale_anchor', () => {
    withEditor(baseDoc(), (ed) => {
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'wrong-expect',
        edits: [
          {
            op: 'replace_text',
            anchor: '0;1',
            find: PARAGRAPH,
            replace: 'Rewritten.',
            expect: 'Text that was never in this document'
          }
        ]
      });

      const failure = result.results[0] as any;
      // The old name asserted positional drift that this module never measured,
      // and sent the model re-reading an anchor that was correct all along.
      expect(failure.error).toBe('expect_mismatch');
      expect(failure.error).not.toBe('stale_anchor');
    });
  });

  it('the refusal still quotes the live text so ONE informed retry replaces three blind ones', () => {
    withEditor(baseDoc(), (ed) => {
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'wrong-expect-details',
        edits: [
          {
            op: 'replace_text',
            anchor: '0;1',
            find: PARAGRAPH,
            replace: 'Rewritten.',
            expect: 'Not the live text'
          }
        ]
      });

      const details = ((result.results[0] as any).details ?? []).join('\n');
      expect(details).toContain('Not the live text');
      expect(details).toContain(PARAGRAPH);
    });
  });
});

// ---------------------------------------------------------------------------
// The protection the guard exists for
// ---------------------------------------------------------------------------
describe('the guard still stops an edit landing on changed content', () => {
  it('THE TRUE POSITIVE: content that changed between read and write is refused, and nothing is written', () => {
    withEditor(baseDoc(), (ed) => {
      // Thread B's finalize changeset: the model read the block, the document
      // then genuinely changed underneath, and the write had to be refused.
      const expectFromEarlierRead = PARAGRAPH;

      applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'someone-else-edits-first',
        edits: [
          {
            op: 'replace_text',
            anchor: '0;1',
            find: 'commitment',
            replace: 'dedication'
          }
        ]
      });
      const afterFirstEdit = ed.serialize();
      expect(textAt(ed, '0;1')).not.toBe(expectFromEarlierRead);

      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'finalize',
        edits: [
          {
            op: 'replace_text',
            anchor: '0;1',
            find: 'coverage',
            replace: 'insurance',
            expect: expectFromEarlierRead
          }
        ]
      });

      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'expect_mismatch'
      });
      // The whole point of a compare-and-swap: a refusal writes nothing.
      expect(ed.serialize()).toBe(afterFirstEdit);
    });
  });

  it('a paragraph-mark difference is normalised, but a one-character content change is NOT', () => {
    withEditor(baseDoc(), (ed) => {
      const before = ed.serialize();

      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'one-char-off',
        edits: [
          {
            op: 'replace_text',
            anchor: '0;1',
            find: PARAGRAPH,
            replace: 'Rewritten.',
            // Same text, one character different, plus a paragraph mark. The
            // mark is forgiven; the character is not.
            expect: `${PARAGRAPH.replace('commitment', 'committment')}\r`
          }
        ]
      });

      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'expect_mismatch'
      });
      expect(ed.serialize()).toBe(before);
    });
  });

  it('an empty `expect` does not become a licence to write at a WRONG anchor', () => {
    withEditor(baseDoc(), (ed) => {
      const before = ed.serialize();

      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'empty-expect-bad-anchor',
        edits: [
          {
            op: 'replace_text',
            anchor: '0;9',
            find: PARAGRAPH,
            replace: 'Rewritten.',
            expect: ''
          }
        ]
      });

      // Dropping a placeholder `expect` must not relax anchor resolution.
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'anchor_not_found'
      });
      expect(ed.serialize()).toBe(before);
    });
  });

  it('an empty `expect` is checked before the independent find-text predicate', () => {
    withEditor(baseDoc(), (ed) => {
      const before = ed.serialize();

      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'empty-expect-missing-find',
        edits: [
          {
            op: 'replace_text',
            anchor: '0;1',
            find: 'text that is not in this block',
            replace: 'Rewritten.',
            expect: ''
          }
        ]
      });

      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'expect_mismatch'
      });
      expect(ed.serialize()).toBe(before);
    });
  });
});
