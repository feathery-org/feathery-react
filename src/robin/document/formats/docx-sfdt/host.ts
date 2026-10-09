/**
 * The live editor as the engine drives it (the core's `EditorHost`), around the document editor
 * instance the bindings already type as `SyncfusionEditorLike`. Undo goes through the editor's own
 * history; opening a document keeps the user's track-changes setting as it was.
 */
import type { SyncfusionEditorLike } from '../../../../elements/components/DocxEditor/bindings/editorAdapter';
import type { EditorHost } from '../../pack';
import { bindingCommandSurfaceFor } from '../../../../elements/components/DocxEditor/bindings/reconcileRegistry';

type Obj = Record<string, any>;

/** The parts of the editor instance the pack drives, beyond the bindings' own type. */
export type LiveEditor = SyncfusionEditorLike & {
  enableTrackChanges?: boolean;
  currentUser?: string;
  isReadOnly?: boolean;
  isReadOnlyMode?: boolean;
  documentEditorSettings?: {
    revisionSettings?: { customData?: string | null } & Obj;
  } & Obj;
  editorHistory?: Obj;
} & Obj;

export interface DocxHost extends EditorHost {
  readonly editor: LiveEditor;
}

export const historyOf = (editor: LiveEditor): Obj | undefined =>
  (editor.editorHistory ?? editor.editorHistoryModule) as Obj | undefined;

export function createHost(editor: LiveEditor): DocxHost {
  return {
    editor,
    serialize: () => editor.serialize(),
    open(native: string) {
      const tracking = editor.enableTrackChanges;
      editor.open(native);
      editor.enableTrackChanges = tracking;
      // the bindings re-read the replaced document as their baseline (no dispose and re-attach)
      bindingCommandSurfaceFor(editor)?.reopened?.();
    },
    canUndo: () => !!historyOf(editor)?.canUndo?.(),
    undo: () => historyOf(editor)?.undo?.(),
    canRedo: () => !!historyOf(editor)?.canRedo?.(),
    redo: () => historyOf(editor)?.redo?.(),
    readOnly: () => !!(editor.isReadOnly || editor.isReadOnlyMode)
  };
}
