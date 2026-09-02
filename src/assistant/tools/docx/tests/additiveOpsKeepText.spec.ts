/**
 * An op that ADDS something must not destroy what was already there.
 *
 * This started as one defect and turned out to be a class. SyncFusion splits
 * its editor calls three ways by how they treat the current selection:
 *
 *   consuming   - replaces the selection's content (insertHyperlink,
 *                 insertPageNumber, insertText, paste, the breaks)
 *   annotating  - attaches something to it, content preserved (insertBookmark,
 *                 insertComment, formatting, removeHyperlink)
 *   locating    - the selection only picks an object (insertRow)
 *
 * The bug is the product of three things: an ADDITIVE op, a CONSUMING call, and
 * a selection wider than a caret. `insert_hyperlink` and `insert_page_number`
 * were both selecting the whole paragraph before a consuming call, so "add a
 * link to this line" deleted the line and reported success - confirmed in a
 * real browser, not only in jsdom, where a document's title
 * "Acme Insurance Proposal" was replaced by the link.
 *
 * `insert_section_break` made no selection call at all and inherited whatever
 * the dispatcher had left selected. The SDK happens not to consume there, so
 * nothing was lost, but the op's correctness rested on the SDK's behaviour
 * rather than on its own intent.
 *
 * The conservation gate is deliberately left ARMED for these cases: an additive
 * op has to be both non-destructive and reversible, and the two are different
 * claims.
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
import { applyDocumentEdits, LiveEditor } from '../syncfusionDocumentOps';

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

const TITLE = 'Project cost estimate';
const SECOND = 'Prepared for Acme Corp.';

const doc = () => ({
  sections: [
    {
      sectionFormat: { pageWidth: 612, pageHeight: 792 },
      blocks: [
        {
          paragraphFormat: {},
          characterFormat: {},
          inlines: [{ characterFormat: {}, text: TITLE }]
        },
        {
          paragraphFormat: {},
          characterFormat: {},
          inlines: [{ characterFormat: {}, text: SECOND }]
        }
      ]
    }
  ]
});

const textOf = (editor: DocumentEditor): string => {
  const parsed = JSON.parse(editor.serialize());
  let text = '';
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node.text === 'string') text += node.text;
    Object.values(node).forEach(walk);
  };
  walk(parsed);
  return text;
};

describe('additive ops leave the anchored paragraph intact', () => {
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

  const cases: { op: string; edit: Record<string, unknown> }[] = [
    {
      op: 'insert_hyperlink',
      edit: { address: 'https://example.com', displayText: 'link' }
    },
    { op: 'insert_page_number', edit: {} },
    { op: 'insert_section_break', edit: {} }
  ];

  it.each(cases)('$op keeps the text that was already there', ({ op, edit }) => {
    const live = open();
    const before = textOf(editor);
    expect(before).toContain(TITLE);

    const result: any = applyDocumentEdits(live, {
      changeSetId: `additive-${op}`,
      edits: [{ op, anchor: '0;0', group: 'g', ...edit } as any]
    });

    expect(result.results[0].ok).toBe(true);
    const after = textOf(editor);

    // The anchored paragraph's own text, and its neighbour, both survive: an
    // addition that eats the next paragraph is no better than one that eats
    // this paragraph.
    expect(after).toContain(TITLE);
    expect(after).toContain(SECOND);
  });

  it('puts the link where it is asked to, without eating anything', () => {
    // The positioning convention is shared with insert_text rather than
    // invented here, so an explicit position must actually be honoured.
    const live = open();
    const result: any = applyDocumentEdits(live, {
      changeSetId: 'hyperlink-at-end',
      edits: [
        {
          op: 'insert_hyperlink',
          anchor: '0;0',
          address: 'https://example.com',
          displayText: 'link',
          position: 'end',
          group: 'g'
        } as any
      ]
    });
    expect(result.results[0].ok).toBe(true);
    const after = textOf(editor);
    expect(after).toContain(TITLE);
    expect(after.indexOf(TITLE)).toBeLessThan(after.indexOf('HYPERLINK'));
  });
});
