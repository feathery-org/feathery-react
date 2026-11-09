// In-page bridge for the inline content-control exporter-stack lane: the product's container
// editor (every module the product injects) with the bindings optionally attached. Test-only.
import { registerLicense } from '@syncfusion/ej2-base';
import {
  DocumentEditor,
  DocumentEditorContainer,
  Toolbar
} from '@syncfusion/ej2-documenteditor';
import {
  attachBindings,
  AttachedBindings
} from '../../bindings/attachBindings';
import { SyncfusionEditorLike } from '../../bindings/editorAdapter';
import { installExportContentControlRecovery } from '../../../../../utils/documentEditorPrimitives';

declare const __SYNCFUSION_LICENSE_KEY__: string;
if (__SYNCFUSION_LICENSE_KEY__) registerLicense(__SYNCFUSION_LICENSE_KEY__);

DocumentEditorContainer.Inject(Toolbar);

let container: DocumentEditorContainer | null = null;
let attached: AttachedBindings | null = null;
const errors: string[] = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));

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

const live = (): DocumentEditor => {
  const ed = container?.documentEditor;
  if (!ed) throw new Error('no document is open');
  return ed;
};

const api = {
  async open(
    sfdt: string,
    options: { bindings?: boolean; recovery?: boolean } = {}
  ): Promise<void> {
    try {
      attached?.dispose();
    } catch {
      // nothing to release
    }
    attached = null;
    container?.destroy();
    document.getElementById('cc-editor')?.remove();
    const host = document.createElement('div');
    host.id = 'cc-editor';
    host.style.width = '900px';
    host.style.height = '700px';
    document.body.appendChild(host);
    container = new DocumentEditorContainer({
      enableToolbar: false,
      showPropertiesPane: false,
      serviceUrl: '',
      height: '100%',
      documentEditorSettings: { optimizeSfdt: false }
    });
    await new Promise<void>((resolve) => {
      container!.addEventListener('created', () => resolve());
      container!.appendTo(host);
    });
    const ed = live();
    if (options.recovery) installExportContentControlRecovery(ed as any);
    ed.open(sfdt);
    await frame();
    await frame();
    if (options.bindings) {
      attached = attachBindings(ed as unknown as SyncfusionEditorLike, {
        convertTokensOnOpen: false
      });
      await frame();
    }
  },
  frame,
  serialize: () => live().serialize(),
  pageCount: () => (live() as any).pageCount as number,
  pushStale: () =>
    (live() as any).sfdtExportModule.inlineContentControls.push({
      inlines: [],
      props: { type: 'Text', title: 'stale', tag: 'stale' }
    }),
  async docx(): Promise<number> {
    const blob: Blob = await (live() as any).saveAsBlob('Docx');
    return blob.size;
  },
  /** Serialize twice (the second read is what a save after a save sees), then summarize the output. */
  probe() {
    const ed = live() as any;
    ed.serialize();
    const out = JSON.parse(ed.serialize());
    let paragraphs = 0;
    let hollow = 0;
    let tables = 0;
    let ccs = 0;
    let text = '';
    const walkInlines = (inlines: any[]) => {
      for (const i of inlines ?? []) {
        if (typeof i.text === 'string') text += i.text;
        if (i.contentControlProperties) ccs++;
        if (Array.isArray(i.inlines)) walkInlines(i.inlines);
      }
    };
    const walkBlocks = (blocks: any[]) => {
      for (const b of blocks ?? []) {
        if (Array.isArray(b.rows)) {
          tables++;
          for (const r of b.rows) for (const c of r.cells) walkBlocks(c.blocks);
        } else if (Array.isArray(b.blocks)) walkBlocks(b.blocks);
        else {
          paragraphs++;
          if (!b.inlines || b.inlines.length === 0) hollow++;
          walkInlines(b.inlines);
        }
      }
    };
    let headerHollow = false;
    for (const s of out.sections) {
      walkBlocks(s.blocks);
      for (const hf of Object.values(s.headersFooters ?? {}) as any[]) {
        walkBlocks(hf.blocks);
        if (hf === s.headersFooters.header)
          headerHollow = hf.blocks.every(
            (b: any) => !b.inlines || b.inlines.length === 0
          );
      }
    }
    return {
      stack: ed.sfdtExportModule.inlineContentControls.length,
      paragraphs,
      hollow,
      tables,
      images: Object.keys(out.images ?? {}).length,
      headerHollow,
      ccs,
      text,
      errors: errors.splice(0)
    };
  },
  /** Hierarchical position of the first occurrence of `word`, via the editor's search. */
  findStart(word: string): string {
    const ed = live() as any;
    ed.search.find(word, 'None');
    return String(ed.selection.startOffset);
  },
  act(name: string, args: any[] = []): any {
    const ed = live() as any;
    switch (name) {
      case 'select':
        ed.selection.select(args[0], args[1]);
        return String(ed.selection.text ?? '');
      case 'trackOn':
        ed.enableTrackChanges = true;
        ed.currentUser = 'User';
        return;
      case 'delete':
        return ed.editor.delete();
      case 'acceptAll':
        return ed.revisions.acceptAll();
      case 'undo':
        return ed.editorHistory.undo();
      default:
        throw new Error(`unknown action ${name}`);
    }
  }
};

(window as any).cc = api;
(window as any).ccReady = true;
