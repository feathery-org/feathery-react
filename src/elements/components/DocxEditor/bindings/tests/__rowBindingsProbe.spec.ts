import 'jest-canvas-mock';
import {
  DocumentEditor, Editor, EditorHistory, Search, Selection, SfdtExport
} from '@syncfusion/ej2-documenteditor';
import { attachBindings } from '../attachBindings';
import { SyncfusionEditorLike } from '../editorAdapter';
import { scanBindings } from '../core/sfdtAdapter';
import { SfdtDocument } from '../core/sfdtTypes';
import { buildCostsFixture } from '../core/tests/fixtures/costsFixture';

DocumentEditor.Inject(Editor, Selection, SfdtExport, EditorHistory, Search);
if (!window.crypto?.getRandomValues) Object.defineProperty(window, 'crypto', { value: { getRandomValues: (a: Uint8Array) => require('crypto').randomFillSync(a) } });
if (!(window.SVGElement.prototype as any).getBBox) (window.SVGElement.prototype as any).getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });

const state = (editor: DocumentEditor, label: string) => {
  const index = scanBindings(JSON.parse(editor.serialize()) as SfdtDocument);
  const names = ['costs_subtotal', 'costs_tax', 'grand_total', 'combined_total'];
  console.log(label, '| formulas:', names.map((n) => `${n}=${index.formulas.has(n)}`).join(' '),
    '| stack:', ((editor as any).editorHistoryModule?.undoStack ?? []).map((e: any) => e.action).join(','));
};

it('probe: row delete + single-gesture undo WITH bindings attached', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = new DocumentEditor({ isReadOnly: false, enableEditor: true, enableSelection: true, enableSfdtExport: true, enableEditorHistory: true, documentEditorSettings: { optimizeSfdt: false } });
  editor.appendTo(host);
  editor.open(JSON.stringify(buildCostsFixture()));
  const attached = attachBindings(editor as unknown as SyncfusionEditorLike, {
    confirmTableDelete: () => Promise.resolve(true)
  });
  state(editor, 'ATTACHED');
  const c = ((editor as any).documentHelper.contentControlCollection as any[]).find((e) => String(e.contentControlProperties?.tag || '').includes('costs_subtotal'));
  (editor.selection as any).selectContentControlInternal(c);
  (editor as any).editorModule.deleteRow();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  state(editor, 'AFTER DELETE');
  // the user moves the caret before undoing: commit trigger reconcile
  attached.controller.flush();
  state(editor, 'AFTER COMMIT FLUSH');
  const history = (editor as any).editorHistoryModule;
  history.undo();
  state(editor, 'AFTER 1 UNDO GESTURE');
  attached.controller.flush();
  state(editor, 'AFTER POST-UNDO FLUSH');
  attached.dispose();
});
