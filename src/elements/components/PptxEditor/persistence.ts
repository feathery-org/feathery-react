import type { PptxEditorStore } from './state/PptxEditorStore';

// Persist edits made while a save is in flight before allowing a tab switch.
export async function savePresentation(
  store: PptxEditorStore,
  save: (blob: Blob) => unknown | Promise<unknown>
) {
  const deck = store.getState().deck;
  do {
    store.commitSvgTextEdit?.({ render: false });
    const savePoint = store.engine.savePoint();
    await save(store.engine.exportPptx());
    if (store.getState().deck !== deck) return;
    store.markSaved(savePoint);
    store.commitSvgTextEdit?.({ render: false });
  } while (store.engine.isDirty());
}
