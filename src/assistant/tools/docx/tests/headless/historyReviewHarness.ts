// Full editing surface: real native revisions, save snapshots, and review UI.
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { registerLicense } from '@syncfusion/ej2-base';
import {
  DocumentEditorContainer,
  Toolbar
} from '@syncfusion/ej2-documenteditor';
import DocxEditor from '../../../../../elements/components/DocxEditor';
import { rebindRevisionGroups } from '../../../../../utils/documentEditorPrimitives';
import {
  applyDocumentEdits,
  setAssistantSessionActive
} from '../../syncfusionDocumentOps';

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let editor: any;
let ready = false;
let saves: number;
let artifacts: any[];
const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export const historyReviewHarness = {
  async openHistoryReview(sfdt: string) {
    root?.unmount();
    host?.remove();
    editor = undefined;
    ready = false;
    saves = 0;
    artifacts = [];
    (globalThis as any).ej = {
      base: { registerLicense },
      documenteditor: { DocumentEditorContainer, Toolbar }
    };
    // The engine is bundled and pinned; do not load a second CDN runtime.
    (globalThis as any).scriptjsLoadPromise = Promise.resolve({
      default: (_urls: string[], done: () => void) => done()
    });
    host = globalThis.document.createElement('div');
    host.style.cssText =
      'position:fixed;inset:0;width:1200px;height:800px;background:white';
    globalThis.document.body.appendChild(host);
    root = createRoot(host);
    root.render(
      React.createElement(DocxEditor, {
        source: { sfdt },
        reviewChanges: true,
        onEditorReady: (value: any) => {
          editor = value;
        },
        onReady: () => {
          rebindRevisionGroups(editor);
          ready = true;
        },
        onSave: async () => {
          saves++;
        },
        history: {
          listVersions: async () => [],
          closeVersion: async (_id, payload) => {
            if (!payload.changesJson) return null;
            const bytes = new Uint8Array(
              await payload.changesJson.arrayBuffer()
            );
            const stream = new Blob([bytes])
              .stream()
              .pipeThrough(new DecompressionStream('gzip'));
            artifacts.push(JSON.parse(await new Response(stream).text()));
            return null;
          },
          fetchVersionFile: async () => new ArrayBuffer(0),
          restoreVersion: async () => undefined,
          renameVersion: async () => {
            throw new Error('unused');
          }
        }
      })
    );
    for (let i = 0; i < 300; i++) {
      if (ready) break;
      await frame();
    }
    if (!ready) throw new Error(`Review editor not ready: ${host.textContent}`);
    for (let i = 0; i < 5; i++) await frame();
  },
  async suggestHistoryReview(edits: any[]) {
    setAssistantSessionActive(editor, true);
    const result = applyDocumentEdits(editor, {
      changeSetId: 'review-save',
      edits
    });
    setAssistantSessionActive(editor, false);
    for (let i = 0; i < 120; i++) {
      if (artifacts.length) break;
      await frame();
    }
    return result;
  },
  async historyReviewState() {
    for (let i = 0; i < 12; i++) await frame();
    return {
      saves,
      artifacts,
      sfdt: editor.serialize(),
      revisions: editor.revisions.changes.length,
      text: host?.textContent
    };
  },
  closeHistoryReview() {
    root?.unmount();
    root = undefined;
    host?.remove();
    host = undefined;
  }
};
