import type { EditorHost } from '../../pack';
import type { PptxEditorStore } from '../../../../elements/components/PptxEditor/state/PptxEditorStore';
import { openDeck, serializeDeck } from './native';

export interface PptxHost extends EditorHost {
  store: PptxEditorStore;
}

// Robin edits through the editor store, the person's own edit path, so every change repaints
export function createHost(
  store: PptxEditorStore,
  { readOnly }: { readOnly: boolean }
): PptxHost {
  return {
    store,
    serialize: () => serializeDeck(store.engine),
    open: (native) => openDeck(store.engine, native),
    canUndo: () => store.engine.canUndo(),
    undo: () => store.undo(),
    canRedo: () => store.engine.canRedo(),
    redo: () => store.redo(),
    readOnly: () => readOnly,
    selection: () => {
      const { deck, activeSlide, selectedIds } = store.getState();
      return { slide: deck?.slides[activeSlide]?.path, shapes: selectedIds };
    },
    pages: () =>
      store.engine.readDeck()?.slides.map((slide) => slide.path) ?? null,
    resolveCards: (changeSetIds, accept) =>
      resolveSuggestions(store, changeSetIds, accept)
  };
}

/** Settle every pending suggestion of these cards, rejects newest first so each finds its slides as it left them */
function resolveSuggestions(
  store: PptxEditorStore,
  changeSetIds: string[],
  accept: boolean
): boolean {
  const suggestions = store.engine
    .changes()
    .filter(
      (record) =>
        record.status === 'pending' &&
        changeSetIds.includes(record.author.id ?? record.id)
    );
  if (!suggestions.length) return false;
  if (accept) {
    for (const suggestion of suggestions) store.acceptChange(suggestion.id);
    return true;
  }
  const newestFirst = [...suggestions].reverse();
  for (let done = 0; done < newestFirst.length; done++) {
    if (store.rejectChange(newestFirst[done].id).ok) continue;
    // Take back the rejects already made so the deck is as it was
    for (let i = 0; i < done; i++) store.undo();
    return false;
  }
  return true;
}
