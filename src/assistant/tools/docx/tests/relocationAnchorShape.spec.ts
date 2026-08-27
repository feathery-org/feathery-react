/**
 * What a relocation anchor is allowed to name.
 *
 * A section move is defined over SECTION UNITS: a heading and everything under
 * it until the next heading of the same or shallower level. `resolveSectionRange`
 * accepts any top-level block as the anchor, and gives a non-heading
 * `level = Number.POSITIVE_INFINITY` - so the scan for "the next heading at or
 * above my level" stops at the next heading of ANY level, and when no heading
 * follows at all, the range runs to the end of the document.
 *
 * That is how a move anchored at an empty paragraph came to relocate most of a
 * document and destroy the binding tags it carried, then be refused after the
 * damage. My first fix blamed the range's CONTENTS and refused every relocation
 * carrying a bound value, which also refused the correct case - a section moved
 * by its heading, which conserves every word and every binding. The contents
 * were never the problem; the anchor was.
 *
 * This file measures the two cases against each other so the discriminator is
 * recorded rather than assumed, and so the eventual fix cannot quietly break
 * the case that already works.
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
import { applyDocumentEdits, flattenSfdt, LiveEditor } from '../syncfusionDocumentOps';

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

const para = (text: string) => ({
  paragraphFormat: {},
  characterFormat: {},
  inlines: text ? [{ characterFormat: {}, text }] : []
});
const heading = (text: string) => ({
  paragraphFormat: { outlineLevel: 'Level1', styleName: 'Heading 1' },
  characterFormat: {},
  inlines: [{ characterFormat: {}, text }]
});

/**
 * Two headed sections, and - deliberately - a trailing region after the LAST
 * heading with an empty paragraph in it. That empty paragraph is the anchor the
 * boundary sweep found: a non-heading with no heading after it.
 */
const doc = () => ({
  sections: [
    {
      sectionFormat: { pageWidth: 612, pageHeight: 792 },
      blocks: [
        heading('Overview'),
        para('The overview body.'),
        heading('Costs'),
        para('The costs body.'),
        para(''),
        para('Trailing note after everything.')
      ]
    }
  ]
});

// Measured the way relocationCapability.spec.ts measures, deliberately: block
// texts joined by a SPACE. Concatenating them fused "Overview" and "The" into
// one token and made the word bag useless as a conservation check - my own
// instrument, wrong in the same way twice in one day.
const documentText = (editor: DocumentEditor): string =>
  (flattenSfdt(JSON.parse(editor.serialize())) as any[])
    .map((b) => String(b.text ?? ''))
    .join(' ');

const textOf = documentText;

const wordBag = (editor: DocumentEditor): string[] =>
  documentText(editor)
    .split(/\s+/)
    .filter(Boolean)
    .sort();

describe('what a relocation anchor may name', () => {
  let editor: DocumentEditor;
  afterEach(() => {
    if (!editor) return;
    const element = editor.element;
    editor.destroy();
    element?.remove();
  });

  const open = () => {
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
    editor.open(JSON.stringify(doc()));
    return editor as unknown as LiveEditor;
  };

  const anchors = () => {
    const blocks = flattenSfdt(JSON.parse(editor.serialize())) as any[];
    const heads = blocks.filter((b) => b.isHeading);
    const emptyTrailing = blocks.find(
      (b) => !b.isHeading && !String(b.text ?? '').trim()
    );
    return { blocks, heads, emptyTrailing };
  };

  it('a section moved by its HEADING conserves every word', () => {
    const live = open();
    const before = wordBag(editor);
    const { heads } = anchors();

    const result: any = applyDocumentEdits(live, {
      changeSetId: 'move-by-heading',
      edits: [
        {
          op: 'move_section',
          anchor: heads[heads.length - 1].anchor,
          targetAnchor: heads[0].anchor,
          position: 'before',
          group: 'g'
        } as any
      ]
    });

    expect(result.results[0].ok).toBe(true);
    // Moving is not retyping: the same words, reordered.
    expect(wordBag(editor)).toEqual(before);
  });

  it('an anchor with no heading after it must not swallow the document', () => {
    // The measured failure shape. `level` for a non-heading is +Infinity, so the
    // scan for the next heading at-or-above that level finds nothing, and the
    // range runs to the last block. A move of "this empty paragraph" then
    // relocates everything after it.
    //
    // Either answer is acceptable and both are honest: refuse, because an
    // anchor that names no section unit cannot name a section move; or resolve
    // it to something bounded. What is NOT acceptable is relocating the rest of
    // the document, or changing the document while reporting a refusal.
    const live = open();
    const before = wordBag(editor);
    const beforeText = textOf(editor);
    const { emptyTrailing, heads } = anchors();
    expect(emptyTrailing).toBeDefined();

    const result: any = applyDocumentEdits(live, {
      changeSetId: 'move-by-empty-paragraph',
      edits: [
        {
          op: 'move_section',
          anchor: emptyTrailing.anchor,
          targetAnchor: heads[0].anchor,
          position: 'before',
          group: 'g'
        } as any
      ]
    });

    // eslint-disable-next-line no-console
    console.log(
      `[relocation anchor] ok=${result.results?.[0]?.ok} ` +
        `error=${result.results?.[0]?.error ?? 'none'} ` +
        `wordsConserved=${JSON.stringify(wordBag(editor)) === JSON.stringify(before)} ` +
        `unchanged=${textOf(editor) === beforeText}`
    );

    if (!result.results[0].ok) {
      // A refusal must leave the document exactly as it was.
      expect(textOf(editor)).toBe(beforeText);
      return;
    }
    // If it is allowed, it is still a move: nothing may be lost.
    expect(wordBag(editor)).toEqual(before);
  });
});
