import type { PptxEditorStore } from './state/PptxEditorStore';

// Persist edits made while a save is in flight before allowing a tab switch.
export async function savePresentation(
  store: PptxEditorStore,
  save: (blob: Blob) => unknown | Promise<unknown>
) {
  do {
    store.commitSvgTextEdit?.({ render: false });
    const revision = store.engine.snapshot().revision;
    await save(store.engine.exportPptx());
    store.commitSvgTextEdit?.({ render: false });
    if (store.engine.snapshot().revision === revision) store.markSaved();
  } while (store.engine.isDirty());
}
