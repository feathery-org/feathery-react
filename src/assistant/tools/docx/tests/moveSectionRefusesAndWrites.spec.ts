/**
 * KNOWN DEFECT, pinned: move_section REFUSES and writes anyway.
 *
 * A refusal is a promise that nothing was written. These rows measure that
 * promise being broken on the bound relocation route, on the vendored
 * mirrored-bindings shape, with the binding engine attached as the product
 * attaches it.
 *
 * Every case below reports `ok: false` - so the model is told the edit did not
 * happen - while the document is left larger, with revisions in it, and with
 * its binding tags either destroyed or DUPLICATED. Duplicated identities are
 * the worse half: two content controls claiming the same field is a corruption
 * a reviewer cannot see and a later write resolves arbitrarily.
 *
 * These are asserted AS THE DEFECT. When it is fixed they fail, and that
 * failure is the signal to rewrite them as the requirement: a refusal leaves
 * the document byte-identical.
 *
 * Filed as `move-section-refuses-and-writes`. Not fixed here: the cause sits in
 * the relocation route's anchor handling, which is the subject of the footprint
 * contract the composer work is landing, and `relocation_source_lost` in the
 * first case is that exact anchor-drift failure surfacing as an error.
 */
import 'jest-canvas-mock';
import * as fs from 'fs';
import * as path from 'path';
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
import { attachBindings } from '../../../../elements/components/DocxEditor/bindings/attachBindings';
import { SyncfusionEditorLike } from '../../../../elements/components/DocxEditor/bindings/editorAdapter';

DocumentEditor.Inject(
  Editor,
  Selection,
  SfdtExport,
  EditorHistory,
  ImageResizer,
  Search
);
if (!window.crypto?.getRandomValues)
  Object.defineProperty(window, 'crypto', {
    value: {
      getRandomValues: (a: Uint8Array) => require('crypto').randomFillSync(a)
    }
  });
if (!(window.SVGElement.prototype as any).getBBox)
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);

const tagsIn = (s: string) =>
  [...s.matchAll(/\[\[[^\]]*\]\]/g)].map((m) => m[0]);

const runMove = (anchor: string, target: string) => {
  const raw = fs.readFileSync(
    path.join(__dirname, 'corpus', 'mirrored-bindings.sfdt.json'),
    'utf8'
  );
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '700px';
  document.body.appendChild(host);
  const editor = new DocumentEditor({
    isReadOnly: false,
    enableEditor: true,
    enableSelection: true,
    enableSfdtExport: true,
    enableEditorHistory: true,
    enableSearch: true,
    documentEditorSettings: { optimizeSfdt: false }
  });
  editor.appendTo(host);
  editor.open(raw);
  const attached = attachBindings(editor as unknown as SyncfusionEditorLike, {
    convertTokensOnOpen: false
  });
  const before = editor.serialize();
  const result = (
    applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'refuses-and-writes',
      edits: [
        {
          op: 'move_section',
          anchor,
          targetAnchor: target,
          position: 'before',
          group: 'g'
        } as any
      ]
    }) as any
  ).results[0];
  const after = editor.serialize();
  attached.dispose();
  return {
    ok: result.ok,
    error: result.error,
    changed: after !== before,
    grewBy: after.length - before.length,
    tagsBefore: tagsIn(before).length,
    tagsAfter: tagsIn(after).length
  };
};

describe('KNOWN DEFECT: move_section refuses and writes anyway', () => {
  it('DUPLICATES binding tags while reporting the move did not happen', () => {
    // The worst of the three. Nine extra content controls appear, so nine field
    // identities now exist twice in a document the model was told was untouched.
    const r = runMove('0;1', '0;5');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('relocation_source_lost');
    expect(r.changed).toBe(true);
    expect(r.grewBy).toBeGreaterThan(40000);
    expect(r.tagsAfter).toBeGreaterThan(r.tagsBefore);
  });

  it('DESTROYS a binding tag while reporting the move did not happen', () => {
    const r = runMove('0;0', '0;5');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('untracked_write');
    expect(r.changed).toBe(true);
    expect(r.tagsAfter).toBe(r.tagsBefore - 1);
  });

  it('writes even on the smallest refusing move', () => {
    // Included so the defect is not read as "only huge moves are affected".
    const r = runMove('0;3', '0;0');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('untracked_write');
    expect(r.changed).toBe(true);
    expect(r.tagsAfter).toBe(r.tagsBefore - 1);
  });
});
