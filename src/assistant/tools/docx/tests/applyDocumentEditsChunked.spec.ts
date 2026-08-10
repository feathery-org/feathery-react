// Fix 1 (see the plan under /Users/ayeshahafeez/.claude/plans): a big batch
// applied through applyDocumentEdits in one synchronous burst can freeze the
// tab. applyDocumentEditsChunked splits it into group-safe chunks and yields
// between them, calling the existing, unchanged applyDocumentEdits per chunk.
// These tests cover exactly the risk that design carries: a chunk boundary
// must never split a `group` in two, and the merged result must read
// identically to one unchunked call.
import 'jest-canvas-mock';
import { randomFillSync } from 'crypto';
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
  applyDocumentEditsChunked,
  EditOp,
  LiveEditor
} from '../syncfusionDocumentOps';

DocumentEditor.Inject(
  Editor,
  Selection,
  SfdtExport,
  EditorHistory,
  ImageResizer,
  Search
);

if (!window.crypto?.getRandomValues) {
  Object.defineProperty(window, 'crypto', {
    value: {
      getRandomValues: (array: Uint8Array) =>
        require('crypto').randomFillSync(array)
    }
  });
}
if (!(window.SVGElement.prototype as any).getBBox) {
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);
}

function makeEditor(sfdt: any): DocumentEditor {
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '700px';
  document.body.appendChild(host);
  const editor = new DocumentEditor({
    isReadOnly: false,
    enableEditor: true,
    enableSelection: true,
    enableImageResizer: true,
    enableSearch: true,
    enableSfdtExport: true,
    enableEditorHistory: true
  });
  editor.appendTo(host);
  editor.open(JSON.stringify(sfdt));
  return editor;
}

function destroyEditor(editor: DocumentEditor): void {
  const element = editor.element;
  editor.destroy();
  element?.remove();
}

function buildDoc(n: number) {
  return {
    sections: [
      {
        blocks: Array.from({ length: n }, (_, i) => ({
          inlines: [{ text: `Item${i}Value` }]
        }))
      }
    ]
  };
}

function buildEdits(n: number, groupOf: (i: number) => string): EditOp[] {
  return Array.from({ length: n }, (_, i) => ({
    op: 'replace_text',
    anchor: `0;${i}`,
    find: `Item${i}Value`,
    replace: `ITEM${i}VALUE`,
    group: groupOf(i)
  }));
}

describe('applyDocumentEditsChunked', () => {
  it('passes a batch small enough for one chunk straight through, with no yield', async () => {
    const editor = makeEditor(buildDoc(5));
    const yieldToBrowser = jest.fn(async () => {});
    const result = await applyDocumentEditsChunked(
      editor as unknown as LiveEditor,
      { changeSetId: 'cs', edits: buildEdits(5, (i) => `g${i}`) },
      { chunkSize: 20, yieldToBrowser }
    );
    expect(result.results.every((r) => r.ok)).toBe(true);
    expect(yieldToBrowser).not.toHaveBeenCalled();
    destroyEditor(editor);
  });

  it('produces the same per-op results as one unchunked call', async () => {
    const chunkedEditor = makeEditor(buildDoc(40));
    const chunkedResult = await applyDocumentEditsChunked(
      chunkedEditor as unknown as LiveEditor,
      { changeSetId: 'cs', edits: buildEdits(40, (i) => `g${i}`) },
      { chunkSize: 7 }
    );
    destroyEditor(chunkedEditor);

    const wholeEditor = makeEditor(buildDoc(40));
    const wholeResult = applyDocumentEdits(wholeEditor as unknown as LiveEditor, {
      changeSetId: 'cs',
      edits: buildEdits(40, (i) => `g${i}`)
    });
    destroyEditor(wholeEditor);

    expect(chunkedResult.results.map((r) => r.ok)).toEqual(
      wholeResult.results.map((r) => r.ok)
    );
    expect(chunkedResult.results.every((r) => r.ok)).toBe(true);
  });

  it('yields once per chunk boundary', async () => {
    const editor = makeEditor(buildDoc(40));
    const yieldToBrowser = jest.fn(async () => {});
    await applyDocumentEditsChunked(
      editor as unknown as LiveEditor,
      { changeSetId: 'cs', edits: buildEdits(40, (i) => `g${i}`) },
      { chunkSize: 10, yieldToBrowser }
    );
    // 40 ops, chunk size 10, no group spans a boundary -> 4 chunks -> 4 yields.
    expect(yieldToBrowser).toHaveBeenCalledTimes(4);
    destroyEditor(editor);
  });

  it('never splits a group across chunks even when its ops are far apart in the batch', async () => {
    // Group 'wide' opens at index 0 and closes at index 35; chunk size is
    // tiny (5) so a naive slice-every-5 would cut straight through it.
    const n = 40;
    const group = (i: number) => (i === 0 || i === 35 ? 'wide' : `solo${i}`);
    const editor = makeEditor(buildDoc(n));
    const result = await applyDocumentEditsChunked(
      editor as unknown as LiveEditor,
      { changeSetId: 'cs', edits: buildEdits(n, group) },
      { chunkSize: 5 }
    );
    expect(result.results.every((r) => r.ok)).toBe(true);
    const wideGroups = (result.changeSet?.groups ?? []).filter(
      (g) => g.id === 'wide'
    );
    // Exactly one reported group for 'wide'. If the chunk boundary had split
    // it, two separate applyDocumentEdits calls would each have reported
    // their own 'wide' group instead of one combined one.
    expect(wideGroups).toHaveLength(1);
    expect([...wideGroups[0].opIndices].sort((a, b) => a - b)).toEqual([
      0, 35
    ]);
    destroyEditor(editor);
  });
});
