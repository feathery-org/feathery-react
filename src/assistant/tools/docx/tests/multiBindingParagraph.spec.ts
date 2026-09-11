/**
 * A sentence may carry more than one bound value, and both must be reachable.
 *
 * Word lets any number of inline content controls sit in one paragraph, so a
 * template writes prose like "Effective [[policy.date]], quoted at
 * [[tax_rate]] tax." The reader collected every binding range in the block and
 * then reported only the first, so the second bound value was invisible to the
 * model and unaddressable by any write: asked to change the tax rate, the only
 * op left was a plain text replace, which the engine correctly refuses because
 * it would write across a content control it cannot see.
 *
 * The refusal even named the wrong field - `policy.date` - for a tax edit,
 * because routing resolved the block's single first tag rather than the
 * binding the write actually targeted.
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
  getDocumentInventory,
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

const P = (text: string, heading?: boolean) => ({
  paragraphFormat: heading
    ? { outlineLevel: 'Level1', styleName: 'Heading 1' }
    : {},
  characterFormat: {},
  inlines: [{ characterFormat: {}, text }]
});

/** One sentence, two bindings - the shape a real template writes. */
const TWO_IN_ONE_SENTENCE = {
  sections: [
    {
      sectionFormat: { pageWidth: 612, pageHeight: 792 },
      blocks: [
        P('Quote'),
        P(
          'Effective [[name=policy.date|type=date|default=2026-09-01]], quoted at [[name=tax_rate|type=percent|global=true|default=8.5]] tax.'
        )
      ]
    }
  ]
};

describe('a paragraph carrying two bound values', () => {
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
      documentEditorSettings: { optimizeSfdt: false }
    });
    editor.appendTo(host);
    editor.open(JSON.stringify(TWO_IN_ONE_SENTENCE));
    attachBindings(editor as unknown as SyncfusionEditorLike, {
      convertTokensOnOpen: true
    });
  };

  it('finds both binding ranges in the block', () => {
    open();
    const blocks = flattenSfdt(JSON.parse(editor.serialize())) as any[];
    const prose = blocks.find((block) =>
      String(block.text ?? '').includes('quoted at')
    );
    expect(prose).toBeDefined();
    const tags = (prose.bindingRanges ?? []).map((range: any) => range.tag);
    // The engine already collects both; this is the ground truth the reader
    // has available and was discarding.
    expect(tags.join(' ')).toContain('policy.date');
    expect(tags.join(' ')).toContain('tax_rate');
  });

  it('reports both bound values to the model', () => {
    open();
    const inventory: any = getDocumentInventory(
      editor as unknown as LiveEditor,
      { scope: 'full' } as any
    );
    const entries: any[] = inventory.inventory ?? [];
    const prose = entries.find((entry) =>
      String(entry.text ?? '').includes('quoted at')
    );
    expect(prose).toBeDefined();
    const named = JSON.stringify(prose);
    // A bound value the model cannot see is a bound value it cannot change.
    expect(named).toContain('policy.date');
    expect(named).toContain('tax_rate');
  });
});

/**
 * The headline of the binding PR: `global=true` means one document-wide
 * identity, so copying the section that carries it must NOT mint a second
 * one - while a plain field in the same copied section MUST become a numbered
 * sibling, because those are two separate instances.
 *
 * The two halves are one rule seen from both sides, and testing only one half
 * would let the other regress silently.
 */
describe('copying a section that carries a global and a plain binding', () => {
  let editor: DocumentEditor;
  afterEach(() => {
    if (!editor) return;
    const element = editor.element;
    editor.destroy();
    element?.remove();
  });

  const MIXED = {
    sections: [
      {
        sectionFormat: { pageWidth: 612, pageHeight: 792 },
        blocks: [
          // Two heading-delimited units, so the copy has a destination
          // OUTSIDE the section it is copying.
          P('Client Details', true),
          P(
            'Client [[name=client.name|default=Acme Corporation]] is billed at [[name=tax_rate|type=percent|global=true|default=8.5]] tax.'
          ),
          P('Notes', true),
          P('End of quote.')
        ]
      }
    ]
  };

  const factsFor = (field: string) => {
    const inventory: any = getDocumentInventory(
      editor as unknown as LiveEditor,
      { scope: 'full' } as any
    );
    return (inventory.inventory ?? []).flatMap((entry: any) =>
      (entry.bindings ?? []).filter((fact: any) =>
        fact.field.replace(/_\d+$/, '') === field
      )
    );
  };

  it('keeps one global identity and numbers the plain field', () => {
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
    editor.open(JSON.stringify(MIXED));
    attachBindings(editor as unknown as SyncfusionEditorLike, {
      convertTokensOnOpen: true
    });

    expect(factsFor('tax_rate')).toHaveLength(1);
    expect(factsFor('client.name')).toHaveLength(1);

    const tops = (flattenSfdt(JSON.parse(editor.serialize())) as any[]).filter(
      (block) => block.anchor.split(';').length === 2
    );
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'copy-global-section',
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
    expect(result.results[0]).toMatchObject({ ok: true });

    const globals = factsFor('tax_rate');
    const plains = factsFor('client.name');
    expect(globals).toHaveLength(2);
    expect(plains).toHaveLength(2);
    // The global keeps ONE identity no matter how many controls show it.
    expect(new Set(globals.map((fact: any) => fact.identity.id)).size).toBe(1);
    expect(globals.every((fact: any) => fact.identity.global)).toBe(true);

    // The plain field gets a distinct identity per instance.
    expect(new Set(plains.map((fact: any) => fact.identity.id)).size).toBe(
      plains.length
    );
  });
});
