// Asserts correctness at scale and prints timing; deliberately no millisecond
// assertion, which would be flaky on varying CI hardware. Size via BENCH_N.
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
import { act, render, screen, within } from '@testing-library/react';
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

// A batch this size takes tens of seconds; that's the thing being measured.
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

// One group per edit, so the rail renders N cards rather than one — how the
// assistant tags a batch of unrelated edits.
function buildEdits(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    op: 'replace_text' as const,
    anchor: `0;${i}`,
    find: `Item${i}Value`,
    replace: `ITEM${i}VALUE`,
    group: `g${i}`
  }));
}

describe(`bulk edits at scale (N=${N})`, () => {
  it('applies the whole batch, lands every edit, and the rail settles to reflect all of them', async () => {
    const editor = makeRealEditor();
    editor.open(JSON.stringify(buildDoc(N)));
    installRevisionGroupIsolation(editor as unknown as LiveEditor);

    // Mounted before the batch so the rail's debounce/suppression logic runs
    // against real events, not just the engine in isolation.
    const { unmount } = render(<TrackedChangeGroups editor={editor as any} />);

    const start = Date.now();
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'bench-cs',
      edits: buildEdits(N)
    });
    const applyMs = Date.now() - start;

    const failures = result.results.filter((r: any) => !r?.ok);
    // eslint-disable-next-line no-console
    console.log(
      `[bulkEdits.bench] N=${N} applyDocumentEdits: ${applyMs}ms total, ` +
        `${(applyMs / N).toFixed(2)}ms/edit, ok=${N - failures.length}/${N}`
    );
    if (failures.length) {
      // eslint-disable-next-line no-console
      console.log(
        '[bulkEdits.bench] first failure:',
        JSON.stringify(failures[0])
      );
    }
    expect(failures).toEqual([]);

    // The rail only settles once quiet, so wait out the trailing debounce on
    // real timers to observe the final state rather than a mid-batch one.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    const panel = screen.getByLabelText('Assistant tracked changes');
    expect(within(panel).getByText(`${N} pending`)).toBeInTheDocument();

    unmount();
    editor.destroy();
  });
});
