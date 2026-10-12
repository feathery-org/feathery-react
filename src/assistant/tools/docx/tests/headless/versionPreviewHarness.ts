// Exercise the actual React preview and pinned engine, including deferred
// layout/scroll work that a mocked DocumentEditor cannot reproduce.
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { DocumentEditorContainer } from '@syncfusion/ej2-documenteditor';
import VersionViewer from '../../../../../elements/components/DocxEditor/history/VersionViewer';

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let editor: any;
let props: any;
let displayed = 0;

const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const snapshot = () => {
  const helper = editor.documentHelper;
  const canvas = helper.containerCanvas as HTMLCanvasElement;
  const context = canvas.getContext('2d');
  if (!context || !host) throw new Error('Preview has no canvas');
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let ink = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (
      pixels[i + 3] &&
      Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 180
    )
      ink++;
  }
  let opacity = 1;
  for (
    let element: HTMLElement | null = canvas;
    element;
    element = element.parentElement
  ) {
    opacity *= Number(getComputedStyle(element).opacity);
  }
  return {
    top: helper.viewerContainer.scrollTop,
    left: helper.viewerContainer.scrollLeft,
    zoom: editor.zoomFactor,
    loading: host.textContent?.includes('Loading version') ?? false,
    opacity: String(opacity),
    ink
  };
};

export const versionPreviewHarness = {
  async openVersionPreview(sfdt: string) {
    root?.unmount();
    host?.remove();
    editor = undefined;
    displayed = 0;
    (globalThis as any).ej = { documenteditor: { DocumentEditorContainer } };
    host = globalThis.document.createElement('div');
    host.style.cssText =
      'position:fixed;inset:0;width:1000px;height:800px;background:white';
    globalThis.document.body.appendChild(host);
    props = {
      host: {},
      version: { id: 'scroll-preview', authors: [] },
      liveDoc: { sfdt, loading: false, error: false, degraded: false },
      zoomFactor: 1.25,
      onViewerEditor: (value: any) => {
        editor = value;
      },
      onDisplayedVersion: () => {
        displayed++;
      }
    };
    root = createRoot(host);
    root.render(React.createElement(VersionViewer, props));
    for (let i = 0; i < 300; i++) {
      if (displayed) break;
      await frame();
    }
    if (!displayed) throw new Error('Preview did not open');
    for (let i = 0; i < 15; i++) await frame();
    editor.documentHelper.viewerContainer.scrollTop = 1400;
    editor.documentHelper.viewerContainer.scrollLeft = 35;
    for (let i = 0; i < 8; i++) await frame();
    return snapshot();
  },

  async toggleVersionPreview(highlightsOn: boolean) {
    if (!root) throw new Error('Preview is not mounted');
    const prior = displayed;
    root.render(React.createElement(VersionViewer, { ...props, highlightsOn }));
    const frames = [];
    for (let i = 0; i < 24; i++) {
      await frame();
      frames.push(snapshot());
    }
    if (displayed <= prior) throw new Error('Preview did not toggle');
    return { frames, sfdt: editor.serialize() };
  },

  closeVersionPreview() {
    root?.unmount();
    root = undefined;
    host?.remove();
    host = undefined;
  }
};
