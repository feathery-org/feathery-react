// React glue for the per-instance store: a provider that owns one store for the
// lifetime of a mounted PptxEditor, and hooks that read it through
// useSyncExternalStore so React always sees a consistent snapshot.

import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore
} from 'react';
import {
  createPptxEditorStore,
  PptxEditorStore,
  type PptxEditorState
} from './PptxEditorStore';

const PptxEditorContext = createContext<PptxEditorStore | null>(null);

export function PptxEditorProvider({
  children
}: {
  children: React.ReactNode;
}) {
  const storeRef = useRef<PptxEditorStore | null>(null);
  if (!storeRef.current) storeRef.current = createPptxEditorStore();
  useEffect(() => {
    // The store's document, history and object URLs die with the provider.
    // The store itself survives a StrictMode remount; the editor's load
    // effect re-populates it.
    const store = storeRef.current;
    return () => store?.dispose();
  }, []);
  return (
    <PptxEditorContext.Provider value={storeRef.current}>
      {children}
    </PptxEditorContext.Provider>
  );
}

/** The instance store: actions, engine and live (non-reactive) refs. */
export function usePptxEditorStore(): PptxEditorStore {
  const store = useContext(PptxEditorContext);
  if (!store)
    throw new Error('PptxEditor components need a <PptxEditorProvider>.');
  return store;
}

/** Reactive editor state snapshot (whole-state; components destructure). */
export function usePptxEditorState(): PptxEditorState {
  const store = usePptxEditorStore();
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
