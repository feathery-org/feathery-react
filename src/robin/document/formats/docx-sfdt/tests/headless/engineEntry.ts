// In-page bridge for the engine's headless lane: the real document editor with the product's
// bindings attached, one engine session over it, and the editor's own accept and reject for
// cross-checking the engine's projections. Test-only; never part of the product bundle.
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
} from '../../../../../../elements/components/DocxEditor/bindings/attachBindings';
import { SyncfusionEditorLike } from '../../../../../../elements/components/DocxEditor/bindings/editorAdapter';
import { comparable, differences, equivalentNative } from '../../../../proof';
import { DocumentSession } from '../../../../session';
import { canonicalJson, NfNode, NormalForm } from '../../../../tree';
import { createHost, docxPack, LiveEditor } from '../../index';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import TrackedChangeGroups from '../../../../../../elements/components/DocxEditor/TrackedChangeGroups';
import HistoryGroup from '../../../../../../elements/components/DocxEditor/DocxToolbar/groups/HistoryGroup';
import { installHistoryRouting } from '../../../../../../elements/components/DocxEditor/historyRouting';
import { registerCardResolver, registerHistoryRoute } from '../../../../mounts';
import { setAssistantSessionActive } from '../../../../../../assistant/tools/docx/syncfusionDocumentOps';

declare const __SYNCFUSION_LICENSE_KEY__: string;
if (__SYNCFUSION_LICENSE_KEY__) registerLicense(__SYNCFUSION_LICENSE_KEY__);

DocumentEditor.Inject(Editor, Selection, SfdtExport, EditorHistory, ImageResizer, Search);

let editor: DocumentEditor | null = null;
let scratch: DocumentEditor | null = null;
let attached: AttachedBindings | null = null;
let session: DocumentSession | null = null;
const errors: string[] = [];

/**
 * Time spent inside the editor (host calls and seam applications) during a dispatch, so per-verb
 * cost splits into the editor's own work and the engine's.
 */
let editorMs = 0;
let timedDepth = 0;
function timedCall<A extends unknown[], R>(f: (...a: A) => R): (...a: A) => R {
  return (...a: A): R => {
    // a host call inside a timed seam (the splice's open) is counted once, by the outer call
    if (timedDepth) return f(...a);
    timedDepth += 1;
    const t0 = performance.now();
    try {
      return f(...a);
    } finally {
      timedDepth -= 1;
      editorMs += performance.now() - t0;
    }
  };
}
const timedPack: typeof docxPack = {
  ...docxPack,
  seams: Object.fromEntries(
    Object.entries(docxPack.seams).map(([name, seam]) => [name, { ...seam, apply: timedCall(seam.apply) }])
  )
};
function timedHost(h: ReturnType<typeof createHost>): ReturnType<typeof createHost> {
  return {
    ...h,
    serialize: timedCall(h.serialize),
    open: timedCall(h.open),
    undo: timedCall(h.undo),
    redo: timedCall(h.redo)
  };
}
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

function makeEditor(id: string): DocumentEditor {
  const host = document.createElement('div');
  host.id = id;
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
  return instance;
}

const live = (): DocumentEditor => {
  if (!editor) throw new Error('no document is open');
  return editor;
};
const history = () => ((live() as any).editorHistory ?? (live() as any).editorHistoryModule) as any;

/** Serialize until two reads agree: the PAGE field's cached text settles after layout (N1). */
async function settled(max = 40): Promise<string> {
  let prev = live().serialize();
  for (let k = 0; k < max; k += 1) {
    await frame();
    const now = live().serialize();
    if (now === prev) return now;
    prev = now;
  }
  return prev;
}

// The product's review rail and toolbar history buttons, rendered over the live editor.
let uiRoot: Root | null = null;
function renderReviewUi(): void {
  let host = document.getElementById('fm-review');
  if (!host) {
    host = document.createElement('div');
    host.id = 'fm-review';
    host.style.cssText = 'position:fixed;right:0;top:0;width:360px;height:900px;';
    document.body.appendChild(host);
  }
  uiRoot ??= createRoot(host);
  uiRoot.render(
    React.createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
      React.createElement('div', { id: 'fm-history' }, React.createElement(HistoryGroup, { editor })),
      React.createElement('div', { style: { position: 'relative', flex: 1, display: 'flex' } }, React.createElement(TrackedChangeGroups, { editor, key: Math.random() }))
    )
  );
}

const byText = (root: Element, selector: string, text: string): HTMLElement | null =>
  ([...root.querySelectorAll(selector)] as HTMLElement[]).find((el) => (el.textContent ?? '').trim() === text || el.getAttribute('aria-label') === text || el.getAttribute('title') === text) ?? null;

const api = {
  async open(text: string): Promise<number> {
    try {
      attached?.dispose();
    } catch {
      // a disposed editor has nothing left to release
    }
    editor?.destroy();
    document.getElementById('fm-editor')?.remove();
    editor = makeEditor('fm-editor');
    editor.open(text);
    await frame();
    await frame();
    attached = attachBindings(editor as unknown as SyncfusionEditorLike, { convertTokensOnOpen: false });
    await frame();
    session = new DocumentSession({
      pack: timedPack,
      host: timedHost(createHost(editor as unknown as LiveEditor)),
      target: { type: 'envelope', id: 'env' },
      editorId: 'ed',
      // the flag the rail reads for "Robin is editing", as robinDocument.ts sets it
      onTurnChange: (turnId) => setAssistantSessionActive(editor as never, turnId !== null)
    });
    // as the product mounts it (robinDocument.ts): the rail's resolver, the undo route, the keys
    const live = session;
    registerCardResolver(editor, {
      owns: (id) => live.ownsCard(id),
      resolve: (id, accept) => live.resolveCard(id, accept)
    });
    registerHistoryRoute(editor, { undo: () => live.undo(), redo: () => live.redo() });
    installHistoryRouting(editor);
    renderReviewUi();
    return (await settled()).length;
  },

  /** The user's own untracked edit, so their undo stack is not empty when Robin commits. */
  async userEdit(at: string, text: string): Promise<string> {
    const e = live() as any;
    e.enableTrackChanges = false;
    e.currentUser = 'User';
    e.selection.select(at, at);
    e.editorModule.insertText(text);
    return settled();
  },

  settled,
  serialize: () => live().serialize(),
  errors: () => errors.slice(),

  /** The engine id of the node at a native-shaped path (`sections`, 4, `blocks`, 4, ...). */
  idAt(path: Array<string | number>): string | null {
    if (!session) return null;
    let cur: any = session.state.view.nf.root;
    for (const t of path) cur = cur?.[t as any];
    return cur && typeof (cur as NfNode).id === 'string' ? (cur as NfNode).id : null;
  },

  dispatch(payload: unknown) {
    if (!session) throw new Error('no session');
    return session.dispatch(payload);
  },

  /** One dispatch timed in the page, in milliseconds (per-verb cost, measured without the bridge). */
  timedDispatch(payload: unknown): { ms: number; editorMs: number; result: unknown } {
    if (!session) throw new Error('no session');
    editorMs = 0;
    const t0 = performance.now();
    const result = session.dispatch(payload);
    return { ms: performance.now() - t0, editorMs, result };
  },

  /** The pieces every verb pays on the live document, timed in the page, in milliseconds. */
  costs(): Record<string, number> {
    const time = (f: () => unknown) => {
      const t0 = performance.now();
      f();
      return performance.now() - t0;
    };
    const native = live().serialize();
    const read = docxPack.adapter.toNormalForm(native);
    return {
      serialize: time(() => live().serialize()),
      toNormalForm: time(() => docxPack.adapter.toNormalForm(native)),
      fromNormalForm: time(() => docxPack.adapter.fromNormalForm(read.nf, read.residue)),
      bytes: native.length
    };
  },

  /** Test support: the text the editor selects between two hierarchical offsets. */
  selectText(start: string, end: string): string {
    const selection = (live() as any).selection;
    selection.select(start, end);
    return String(selection.text ?? '');
  },

  /** Rows the bindings' controller indexes for a bound table, and how many times it was attached. */
  bindingRows(tableId: string): number {
    return attached?.controller.index?.tables.get(tableId)?.rows.length ?? -1;
  },

  /** The review rail as a person sees it: each card's title, count line and per-edit buttons. */
  async rail(): Promise<Array<{ title: string; perEditButtons: number }>> {
    // past the rail's own refresh debounce (150 ms), as a person looking at it would be
    await new Promise((resolve) => setTimeout(resolve, 300));
    await frame();
    const host = document.getElementById('fm-review');
    if (!host) return [];
    const cards = [...host.querySelectorAll('button[aria-label^="Go to "]')] as HTMLElement[];
    return cards.map((title) => {
      const card = title.closest('div[css], div') as HTMLElement;
      let box: HTMLElement | null = title;
      while (box && !(box.querySelector('button') && [...box.querySelectorAll('button')].some((b) => b.textContent === 'Accept'))) box = box.parentElement;
      return {
        title: (title.textContent ?? '').trim(),
        perEditButtons: box ? box.querySelectorAll('button[aria-label="Accept this edit"]').length : -1
      };
    });
  },

  /** Expand card `index` and click Accept or Reject on it, as a person does. */
  async clickCard(index: number, action: 'Accept' | 'Reject'): Promise<void> {
    const host = document.getElementById('fm-review') as HTMLElement;
    const titles = [...host.querySelectorAll('button[aria-label^="Go to "]')] as HTMLElement[];
    let box: HTMLElement | null = titles[index];
    while (box && !byText(box, 'button', action)) box = box.parentElement;
    const button = box && byText(box, 'button', action);
    if (!button) throw new Error(`no ${action} button on card ${index}`);
    button.click();
    await frame();
    await frame();
  },

  /** Click the toolbar's Undo or Redo button. */
  async clickToolbar(which: 'Undo' | 'Redo'): Promise<void> {
    const button = byText(document.getElementById('fm-history') as HTMLElement, 'button', which);
    if (!button) throw new Error(`no ${which} button`);
    button.click();
    await frame();
    await frame();
  },

  /** Press Ctrl+Z or Ctrl+Y in the document, as the keyboard does. */
  async pressInDocument(key: 'z' | 'y'): Promise<void> {
    const div = (live() as any).documentHelper?.editableDiv as HTMLElement;
    div.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }));
    await frame();
    await frame();
  },

  undoDepth(): number {
    const h = history();
    const stack = h?.undoStackIn ?? h?.undoStack;
    return Array.isArray(stack) ? stack.length : -1;
  },
  canUndo: () => !!history()?.canUndo?.(),
  /** Accept every pending change in the live editor, as Accept all in the rail does. */
  async acceptAllLive(): Promise<void> {
    (live() as any).revisions.acceptAll();
    await frame();
  },

  /** The form's Robin turn settled (the hosted handler calls liveDocument.finishTurn()). */
  finishTurn() {
    session?.finishTurn();
  },

  sessionUndo() {
    if (!session) throw new Error('no session');
    return session.undo();
  },
  equivalent: (a: string, b: string) => equivalentNative(docxPack, a, b),

  /** The live document's revisions, by type, group and the card title their tag carries. */
  revisions(): Array<{ type: string; author: string; group: string | null; title: string | null }> {
    const doc = JSON.parse(live().serialize());
    return (doc.revisions ?? []).map((r: any) => {
      let tag: any = null;
      try {
        tag = JSON.parse(r.customData ?? 'null');
      } catch {
        tag = null;
      }
      return { type: r.revisionType, author: r.author, group: tag?.changeSetId ?? null, title: tag?.title ?? null };
    });
  },

  /**
   * The editor's own accept-all and reject-all of the live document, compared with the engine's
   * projections of it under the measured normalizations (the proof's assumption, checked).
   */
  async crossCheck(): Promise<{ accept: boolean; reject: boolean; acceptDiff: string[]; rejectDiff: string[] }> {
    const post = live().serialize();
    const native = await api.nativeProjections(post);
    const nf = (text: string) => docxPack.adapter.toNormalForm(text).nf;
    const canon = (doc: NormalForm) => {
      let d = doc;
      for (const n of docxPack.projections.normalizations) d = n.apply(d);
      return comparable(docxPack, d);
    };
    const a1 = canon(docxPack.projections.accept(nf(post)));
    const a2 = canon(nf(native.accepted));
    const r1 = canon(docxPack.projections.reject(nf(post)));
    const r2 = canon(nf(native.rejected));
    return {
      accept: canonicalJson(a1) === canonicalJson(a2),
      reject: canonicalJson(r1) === canonicalJson(r2),
      acceptDiff: differences(a1, a2),
      rejectDiff: differences(r1, r2)
    };
  },

  /** The editor's own accept-all and reject-all of a document, on a scratch editor. */
  async nativeProjections(text: string): Promise<{ accepted: string; rejected: string }> {
    if (!scratch) scratch = makeEditor('fm-scratch');
    scratch.open(text);
    await frame();
    (scratch as any).revisions.acceptAll();
    await frame();
    const accepted = scratch.serialize();
    scratch.open(text);
    await frame();
    (scratch as any).revisions.rejectAll();
    await frame();
    const rejected = scratch.serialize();
    return { accepted, rejected };
  }
};

(window as any).fmEngine = api;
(window as any).fmEngineReady = true;
