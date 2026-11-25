// A Robin turn that never settles, on the full editing surface: what reaches
// the host's save and the version-history backend while it hangs.
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { registerLicense } from '@syncfusion/ej2-base';
import {
  DocumentEditorContainer,
  Toolbar
} from '@syncfusion/ej2-documenteditor';
import DocxEditor from '../../..';
import { setRobinTurnActive, whileRobinWrites } from '../../../robinActivity';
import {
  __clearVersionDocumentCache,
  useVersionDocument
} from '../../useVersionDocument';
import { DocxHistoryHost, DocxVersion } from '../../types';

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let editor: any;
let ready = false;
let saves: Array<{ closeSession: boolean; sessionId: string }>;
let lastDocx: Blob | null;
let checkpoints: Array<{ sessionId: string; hasChanges: boolean }>;
// The backend's open row: each upload replaces both artifacts.
let row: {
  sessionId: string;
  finalGz: ArrayBuffer;
  changesGz: ArrayBuffer | null;
  finalSha256: string;
} | null;

const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
const gunzip = async (bytes: ArrayBuffer) =>
  new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  ).text();

export const frozenTurnHarness = {
  async openFrozenTurn(sfdt: string) {
    root?.unmount();
    host?.remove();
    editor = undefined;
    ready = false;
    saves = [];
    lastDocx = null;
    checkpoints = [];
    row = null;
    (globalThis as any).ej = {
      base: { registerLicense },
      documenteditor: { DocumentEditorContainer, Toolbar }
    };
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
        onEditorReady: (value: any) => {
          editor = value;
        },
        onReady: () => {
          ready = true;
        },
        onSave: async (blob, meta) => {
          saves.push({
            closeSession: !!meta?.closeSession,
            sessionId: meta?.sessionId ?? ''
          });
          lastDocx = blob;
        },
        history: {
          listVersions: async () => [],
          closeVersion: async (sessionId, payload) => {
            checkpoints.push({ sessionId, hasChanges: !!payload.changesJson });
            row = {
              sessionId,
              finalGz: await payload.finalSfdtGz.arrayBuffer(),
              changesGz: payload.changesJson
                ? await payload.changesJson.arrayBuffer()
                : null,
              finalSha256: payload.finalSha256
            };
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
    for (let i = 0; i < 600 && !ready; i++) await tick();
    if (!ready) throw new Error(`Editor not ready: ${host.textContent}`);
    await tick(300);
  },
  personTypes(text: string) {
    editor.selection.moveToDocumentEnd();
    editor.editor.insertText(text);
  },
  robinTurnStarts() {
    setRobinTurnActive(editor, true);
  },
  robinWrites(text: string) {
    whileRobinWrites(editor, () => {
      editor.selection.moveToDocumentEnd();
      editor.editor.insertText(text);
    });
  },
  // Resolves once both the DOCX save and the checkpoint upload have landed.
  async waitForSaves(count: number, timeoutMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (saves.length >= count && checkpoints.length >= count) return true;
      await tick(100);
    }
    return false;
  },
  async frozenTurnState() {
    let docxBase64 = '';
    if (lastDocx) {
      const bytes = new Uint8Array(await lastDocx.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i++)
        binary += String.fromCharCode(bytes[i]);
      docxBase64 = btoa(binary);
    }
    return {
      saves,
      checkpoints,
      docxBase64,
      liveText: editor.serialize() as string,
      storedFinal: row ? await gunzip(row.finalGz) : null
    };
  },
  // The tab is lost: open Current version from what the backend stored.
  async currentVersionAfterReload() {
    root?.unmount();
    root = undefined;
    host?.remove();
    host = undefined;
    __clearVersionDocumentCache();
    if (!row) throw new Error('No checkpoint was stored');
    const stored = row;
    const files: Record<string, ArrayBuffer | null> = {
      final: stored.finalGz,
      changes: stored.changesGz
    };
    const reloaded: DocxHistoryHost = {
      listVersions: async () => [],
      closeVersion: async () => null,
      fetchVersionFile: async (url: string) => files[url] ?? new ArrayBuffer(0),
      restoreVersion: async () => undefined,
      renameVersion: async () => {
        throw new Error('unused');
      }
    };
    const current = {
      id: 'current',
      session_id: stored.sessionId,
      is_current: true,
      final_sfdt: 'final',
      changes: stored.changesGz ? 'changes' : null,
      change_count: stored.changesGz ? 1 : null,
      format_change_count: null,
      final_sha256: stored.finalSha256
    } as unknown as DocxVersion;
    let result: any = null;
    const Probe = () => {
      const doc = useVersionDocument(reloaded, current);
      if (!doc.loading) result = doc;
      return null;
    };
    const probeHost = globalThis.document.createElement('div');
    globalThis.document.body.appendChild(probeHost);
    const probeRoot = createRoot(probeHost);
    probeRoot.render(React.createElement(Probe));
    for (let i = 0; i < 200 && !result; i++) await tick();
    probeRoot.unmount();
    probeHost.remove();
    return result
      ? { sfdt: result.sfdt ?? null, degraded: result.degraded }
      : null;
  },
  closeFrozenTurn() {
    root?.unmount();
    root = undefined;
    host?.remove();
    host = undefined;
  }
};
