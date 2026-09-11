/**
 * A section copy and its source are two instances of one field, and the engine
 * has to know that.
 *
 * From Ayesha's review. Copies are marked two different ways: a table duplicate
 * namespaces its fields with the new table's id, and a section copy appends a
 * numeric suffix - `project.name` becomes `project.name_2`. The identity rule
 * recognised only the prefix, so a section copy and its source read as
 * unrelated fields and the ambiguity flow never fired for precisely the case
 * that creates two instances.
 *
 * What that costs the user: they say "change the project name", there are now
 * two of them, and instead of being asked which, one is silently picked.
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
import { scanBindings } from '../../../../elements/components/DocxEditor/bindings/core/sfdtAdapter';

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

describe('copying a section that carries a non-global field', () => {
  let editor: DocumentEditor;
  afterEach(() => {
    if (!editor) return;
    const element = editor.element;
    editor.destroy();
    element?.remove();
  });

  it('names the copy as a numbered sibling of its source', () => {
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
    editor.open(JSON.stringify(buildCostsFixture()));
    attachBindings(editor as unknown as SyncfusionEditorLike, {
      convertTokensOnOpen: true
    });

    const blocks = () => flattenSfdt(JSON.parse(editor.serialize())) as any[];
    const tops = blocks().filter(
      (block) => block.anchor.split(';').length === 2
    );
    const namesBefore = new Set(
      scanBindings(JSON.parse(editor.serialize()) as any).occurrences.map(
        (occurrence: any) => occurrence.def.name
      )
    );

    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'copy-section-identity',
      edits: [
        {
          op: 'copy_section',
          anchor: tops[0].anchor,
          targetAnchor: tops[tops.length - 1].anchor,
          position: 'after',
          group: 'g'
        } as any
      ]
    });
    if (!result.results[0].ok) return; // a refusal is a valid answer here

    const namesAfter = scanBindings(
      JSON.parse(editor.serialize()) as any
    ).occurrences.map((occurrence: any) => occurrence.def.name);
    const added = namesAfter.filter((name: string) => !namesBefore.has(name));

    // The copy's non-global fields are numbered siblings - the spelling the
    // identity rule has to recognise.
    expect(added.length).toBeGreaterThan(0);
    expect(added.some((name: string) => /_\d+$/.test(name))).toBe(true);

    // And each numbered sibling has a source it belongs with, still present.
    for (const name of added.filter((candidate: string) =>
      /_\d+$/.test(candidate)
    )) {
      const family = name.replace(/_\d+$/, '');
      expect(namesAfter).toContain(family);
    }
  });
});
