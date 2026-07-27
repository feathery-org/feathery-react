// Regression: formatting the paragraphs a structural insert just created.
// Live evidence (captain, 2026-07-27): insert_text at 2;13 SUCCEEDED, the
// follow-up apply_style ops at 2;14/2;15 - the anchors the inserted
// paragraphs now occupy - died anchor_not_found 18 times, leaving the new
// section unformatted. Root cause was NOT positional anchor drift: in a
// formatting-only change set, a format op whose schema-forced `expect` did
// not match the live block was stripped of its preflight target and then
// misreported as anchor_not_found, an error that tells the model the anchor
// is wrong and sends every retry into the same wall.
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

function selectRealBlock(editor: DocumentEditor, anchor: string, text: string) {
  editor.selection.select(`${anchor};0`, `${anchor};${text.length}`);
  return {
    text: editor.selection.text,
    characterFormat: editor.selection.characterFormat,
    paragraphFormat: editor.selection.paragraphFormat
  };
}

const anchoredTexts = (editor: DocumentEditor) =>
  flattenSfdt(JSON.parse(editor.serialize())).map(
    (b) => [b.anchor, b.text] as const
  );

const baseDoc = () => ({
  sections: [
    {
      blocks: [
        { inlines: [{ text: 'Intro' }] },
        { inlines: [{ text: 'A Long-Term Perspective' }] },
        { inlines: [{ text: 'Perspective body' }] },
        { inlines: [{ text: 'End' }] }
      ]
    }
  ]
});

const insertCommitmentSection = (ed: DocumentEditor) => {
  const insert = applyDocumentEdits(ed as unknown as LiveEditor, {
    changeSetId: 'insert-section',
    edits: [
      {
        op: 'insert_text',
        anchor: '0;1',
        position: 'after',
        text: 'Our Commitment to Clients\rWe commit to X.'
      }
    ]
  });
  expect(insert.results[0]).toMatchObject({ ok: true, op: 'insert_text' });
  // The inserted paragraphs occupy the next two block indices.
  expect(anchoredTexts(ed)).toEqual(
    expect.arrayContaining([
      ['0;2', 'Our Commitment to Clients'],
      ['0;3', 'We commit to X.']
    ])
  );
};

describe('formatting the paragraphs a structural insert created', () => {
  it('real SDK: one change set - insert plus formatting at the created anchors lands atomically', () => {
    const ed = makeRealDocumentEditor(baseDoc());
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'insert-then-style-same-batch',
        edits: [
          {
            op: 'insert_text',
            anchor: '0;1',
            position: 'after',
            text: 'Our Commitment to Clients\rWe commit to X.'
          },
          {
            op: 'apply_style',
            anchor: '0;2',
            styleName: 'Heading 2',
            expect: 'Our Commitment to Clients'
          },
          {
            op: 'set_char_format',
            anchor: '0;3',
            bold: true,
            expect: 'We commit to X.'
          }
        ]
      });

      expect(result.results.map((r) => r?.ok)).toEqual([true, true, true]);
      const heading = selectRealBlock(ed, '0;2', 'Our Commitment to Clients');
      expect(heading.paragraphFormat.styleName).toBe('Heading 2');
      const body = selectRealBlock(ed, '0;3', 'We commit to X.');
      expect(body.characterFormat.bold).toBe(true);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: follow-up formatting set with correct expect lands on the inserted paragraphs', () => {
    const ed = makeRealDocumentEditor(baseDoc());
    try {
      ed.enableTrackChanges = true;
      insertCommitmentSection(ed);

      const style = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'style-follow-up',
        edits: [
          {
            op: 'apply_style',
            anchor: '0;2',
            styleName: 'Heading 2',
            expect: 'Our Commitment to Clients'
          },
          {
            op: 'set_char_format',
            anchor: '0;3',
            bold: true,
            expect: 'We commit to X.'
          }
        ]
      });

      expect(style.results.map((r) => r?.ok)).toEqual([true, true]);
      const heading = selectRealBlock(ed, '0;2', 'Our Commitment to Clients');
      expect(heading.paragraphFormat.styleName).toBe('Heading 2');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  // The captain's exact failure shape: the op schema forces `expect` onto
  // every op, so the formatting set arrives with expect:"" against real
  // content. That is an artifact, not an expectation - the formatting must
  // land, not die anchor_not_found on an anchor that exists.
  it('real SDK: follow-up formatting set with schema-forced empty expect still lands', () => {
    const ed = makeRealDocumentEditor(baseDoc());
    try {
      ed.enableTrackChanges = true;
      insertCommitmentSection(ed);

      const style = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'style-empty-expect',
        edits: [
          { op: 'apply_style', anchor: '0;2', styleName: 'Heading 2', expect: '' },
          { op: 'set_char_format', anchor: '0;3', bold: true, expect: '' }
        ]
      });

      expect(style.results.map((r) => r?.ok)).toEqual([true, true]);
      const heading = selectRealBlock(ed, '0;2', 'Our Commitment to Clients');
      expect(heading.paragraphFormat.styleName).toBe('Heading 2');
      const body = selectRealBlock(ed, '0;3', 'We commit to X.');
      expect(body.characterFormat.bold).toBe(true);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a WRONG non-empty expect on an existing block reports expect_mismatch with the live text, never anchor_not_found', () => {
    const ed = makeRealDocumentEditor(baseDoc());
    try {
      ed.enableTrackChanges = true;
      insertCommitmentSection(ed);

      const style = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'style-wrong-expect',
        edits: [
          {
            op: 'apply_style',
            anchor: '0;2',
            styleName: 'Heading 2',
            expect: 'Some other heading'
          }
        ]
      });

      expect(style.results[0]).toMatchObject({
        ok: false,
        op: 'apply_style',
        anchor: '0;2',
        error: 'expect_mismatch'
      });
      // The details carry the live text so ONE informed retry can fix expect,
      // instead of the model re-hunting for a "missing" anchor.
      expect(JSON.stringify(style.results[0].details)).toContain(
        'Our Commitment to Clients'
      );
      const heading = selectRealBlock(ed, '0;2', 'Our Commitment to Clients');
      expect(heading.paragraphFormat.styleName).not.toBe('Heading 2');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a formatting op at a genuinely absent anchor still reports anchor_not_found', () => {
    const ed = makeRealDocumentEditor(baseDoc());
    try {
      ed.enableTrackChanges = true;
      const style = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'style-missing-anchor',
        edits: [
          { op: 'apply_style', anchor: '0;9', styleName: 'Heading 2', expect: '' }
        ]
      });
      expect(style.results[0]).toMatchObject({
        ok: false,
        error: 'anchor_not_found'
      });
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});
