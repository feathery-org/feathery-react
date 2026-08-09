// A live performance measurement, not a pass/fail gate: CI hardware varies
// enough that a hard millisecond assertion here would be flaky rather than
// meaningful. This test's job is to (a) prove correctness at scale — every
// edit actually lands, and the rail's own state settles to reflect all of
// them — and (b) print real timing so a regression is visible in CI output
// even though nothing here fails because of it. Override the batch size with
// BENCH_N=<n> for ad-hoc runs; 500 matches the "assistant pushes a big batch
// of edits" scenario this exists to characterize.
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

// A big batch legitimately takes real wall-clock time at this scale (tens
// of seconds) — this is measuring exactly that, not something to rush.
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

// Each edit gets its own group so the rail renders N separate cards, not one
// giant one — matching how the assistant actually tags a batch of unrelated
// edits, and exercising the same per-group render/lookup paths a real
// "assistant pushes a big batch" turn would.
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

    // Mounted BEFORE the batch runs — contentChange/selectionChange fire on
    // a REAL editor as ops land, exercising the rail's own debounce/
    // suppression logic exactly as a live chat turn would, not just the
    // engine in isolation.
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

    // The rail suppresses/collapses during the batch (isAssistantWriting)
    // and only settles once quiet — wait out the trailing debounce on real
    // timers (the batch itself ran on real timers, so faking them now
    // wouldn't advance anything already scheduled) to observe the FINAL
    // state, not a mid-batch snapshot.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    const panel = screen.getByLabelText('Assistant tracked changes');
    expect(within(panel).getByText(`${N} pending`)).toBeInTheDocument();

    unmount();
    editor.destroy();
  });
});
