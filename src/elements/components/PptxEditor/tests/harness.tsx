// Shared harness for PptxEditor React tests: mounts children inside a
// PptxEditorProvider and hands the test its per-instance store.

import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  PptxEditorProvider,
  usePptxEditorStore
} from '../state/PptxEditorContext';
import type { PptxEditorStore } from '../state/PptxEditorStore';

export const sampleBytes = (): Uint8Array =>
  new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/sample.pptx')));

export const fixtureBytes = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(resolve(__dirname, 'fixtures', name)));

function StoreTap({ onStore }: { onStore: (store: PptxEditorStore) => void }) {
  onStore(usePptxEditorStore());
  return null;
}

export interface Mounted {
  host: HTMLDivElement;
  root: Root;
  store: PptxEditorStore;
  unmount: () => Promise<void>;
}

/** Mount UI inside a provider; returns the host element and its store. */
export async function mountEditor(children: React.ReactNode): Promise<Mounted> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  let store: PptxEditorStore | null = null;
  await act(async () =>
    root.render(
      <PptxEditorProvider>
        <StoreTap
          onStore={(s) => {
            store = s;
          }}
        />
        {children}
      </PptxEditorProvider>
    )
  );
  if (!store) throw new Error('store not provided');
  return {
    host,
    root,
    store,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    }
  };
}

export { act };

/** Activate a toolbar tab (Option B tabbed toolbar) by its visible label. */
/** Open a toolbar dropdown menu (Insert, Slide, Table borders) if closed. */
export async function openMenu(
  host: HTMLElement,
  name: 'Insert' | 'Slide' | 'Table borders'
): Promise<void> {
  const btn = host.querySelector(
    `button[title="${name}"]`
  ) as HTMLButtonElement | null;
  if (!btn) throw new Error(`Toolbar menu "${name}" not found`);
  if (btn.getAttribute('aria-expanded') !== 'true')
    await act(async () => btn.click());
}
