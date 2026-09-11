/**
 * Duplicating a table copies the TABLE, not everything its container holds.
 *
 * From Ayesha's review. A content control can wrap a table together with
 * sibling paragraphs - a caption, a note, a spacer - and duplication cloned the
 * whole container, so those siblings were duplicated too. It reported success,
 * because the read-back afterwards verifies the table's own blocks and never
 * looks at what else came along for the ride.
 *
 * The user sees a second copy of a caption they never asked to duplicate, in a
 * change card that says a table was duplicated.
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
import { buildCostsFixture } from '../../../../elements/components/DocxEditor/bindings/core/tests/fixtures/costsFixture';
import { attachBindings } from '../../../../elements/components/DocxEditor/bindings/attachBindings';
import { SyncfusionEditorLike } from '../../../../elements/components/DocxEditor/bindings/editorAdapter';

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

const CAPTION = 'Figures are indicative only.';

/**
 * The real bound fixture with ONE change: a caption paragraph added inside the
 * same content control that wraps the costs table.
 */
function fixtureWithCaptionInsideWrapper(): any {
  const doc: any = buildCostsFixture();
  const wrapper = doc.sections[0].blocks.find(
    (block: any) => block.contentControlProperties && Array.isArray(block.blocks)
  );
  if (!wrapper) throw new Error('fixture no longer wraps its table');
  wrapper.blocks.push({
    paragraphFormat: { afterSpacing: 8 },
    characterFormat: {},
    inlines: [{ characterFormat: {}, text: CAPTION }]
  });
  return doc;
}

const occurrences = (editor: DocumentEditor, needle: string): number => {
  let count = 0;
  const walk = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node.text === 'string' && node.text.includes(needle)) count++;
    Object.values(node).forEach(walk);
  };
  walk(JSON.parse(editor.serialize()));
  return count;
};

describe('duplicating a table whose wrapper also holds a caption', () => {
  let editor: DocumentEditor;
  afterEach(() => {
    if (!editor) return;
    const element = editor.element;
    editor.destroy();
    element?.remove();
  });

  it('copies the table and leaves the caption alone', () => {
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
      documentEditorSettings: { optimizeSfdt: false }
    });
    editor.appendTo(host);
    editor.open(JSON.stringify(fixtureWithCaptionInsideWrapper()));
    attachBindings(editor as unknown as SyncfusionEditorLike, {
      convertTokensOnOpen: true
    });

    expect(occurrences(editor, CAPTION)).toBe(1);
    const tablesBefore = new Set(
      (flattenSfdt(JSON.parse(editor.serialize())) as any[])
        .filter((block) => block.kind === 'table_cell')
        .map((block) => block.anchor.split(';').slice(0, 2).join(';'))
    ).size;

    const anchor = (flattenSfdt(JSON.parse(editor.serialize())) as any[]).find(
      (block) => block.kind === 'table_cell'
    ).anchor;

    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'duplicate-wrapped-table',
      edits: [{ op: 'duplicate_table', anchor, group: 'g' } as any]
    });

    expect(result.results[0]).toMatchObject({ ok: true });

    // A table was duplicated...
    const tablesAfter = new Set(
      (flattenSfdt(JSON.parse(editor.serialize())) as any[])
        .filter((block) => block.kind === 'table_cell')
        .map((block) => block.anchor.split(';').slice(0, 2).join(';'))
    ).size;
    expect(tablesAfter).toBe(tablesBefore + 1);

    // ...and nothing else was. The caption shares a container with the table,
    // which is not the same as being part of it.
    expect(occurrences(editor, CAPTION)).toBe(1);
  });
});
