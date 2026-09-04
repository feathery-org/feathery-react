/**
 * A trailing number is not proof of being a copy.
 *
 * `documentFieldIdentity` recognises a section copy by stripping `_<digits>`
 * from the end of a name, because that is how `uniqueBindingName` spells a
 * copy. But that spelling is not reserved: a template author can write
 * `revenue_2024`, `q_1`, `plan_2026` for reasons that have nothing to do with
 * copying. Stripping the digits makes `revenue_2024` claim membership in
 * `revenue`'s family, so a write to one offers the other as an instance of
 * itself - and a `choice:"all"` confirmation then fans that write onto a field
 * the user never named.
 *
 * Reconstructing provenance from the shape of a name can only ever guess.
 * Whether a binding is a copy is a fact known at the moment it is made.
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
  applyDocumentEdits,
  flattenSfdt,
  LiveEditor
} from '../syncfusionDocumentOps';
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

const P = (text: string) => ({
  paragraphFormat: {},
  characterFormat: {},
  inlines: [{ characterFormat: {}, text }]
});

/** Two unrelated fields; one of them simply ends in a year. */
const YEARLY = {
  sections: [
    {
      sectionFormat: { pageWidth: 612, pageHeight: 792 },
      blocks: [
        P('Report'),
        P('Revenue [[name=revenue|default=100]].'),
        P('Revenue for 2024 was [[name=revenue_2024|default=90]].')
      ]
    }
  ]
};

describe('a field whose name ends in a number it chose itself', () => {
  let editor: DocumentEditor;
  afterEach(() => {
    if (!editor) return;
    const element = editor.element;
    editor.destroy();
    element?.remove();
  });

  it('is not treated as a copy of a shorter field', () => {
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
    editor.open(JSON.stringify(YEARLY));
    attachBindings(editor as unknown as SyncfusionEditorLike, {
      convertTokensOnOpen: true
    });

    const blocks = flattenSfdt(JSON.parse(editor.serialize())) as any[];
    const target = blocks.find((block) =>
      String(block.text ?? '').startsWith('Revenue ')
    );
    expect(target).toBeDefined();

    const result: any = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'write-revenue',
      edits: [
        {
          op: 'set_cell_text',
          anchor: target.anchor,
          text: '150',
          literal: true,
          group: 'g'
        } as any
      ]
    });

    const payload = JSON.stringify(result.results[0]);
    // `revenue_2024` is a different field. It must never be offered as another
    // instance of `revenue`.
    expect(payload).not.toContain('revenue_2024');
  });
});

/**
 * The other half of the same rule: a binding that IS a copy must still be
 * recognised as one, which is the behaviour the review asked for. Fixing the
 * false family must not cost the true one.
 */
describe('a field that really is a copy', () => {
  let editor: DocumentEditor;
  afterEach(() => {
    if (!editor) return;
    const element = editor.element;
    editor.destroy();
    element?.remove();
  });

  const H = (text: string) => ({
    paragraphFormat: { outlineLevel: 'Level1', styleName: 'Heading 1' },
    characterFormat: {},
    inlines: [{ characterFormat: {}, text }]
  });

  const COPYABLE = {
    sections: [
      {
        sectionFormat: { pageWidth: 612, pageHeight: 792 },
        blocks: [
          H('Client Details'),
          P('Client [[name=client.name|default=Acme Corporation]] is billed.'),
          H('Notes'),
          P('End of quote.')
        ]
      }
    ]
  };

  it('is offered as an instance of the field it came from', () => {
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
    editor.open(JSON.stringify(COPYABLE));
    attachBindings(editor as unknown as SyncfusionEditorLike, {
      convertTokensOnOpen: true
    });

    const tops = () =>
      (flattenSfdt(JSON.parse(editor.serialize())) as any[]).filter(
        (block) => block.anchor.split(';').length === 2
      );
    const before = tops();
    const copy: any = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'copy-client-details',
      edits: [
        {
          op: 'copy_section',
          anchor: before[0].anchor,
          targetAnchor: before[before.length - 1].anchor,
          position: 'after',
          group: 'g'
        } as any
      ]
    });
    expect(copy.results[0]).toMatchObject({ ok: true });

    // The copy carries its provenance in the document itself.
    expect(editor.serialize()).toContain('copyOf');

    const target = (flattenSfdt(JSON.parse(editor.serialize())) as any[]).find(
      (block) => String(block.text ?? '').includes('is billed')
    );
    expect(target).toBeDefined();
    const result: any = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'write-client-name',
      edits: [
        {
          op: 'set_cell_text',
          anchor: target.anchor,
          text: 'Globex Industries',
          literal: true,
          group: 'g'
        } as any
      ]
    });

    // Two instances of ONE family, so the user is asked which - rather than one
    // being silently picked.
    expect(result.results[0].ok).toBe(false);
    expect(result.results[0].ambiguity?.instanceCount).toBe(2);
  });
});
