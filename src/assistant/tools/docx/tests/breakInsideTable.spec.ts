/**
 * A break inside a table cell is not a change the user can reject.
 *
 * Found by the conservation gate and confirmed with a control: at an ordinary
 * paragraph SyncFusion authors Insertion revisions for a page break and
 * rejecting them restores the document, but at a TABLE ROW it authors none at
 * all. So the break survived its own rejection - a page break left a stray
 * empty element inside the table, and a section break left the document split
 * in two. The user rejects the change card and the document does not come
 * back, which is the one promise tracked changes make.
 *
 * The guard PREVENTS rather than detects, and that distinction is the point.
 * An earlier attempt added these ops to the after-the-write structural
 * assertion, which duly refused - over a document it had already changed,
 * because the rollback rejects revisions and an untracked write has none. It
 * reported "nothing was written" while the stray element sat in the table. A
 * refusal that lies is worse than the silent success it replaced.
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

const cell = (text: string) => ({
  blocks: [{ inlines: [{ text }] }],
  cellFormat: {}
});

const withTable = () => ({
  sections: [
    {
      sectionFormat: { pageWidth: 612, pageHeight: 792 },
      blocks: [
        { inlines: [{ text: 'Intro' }] },
        {
          tableFormat: {},
          rows: Array.from({ length: 3 }, (_, index) => ({
            rowFormat: {},
            cells: [cell(`Line ${index}`), cell(`Carrier ${index}`)]
          }))
        }
      ]
    }
  ]
});

describe('a break addressed inside a table cell', () => {
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
    editor.open(JSON.stringify(withTable()));
    return editor as unknown as LiveEditor;
  };

  const textOf = () => {
    const out: string[] = [];
    const walk = (node: any): void => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node.text === 'string') out.push(node.text);
      Object.values(node).forEach(walk);
    };
    walk(JSON.parse(editor.serialize()));
    return out.join('|');
  };
  const sections = () => JSON.parse(editor.serialize()).sections.length;

  it.each([
    ['insert_page_break', { op: 'insert_page_break' }],
    [
      'insert_section_break',
      { op: 'insert_section_break', sectionBreakType: 'NewPage' }
    ]
  ])('refuses %s without touching the document', (_name, partial) => {
    const live = open();
    const before = textOf();
    const sectionsBefore = sections();

    const result: any = applyDocumentEdits(live, {
      changeSetId: 'break-in-cell',
      edits: [{ ...(partial as any), anchor: '0;1;1;0;0', group: 'g' } as any]
    });

    expect(result.results[0]).toMatchObject({
      ok: false,
      error: 'break_inside_table_not_rejectable'
    });
    // "Nothing was written" has to be TRUE, not just said.
    expect(textOf()).toBe(before);
    expect(sections()).toBe(sectionsBefore);
    expect(
      (result.warnings ?? []).filter((warning: string) =>
        warning.startsWith('conservation_leak')
      )
    ).toEqual([]);
  });

  it('still allows a break at an ordinary body paragraph', () => {
    // The guard must cost the capability only where it cannot be honoured.
    const live = open();
    const result: any = applyDocumentEdits(live, {
      changeSetId: 'break-in-body',
      edits: [{ op: 'insert_page_break', anchor: '0;0', group: 'g' } as any]
    });
    expect(result.results[0].error).not.toBe(
      'break_inside_table_not_rejectable'
    );
  });
});
