// Decomposes the 500-edit slowdown into its three layers, so we know which
// one is actually worth spending correctness-risk budget on before touching
// anything: (1) Syncfusion's own native tracked-insert cost, with no wrapper
// and no rail at all; (2) our applyDocumentEdits engine (verification +
// anchor bookkeeping) with no rail mounted; (3) the full stack, engine + our
// custom TrackedChangeGroups rail mounted (same as bulkEdits.bench.spec.tsx).
// A live measurement, not a pass/fail gate — see that file's header for why.
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
import { render } from '@testing-library/react';
import React from 'react';
import TrackedChangeGroups from './TrackedChangeGroups';
import { applyDocumentEdits } from '../../../assistant/tools/docx/syncfusionDocumentOps';
import {
  installRevisionGroupIsolation,
  LiveEditor
} from '../../../utils/documentEditorPrimitives';
import { featheryDoc, featheryWindow } from '../../../utils/browser';

DocumentEditor.Inject(
  Editor,
  Selection,
  SfdtExport,
  EditorHistory,
  ImageResizer,
  Search
);

const testWindow = featheryWindow();
if (!testWindow.crypto?.getRandomValues) {
  Object.defineProperty(testWindow, 'crypto', {
    value: { getRandomValues: (array: Uint8Array) => randomFillSync(array) }
  });
}
const jsdomGetComputedStyle = testWindow.getComputedStyle.bind(testWindow);
testWindow.getComputedStyle = ((elt: Element) =>
  jsdomGetComputedStyle(elt)) as typeof testWindow.getComputedStyle;
if (!(testWindow.SVGElement.prototype as any).getBBox) {
  (testWindow.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);
}

function makeRealEditor(): DocumentEditor {
  const host = featheryDoc().createElement('div');
  host.style.width = '900px';
  host.style.height = '700px';
  featheryDoc().body.appendChild(host);
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
  return editor;
}

jest.setTimeout(180000);

const N = Number(process.env.BENCH_N ?? 500);

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

function buildEdits(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    op: 'replace_text' as const,
    anchor: `0;${i}`,
    find: `Item${i}Value`,
    replace: `ITEM${i}VALUE`,
    group: `g${i}`
  }));
}

describe(`native vs. custom tracked-changes cost, N=${N}`, () => {
  it('layer 1: raw Syncfusion tracked insert, no wrapper, no rail', () => {
    const editor = makeRealEditor();
    editor.open(JSON.stringify(buildDoc(1)));
    editor.enableTrackChanges = true;
    editor.selection.moveToDocumentEnd();

    const start = Date.now();
    for (let i = 0; i < N; i++) editor.editor.insertText(`Native edit ${i}\n`);
    const elapsed = Date.now() - start;

    const liveCount = editor.revisions?.changes?.length ?? 0;
    // eslint-disable-next-line no-console
    console.log(
      `[native-vs-custom] layer1 (native, no wrapper/rail) N=${N}: ` +
        `${elapsed}ms total, ${(elapsed / N).toFixed(2)}ms/edit, ` +
        `revisions=${liveCount}`
    );
    expect(liveCount).toBeGreaterThan(0);

    editor.destroy();
  });

  it('layer 2: applyDocumentEdits engine, no rail mounted', () => {
    const editor = makeRealEditor();
    editor.open(JSON.stringify(buildDoc(N)));
    installRevisionGroupIsolation(editor as unknown as LiveEditor);

    const start = Date.now();
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'bench-cs-no-rail',
      edits: buildEdits(N)
    });
    const elapsed = Date.now() - start;

    const failures = result.results.filter((r: any) => !r?.ok);
    // eslint-disable-next-line no-console
    console.log(
      `[native-vs-custom] layer2 (engine, no rail) N=${N}: ` +
        `${elapsed}ms total, ${(elapsed / N).toFixed(2)}ms/edit, ` +
        `ok=${N - failures.length}/${N}`
    );
    expect(failures).toEqual([]);

    editor.destroy();
  });

  it('layer 3: applyDocumentEdits engine + custom rail mounted', () => {
    const editor = makeRealEditor();
    editor.open(JSON.stringify(buildDoc(N)));
    installRevisionGroupIsolation(editor as unknown as LiveEditor);

    const { unmount } = render(<TrackedChangeGroups editor={editor as any} />);

    const start = Date.now();
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'bench-cs-with-rail',
      edits: buildEdits(N)
    });
    const elapsed = Date.now() - start;

    const failures = result.results.filter((r: any) => !r?.ok);
    // eslint-disable-next-line no-console
    console.log(
      `[native-vs-custom] layer3 (engine + rail) N=${N}: ` +
        `${elapsed}ms total, ${(elapsed / N).toFixed(2)}ms/edit, ` +
        `ok=${N - failures.length}/${N}`
    );
    expect(failures).toEqual([]);

    unmount();
    editor.destroy();
  });
});
