// Real React surfaces and pinned Syncfusion engine; no network or save side effects.
import React from 'react';
import { computeHistoryTask } from '../../../../../elements/components/DocxEditor/history/historyComputation';
import { runHistoryTask } from '../../../../../elements/components/DocxEditor/history/historyWorkerClient';
import { createRoot, Root } from 'react-dom/client';
import { registerLicense } from '@syncfusion/ej2-base';
import {
  DocumentEditorContainer,
  Toolbar
} from '@syncfusion/ej2-documenteditor';
import DocxEditor from '../../../../../elements/components/DocxEditor';
import SharedDocumentRail from '../../../../../elements/components/DocxEditor/SharedDocumentRail';

let root: Root | undefined;
let host: HTMLDivElement;
let active = 0;
let panel: 'history' | null = null;
let docs: any[] = [];
let instances = 0;
let workerConstructions = 0;
const NativeWorker = globalThis.Worker;
(globalThis as any).Worker = class extends NativeWorker {
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options);
    workerConstructions++;
  }
};
class CountedContainer extends DocumentEditorContainer {
  private counted = true;
  constructor(options: any) {
    super(options);
    instances++;
  }
  destroy() {
    if (this.counted) {
      instances--;
      this.counted = false;
    }
    super.destroy();
  }
}
let calls: number[] = [];
let serialMs: number[] = [];
const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const render = () =>
  root!.render(
    React.createElement(
      SharedDocumentRail,
      {
        activeId: `perf-${active}`,
        panel,
        onPanelChange: () => {},
        enabled: docs.length > 1,
        showChanges: true,
        children: null
      },
      ...docs.map((doc, i) =>
        React.createElement(
          'div',
          {
            key: i,
            style: {
              position: 'absolute',
              inset: 0,
              visibility: i === active ? 'visible' : 'hidden'
            }
          },
          React.createElement(DocxEditor, {
            source: doc.source,
            bindings: doc.bindings,
            envelopeId: `perf-${i}`,
            active: i === active,
            manualSave: true,
            reviewChanges: true,
            railPanel: panel,
            onRailPanelChange: () => {},
            history: doc.history,
            onEditorReady: (editor: any) => {
              doc.editor = editor;
            },
            onReady: () => {
              doc.ready = true;
            },
            onSave: async () => undefined
          })
        )
      )
    )
  );

export const multiDocumentPerformanceHarness = {
  async measureHistoryWorker() {
    const document = (tail: string) =>
      JSON.stringify({
        sections: [
          {
            blocks: Array.from({ length: 250 }, (_, i) => ({
              inlines: [
                {
                  text:
                    `Paragraph ${i}: ` +
                    'Representative text for document history calculation. '.repeat(
                      8
                    ) +
                    tail
                }
              ]
            }))
          }
        ]
      });
    const input = {
      sessionId: 'performance',
      snapshot: {
        fStr: document('changed'),
        s0: document('original'),
        fAuthor: 'you',
        slices: [],
        slicesComplete: true,
        robinRuns: [],
        acceptance: null
      }
    };
    const measure = async (inWorker: boolean) => {
      let ticks = 0;
      let maxGap = 0;
      let last = performance.now();
      const interval = setInterval(() => {
        const now = performance.now();
        maxGap = Math.max(maxGap, now - last);
        last = now;
        ticks++;
      }, 5);
      await new Promise((resolve) => setTimeout(resolve, 15));
      ticks = 0;
      maxGap = 0;
      last = performance.now();
      const start = performance.now();
      const result = inWorker
        ? await runHistoryTask('close', input)
        : computeHistoryTask('close', input);
      const ms = performance.now() - start;
      const ticksDuringCalculation = ticks;
      await new Promise((resolve) => setTimeout(resolve, 15));
      clearInterval(interval);
      return { ms, ticksDuringCalculation, maxGap, result };
    };
    const direct = await measure(false);
    const worker = await measure(true);
    const identical =
      JSON.stringify(direct.result) === JSON.stringify(worker.result);
    return {
      direct: { ...direct, result: undefined },
      worker: { ...worker, result: undefined },
      identical,
      workerConstructions,
      changeCount: worker.result.changes?.changeCount
    };
  },
  async openPerformanceDocuments(
    input: string | string[],
    count: number,
    bindings = false
  ) {
    root?.unmount();
    host?.remove();
    (globalThis as any).ej = {
      base: { registerLicense },
      documenteditor: { DocumentEditorContainer: CountedContainer, Toolbar }
    };
    (globalThis as any).scriptjsLoadPromise = Promise.resolve({
      default: (_urls: string[], done: () => void) => done()
    });
    host = document.createElement('div');
    host.style.cssText =
      'position:fixed;inset:0;width:1200px;height:800px;background:white';
    document.body.appendChild(host);
    root = createRoot(host);
    active = 0;
    panel = null;
    docs = Array.from({ length: count }, (_, i) => {
      const sfdt = Array.isArray(input) ? input[i % input.length] : input;
      return {
        bindings: { enabled: bindings },
        source: { sfdt },
        history: {
          listVersions: async () => [
            {
              id: `version-${i}`,
              session_id: `saved-${i}`,
              is_current: true,
              seq: 1,
              name: '',
              authors: [],
              started_at: '2026-10-16T12:00:00Z',
              ended_at: '2026-10-16T12:01:00Z',
              created_at: '2026-10-16T12:00:00Z',
              final_sfdt: `sfdt-${i}`,
              change_count: null
            }
          ],
          fetchVersionFile: async () => new TextEncoder().encode(sfdt).buffer,
          closeVersion: async () => null,
          restoreVersion: async () => undefined,
          renameVersion: async () => {
            throw new Error('unused');
          }
        }
      };
    });
    const start = performance.now();
    render();
    for (let i = 0; i < 600 && !docs.every((doc) => doc.ready); i++)
      await frame();
    if (!docs.every((doc) => doc.ready))
      throw new Error('Performance editors did not open');
    for (let i = 0; i < 10; i++) await frame();
    calls = docs.map(() => 0);
    serialMs = docs.map(() => 0);
    docs.forEach((doc, i) => {
      const serialize = doc.editor.serialize.bind(doc.editor);
      doc.editor.serialize = () => {
        const t = performance.now();
        const result = serialize();
        calls[i]++;
        serialMs[i] += performance.now() - t;
        return result;
      };
    });
    return {
      openMs: performance.now() - start,
      pages: docs.map((doc) => doc.editor.pageCount)
    };
  },
  async measurePerformanceTyping() {
    panel = null;
    active = 0;
    render();
    for (let i = 0; i < 10; i++) await frame();
    calls.fill(0);
    serialMs.fill(0);
    const sync: number[] = [];
    const paint: number[] = [];
    const editor = docs[0].editor;
    editor.selection.moveToDocumentEnd();
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      editor.editor.insertText('x');
      sync.push(performance.now() - start);
      await frame();
      paint.push(performance.now() - start);
    }
    const percentile = (a: number[], p: number) =>
      [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) * p)];
    return {
      syncP50: percentile(sync, 0.5),
      syncP95: percentile(sync, 0.95),
      frameP95: percentile(paint, 0.95),
      serializeCalls: calls,
      serializeMs: serialMs,

      canvases: host.querySelectorAll('canvas').length
    };
  },
  async measurePerformancePreviews() {
    // Fresh saved rows are exercised before typing opens a new editing session.
    panel = 'history';
    for (active = 0; active < docs.length; active++) {
      render();
      for (let i = 0; i < 45; i++) await frame();
    }
    active = 0;
    render();
    for (let i = 0; i < 20; i++) await frame();
    return {
      containers: instances,
      drafts: docs.length,
      previews: instances - docs.length,
      canvases: host.querySelectorAll('canvas').length
    };
  },
  closePerformanceDocuments() {
    root?.unmount();
    root = undefined;
    host?.remove();
    docs = [];
  }
};
