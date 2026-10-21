// In-page bridge for the version history headless lane
import { registerLicense } from '@syncfusion/ej2-base';
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
  attachBindings,
  AttachedBindings
} from '../../../bindings/attachBindings';
import { SyncfusionEditorLike } from '../../../bindings/editorAdapter';
import { installRevisionHighlightRendering } from '../../../useDocxEditor';
import { colorForRevisionAuthor } from '../../authorColors';
import { versionPreviewHarness } from './versionPreviewHarness';
import { historyReviewHarness } from './historyReviewHarness';

declare const __SYNCFUSION_LICENSE_KEY__: string;

if (__SYNCFUSION_LICENSE_KEY__) registerLicense(__SYNCFUSION_LICENSE_KEY__);

DocumentEditor.Inject(
  Editor,
  Selection,
  SfdtExport,
  EditorHistory,
  ImageResizer,
  Search
);

let editor: DocumentEditor | null = null;
let attached: AttachedBindings | null = null;

const live = (): DocumentEditor => {
  if (!editor) throw new Error('no document is open - call open() first');
  return editor;
};

// Headless Chrome can withhold animation frames, so keep the timer fallback
const frame = (): Promise<void> =>
  new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 50);
  });

const api = {
  ...versionPreviewHarness,
  ...historyReviewHarness,
  async open(sfdt: string): Promise<void> {
    api.close();
    const host = document.createElement('div');
    host.id = 'fm-editor';
    host.style.width = '900px';
    host.style.height = '700px';
    document.body.appendChild(host);
    const instance = new DocumentEditor({
      isReadOnly: false,
      enableEditor: true,
      enableSelection: true,
      enableImageResizer: true,
      enableSearch: true,
      enableSfdtExport: true,
      enableEditorHistory: true,
      documentEditorSettings: { optimizeSfdt: false }
    });
    instance.appendTo(host);
    instance.open(sfdt);
    editor = instance;
    await frame();
    await frame();
    attached = attachBindings(instance as unknown as SyncfusionEditorLike, {
      convertTokensOnOpen: false
    });
    await frame();
  },

  close(): void {
    try {
      attached?.dispose();
    } finally {
      attached = null;
      const element = editor?.element;
      editor?.destroy();
      element?.remove();
      editor = null;
    }
  },

  serialize: (): string => live().serialize(),

  async verifyHistoryRenderer(): Promise<boolean> {
    const instance = live() as any;
    installRevisionHighlightRendering(instance, colorForRevisionAuthor);
    const renderer = instance.documentHelper.render;
    const check = renderer.checkRevisionType;
    instance.showRevisions = true;
    instance.resize();
    await frame();
    await frame();
    return renderer.checkRevisionType === check;
  },

  async observeHistoryEdit(text: string): Promise<string[]> {
    const snapshots: string[] = [];
    const instance = live();
    const changed = () => snapshots.push(instance.serialize());
    instance.addEventListener('contentChange', changed);
    try {
      instance.selection.moveToDocumentEnd();
      instance.editor.insertText(text);
      await frame();
      return snapshots;
    } finally {
      instance.removeEventListener('contentChange', changed);
    }
  }
};

(window as any).fmHistory = api;
(window as any).fmHistoryReady = true;
