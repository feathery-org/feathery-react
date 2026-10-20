// Real React surfaces and pinned Syncfusion engine; no network or save side effects.
import React from 'react';
import DocumentTabs from '../../../../../elements/components/DocumentEditor/DocumentTabs';
import VersionViewer from '../../../../../elements/components/DocxEditor/history/VersionViewer';
import { __clearVersionDocumentCache } from '../../../../../elements/components/DocxEditor/history/useVersionDocument';
import { computeHistoryTask } from '../../../../../elements/components/DocxEditor/history/historyComputation';
import { runHistoryTask } from '../../../../../elements/components/DocxEditor/history/historyWorkerClient';
import { hiddenEditorConverter } from '../../../../../elements/components/DocxEditor/history/convertOriginal';
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
let constructions = 0;
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
    constructions++;
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
let savedArtifacts: any[] = [];
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
  async measureCompactOriginalGroup(
    originalSfdt: string,
    saved: string[] = [],
    changes: any[] = []
  ) {
    (globalThis as any).ej = {
      base: { registerLicense },
      documenteditor: { DocumentEditorContainer: CountedContainer, Toolbar }
    };
    (globalThis as any).scriptjsLoadPromise = Promise.resolve({
      default: (_urls: string[], done: () => void) => done()
    });
    __clearVersionDocumentCache();
    if (!saved.length) {
      const original = await hiddenEditorConverter('')(originalSfdt);
      saved = ['v1', 'v2'].map((value) => {
        const copy = JSON.parse(JSON.stringify(original));
        const blocks = copy.sections[0].blocks;
        blocks[blocks.length - 1].inlines[0].text += ` ${value}`;
        return JSON.stringify(copy);
      });
    }
    const original = {
      id: 'compact-original',
      seq: 0,
      is_baseline: true,
      final_sfdt: 'original',
      changes: null,
      session_id: null
    } as any;
    const versions = saved.map((_, index) => ({
      id: `saved-${index}`,
      session_id: `saved-${index}`,
      seq: index + 1,
      is_current: index === saved.length - 1,
      final_sfdt: `final-${index}`,
      changes: changes[index] ? `changes-${index}` : null,
      change_count: changes[index]?.changeCount ?? null,
      authors: [{ kind: 'user', label: 'You' }],
      actor_label: 'you'
    })) as any[];
    const current = versions[versions.length - 1];
    const fetches: string[] = [];
    const history = {
      fetchVersionFile: async (key: string) => {
        fetches.push(key);
        const index = Number(key.split('-')[1]);
        const value =
          key === 'original'
            ? originalSfdt
            : key.startsWith('final-')
            ? saved[index]
            : JSON.stringify(changes[index]);
        return new TextEncoder().encode(value).buffer;
      }
    } as any;
    const previewHost = document.createElement('div');
    previewHost.style.cssText =
      'position:fixed;inset:0;width:1200px;height:800px';
    document.body.appendChild(previewHost);
    const previewRoot = createRoot(previewHost);
    const initialInstances = instances;
    const initialConstructions = constructions;
    let editor: any;
    const rows: any[] = [];
    try {
      for (const version of [current, original, current]) {
        let displayed = false;
        let meta: any;
        const events: any[] = [];
        const started = performance.now();
        previewRoot.render(
          React.createElement(VersionViewer, {
            host: history,
            version,
            folded:
              version === current
                ? { earlier: versions.slice(0, -1), preceding: original }
                : undefined,
            serviceUrl: 'https://unused.invalid/',
            onMeta: (value: any) => {
              meta = value;
            },
            onViewerEditor: (value: any) => {
              editor = value;
            },
            onDisplayedVersion: (value: any) => {
              events.push({ id: value.id, ...meta });
              if (value.id === version.id) displayed = true;
            }
          })
        );
        for (let n = 0; n < 600 && !displayed; n++) await frame();
        if (!displayed) throw new Error('Grouped version never displayed');
        let highlightedCharacters = 0;
        const highlightedSections: number[] = [];
        JSON.parse(editor.serialize()).sections.forEach(
          (section: any, index: number) => {
            JSON.stringify(section, (key, value) => {
              if (value?.text && value.revisionIds?.length) {
                highlightedCharacters += value.text.length;
                if (!highlightedSections.includes(index))
                  highlightedSections.push(index);
              }
              return value;
            });
          }
        );
        rows.push({
          version: version.id,
          milliseconds: performance.now() - started,
          editCount: meta?.editCount,
          degraded: meta?.degraded,
          highlightedCharacters,
          highlightedSections,
          events,
          constructions: constructions - initialConstructions,
          activeContainers: instances - initialInstances
        });
      }
    } finally {
      previewRoot.unmount();
      previewHost.remove();
    }
    return {
      rows,
      originalFetches: fetches.filter((key) => key === 'original').length,
      remainingContainers: instances - initialInstances
    };
  },
  openOverflowDocuments(width: number) {
    root?.unmount();
    host?.remove();
    host = globalThis.document.createElement('div');
    host.style.cssText = `position:fixed;inset:0;width:${width}px;height:300px;background:white`;
    globalThis.document.body.appendChild(host);
    root = createRoot(host);
    const tabs = Array.from({ length: 20 }, (_, i) => ({
      id: `${i}`,
      label: `Document ${i + 1} — a long document name.docx`
    }));
    const draw = (activeId: string) =>
      root!.render(
        React.createElement(DocumentTabs, {
          tabs,
          activeId,
          disabled: false,
          id: 'overflow-test',
          onSelect: draw
        })
      );
    draw('0');
  },
  async measureVersionSwitches(
    sfdt: string,
    withChanges = false,
    changes: any = null
  ) {
    if (withChanges && !changes) {
      const before = JSON.parse(sfdt);
      before.sections[0].blocks.unshift({
        inlines: [{ text: 'Earlier version text' }]
      });
      changes = await runHistoryTask('close', {
        sessionId: 'preview-test',
        snapshot: {
          s0: JSON.stringify(before),
          fStr: sfdt,
          fAuthor: 'you',
          slices: [],
          slicesComplete: true,
          robinRuns: [],
          acceptance: null
        }
      }).then((result) => result.changes);
      if (!changes?.hunks.length)
        throw new Error('Expected generated change data');
    }
    __clearVersionDocumentCache();
    const previewHost = globalThis.document.createElement('div');
    previewHost.style.cssText =
      'position:fixed;inset:0;width:1200px;height:800px;background:white';
    globalThis.document.body.appendChild(previewHost);
    let previewRoot = createRoot(previewHost);
    let fetches = 0;
    const history = {
      fetchVersionFile: async (url: string) => {
        fetches++;
        await new Promise((resolve) => setTimeout(resolve, 150));
        return new TextEncoder().encode(
          url.startsWith('changes-') ? JSON.stringify(changes) : sfdt
        ).buffer;
      }
    } as any;
    const rows: any[] = [];
    let editor: any;
    try {
      for (const [index, key] of [
        'current',
        'older',
        'current',
        'older',
        'current'
      ].entries()) {
        // Revisit the document after releasing its only preview engine.
        if (index === 4) {
          previewRoot.unmount();
          previewRoot = createRoot(previewHost);
        }
        let displayed = false;
        let meta: any;
        const started = performance.now();
        previewRoot.render(
          React.createElement(VersionViewer, {
            host: history,
            version: {
              id: key,
              is_current: key === 'current',
              final_sfdt: key,
              changes: withChanges ? `changes-${key}` : null,
              change_count: withChanges ? changes.changeCount : null
            } as any,
            onMeta: (value: any) => {
              meta = value;
            },
            onViewerEditor: (value: any) => {
              editor = value;
            },
            onDisplayedVersion: (version: any) => {
              if (version.id === key) displayed = true;
            }
          })
        );
        for (let n = 0; n < 600; n++) {
          if (displayed) break;
          await frame();
        }
        if (!displayed) throw new Error('Version never displayed');
        await frame();
        rows.push({
          selection: key,
          remounted: index === 4,
          ms: performance.now() - started,
          fetches,
          ...(withChanges
            ? {
                degraded: meta?.degraded,
                editCount: meta?.editCount,
                revisions: editor?.revisions?.changes?.length
              }
            : {})
        });
      }
      return rows;
    } finally {
      previewRoot.unmount();
      previewHost.remove();
    }
  },
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
    host = globalThis.document.createElement('div');
    host.style.cssText =
      'position:fixed;inset:0;width:1200px;height:800px;background:white';
    globalThis.document.body.appendChild(host);
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
          closeVersion: async (_id: string, payload: any) => {
            savedArtifacts.push({
              document: i,
              changes: !!payload.changesJson,
              count: payload.changeCount,
              start: !!payload.startSha256
            });
            return null;
          },
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
  async measureSecondDocumentSave() {
    active = 1;
    panel = null;
    savedArtifacts = [];
    render();
    for (let i = 0; i < 10; i++) await frame();
    const editor = docs[1].editor;
    editor.selection.moveToDocumentEnd();
    editor.editor.insertText(' test change');
    await frame();
    const buttons = Array.from(host.querySelectorAll('button'));
    const visible = buttons.filter((b) => b.textContent?.trim() === 'Save');
    if (!visible[1])
      throw new Error(
        'Save button absent: ' + buttons.map((b) => b.textContent).join('|')
      );
    const began = performance.now();
    visible[1].click();
    for (let i = 0; i < 2400 && !savedArtifacts.length; i++) await frame();
    return { ms: performance.now() - began, artifacts: savedArtifacts };
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
