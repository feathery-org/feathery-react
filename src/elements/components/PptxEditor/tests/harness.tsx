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
export async function switchTab(
  host: HTMLElement,
  label: 'Home' | 'Insert' | 'Slide' | 'Arrange' | 'Table'
): Promise<void> {
  const tab = Array.from(host.querySelectorAll('[role="tab"]')).find(
    (el) => el.textContent === label
  ) as HTMLButtonElement | undefined;
  if (!tab) throw new Error(`Toolbar tab "${label}" not found`);
  await act(async () => tab.click());
}
