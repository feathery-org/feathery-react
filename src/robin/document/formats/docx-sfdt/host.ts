/**
 * The live editor as the engine drives it (the core's `EditorHost`), around the document editor
 * instance the bindings already type as `SyncfusionEditorLike`. Undo goes through the editor's own
 * history; opening a document keeps the user's track-changes setting and scroll position as they were.
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

/**
 * The editor's export of a whole document, less `lastParagraphMarkCopied`: a flag for pasting a
 * selection (it says the copy ends with a paragraph mark) that the editor also writes on a whole
 * document once it has been reopened, when the document ends in a plain paragraph (troy-1,
 * measured: a reopened document differs from its first load by that key alone). A whole export
 * carries it only at the root, once.
 */
const FLAG = '"lastParagraphMarkCopied":true';
export function wholeDocument(bytes: string): string {
  const at = bytes.indexOf(FLAG);
  if (at < 0 || bytes.indexOf(FLAG, at + 1) >= 0) return bytes;
  if (bytes[at + FLAG.length] === ',')
    return bytes.slice(0, at) + bytes.slice(at + FLAG.length + 1);
  if (bytes[at - 1] === ',')
    return bytes.slice(0, at - 1) + bytes.slice(at + FLAG.length);
  return bytes;
}

/** The values the editor derives from laying a document out: cell widths and table grids. */
const LAID_OUT = /"cellWidth":-?[\d.eE+-]+|"grid":\[[\d.eE+,\s-]*\]/g;

/**
 * Whether two exports differ only in laid-out values: the editor recomputes cell widths and table
 * grids each time it opens a document, and its open and export are not a fixed point for them
 * (troy-1, measured on a 30-page proposal: each reopen moves some percent-width tables' laid-out
 * widths by under a point and changes nothing else).
 */
export function layoutOnly(a: string, b: string): boolean {
  return a.replace(LAID_OUT, '') === b.replace(LAID_OUT, '');
}

export function createHost(editor: LiveEditor): DocxHost {
  return {
    editor,
    serialize: () => wholeDocument(editor.serialize()),
    open(native: string) {
      const tracking = editor.enableTrackChanges;
      // opening lays the document out from page 1 with the caret at its start: the person keeps
      // their caret and the place they were reading (restored last, after the bindings' re-read,
      // whose selection changes scroll to the caret)
      const viewer = editor.documentHelper?.viewerContainer as
        | HTMLElement
        | undefined;
      const place = viewer && {
        top: viewer.scrollTop,
        left: viewer.scrollLeft
      };
      const selection = editor.selection as Obj | undefined;
      const caret =
        typeof selection?.startOffset === 'string'
          ? { start: selection.startOffset, end: selection.endOffset }
          : null;
      editor.open(native);
      editor.enableTrackChanges = tracking;
      // the bindings re-read the replaced document as their baseline (no dispose and re-attach)
      bindingCommandSurfaceFor(editor)?.reopened?.();
      if (caret)
        try {
          (editor.selection as Obj).select(caret.start, caret.end);
        } catch {
          // the caret's place is gone from the new document: it stays at the start
        }
      if (viewer && place) {
        viewer.scrollTop = place.top;
        viewer.scrollLeft = place.left;
      }
    },
    canUndo: () => !!historyOf(editor)?.canUndo?.(),
    undo: () => historyOf(editor)?.undo?.(),
    canRedo: () => !!historyOf(editor)?.canRedo?.(),
    redo: () => historyOf(editor)?.redo?.(),
    readOnly: () => !!(editor.isReadOnly || editor.isReadOnlyMode),
    selection: () => {
      const selection = editor.selection as Obj | undefined;
      if (
        typeof selection?.startOffset !== 'string' ||
        typeof selection?.endOffset !== 'string'
      )
        return null;
      return {
        start: selection.startOffset,
        end: selection.endOffset,
        text: typeof selection.text === 'string' ? selection.text : ''
      };
    }
  };
}
