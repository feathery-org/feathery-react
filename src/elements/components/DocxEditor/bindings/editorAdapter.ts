// The Syncfusion side of the controller's EditorPort.
//
// Value-only engine output is written with editorModule.updateContentControl,
// located by exact tag match over documentHelper.contentControlCollection. Two
// deliberate choices, both proven in the Phase 0 spikes:
//
//   - NOT Syncfusion's title-matched importContentControlData, whose
//     (type, title) matching collides whenever two controls share a title.
//   - NOT the selection + insertText primitive the assistant's document ops use.
//     selectContentControl followed by insertText DELETES the content control,
//     tag and all, locked or not. updateContentControl is the only write that
//     preserves the binding.
//
// History is the other half of the contract. Only 'field' writes - normalization
// of the cell the user just edited - are recorded, because a suppressed rewrite
// of a cell that has a live history entry corrupts that entry ("200" normalized
// invisibly to "$200.00" made one Ctrl+Z restore "$150.000.00"). Fan-out and
// formula writes stay invisible: recording them makes undo peel engine output
// instead of the user's edit, which the next reconcile immediately re-applies -
// an unwinnable undo/Enter loop.
//
// Everything runs in ONE synchronous turn, selection restore included. An async
// restore was tried and reverted: it yanked the caret out from under a user
// already typing in the next field when a commit trigger fired.

import { EngineWrite } from './core/engine';
import { EditorPort } from './controller';

export interface ContentControlLike {
  contentControlProperties?: { tag?: string; [key: string]: unknown };
  [key: string]: unknown;
}

/** The Syncfusion surface this module touches, including engine internals. */
export interface SyncfusionEditorLike {
  serialize(): string;
  open(sfdt: string): void;
  documentHelper?: {
    contentControlCollection?: ContentControlLike[];
    viewerContainer?: { scrollTop: number } | null;
    /** The hidden contenteditable the editor takes keystrokes through. */
    editableDiv?: HTMLElement;
    [key: string]: unknown;
  };
  editorModule?: {
    updateContentControl?: (
      control: ContentControlLike,
      value: string,
      reset?: boolean
    ) => void;
    handleTextInput?: (text: string) => void;
    [key: string]: unknown;
  };
  editorHistoryModule?: { isUndoing?: boolean; isRedoing?: boolean };
  selection?: {
    startOffset?: string;
    endOffset?: string;
    currentContentControl?: ContentControlLike | null;
    select?: (start: string, end: string) => void;
    [key: string]: unknown;
  };
  enableEditorHistory?: boolean;
  enableTrackChanges?: boolean;
  documentEditorSettings?: { optimizeSfdt?: boolean; [key: string]: unknown };
  [key: string]: unknown;
}

interface ViewSnapshot {
  caret?: string;
  host?: { scrollTop: number } | null;
  scrollTop?: number;
}

/**
 * Ask the editor for verbose SFDT.
 *
 * Syncfusion defaults optimizeSfdt to true, and minified SFDT renames every key
 * the binding engine reads, so a document that looks empty of bindings is the
 * symptom. Setting it at construction is the reliable fix (this cannot always
 * take effect afterwards); this returns whether the editor now reports the value
 * we need, so callers can fail loudly rather than silently read nothing.
 */
export function configureEditorForBindings(
  editor: SyncfusionEditorLike
): boolean {
  try {
    if (!editor.documentEditorSettings) return false;
    editor.documentEditorSettings.optimizeSfdt = false;
    return editor.documentEditorSettings.optimizeSfdt === false;
  } catch {
    return false;
  }
}

export function createEditorAdapter(editor: SyncfusionEditorLike): EditorPort {
  const controlsForTag = (
    collection: ContentControlLike[],
    tag: string
  ): ContentControlLike[] =>
    collection.filter(
      (control) =>
        control.contentControlProperties &&
        String(control.contentControlProperties.tag) === tag
    );

  return {
    serialize: () => editor.serialize(),
    open: (sfdt: string) => editor.open(sfdt),

    updateValues(writes: EngineWrite[]): boolean {
      const helper = editor.documentHelper;
      const editorModule = editor.editorModule;
      if (!helper || !editorModule || !editorModule.updateContentControl)
        return false;
      const collection = helper.contentControlCollection;
      if (!Array.isArray(collection)) return false;
      // Empty text would be replaced by the editor's placeholder string.
      if (writes.some((write) => !write.text)) return false;

      const previousHistory = editor.enableEditorHistory;
      const previousTracking = editor.enableTrackChanges;
      let selection: { start: string; end: string } | null = null;
      let scrollHost: { scrollTop: number } | null = null;
      let scrollTop: number | null = null;
      try {
        if (editor.selection?.startOffset) {
          selection = {
            start: editor.selection.startOffset,
            end: editor.selection.endOffset || editor.selection.startOffset
          };
        }
      } catch {
        selection = null;
      }
      try {
        scrollHost = helper.viewerContainer || null;
        if (scrollHost) scrollTop = scrollHost.scrollTop;
      } catch {
        scrollHost = null;
      }

      const apply = (list: EngineWrite[]): boolean => {
        for (const write of list) {
          const matches = controlsForTag(collection, write.tag);
          if (!matches.length) return false;
          for (const control of matches) {
            (
              editorModule.updateContentControl as (
                c: ContentControlLike,
                v: string
              ) => void
            )(control, write.text);
          }
        }
        return true;
      };

      try {
        // Reconciliation is mechanical normalization, not an authored edit, so
        // it must never author tracked-change revisions - those belong to the
        // user and to the assistant.
        editor.enableTrackChanges = false;
        if (!apply(writes.filter((write) => write.kind === 'field')))
          return false;
        editor.enableEditorHistory = false;
        if (!apply(writes.filter((write) => write.kind !== 'field')))
          return false;
        return true;
      } catch {
        return false;
      } finally {
        editor.enableEditorHistory = previousHistory;
        editor.enableTrackChanges = previousTracking;
        try {
          if (selection && editor.selection?.select)
            editor.selection.select(selection.start, selection.end);
        } catch {
          /* a failed restore must not fail the write */
        }
        try {
          if (scrollHost && scrollTop != null) scrollHost.scrollTop = scrollTop;
        } catch {
          /* same */
        }
      }
    },

    captureView(): ViewSnapshot {
      const view: ViewSnapshot = {};
      try {
        view.caret = editor.selection?.startOffset;
      } catch {
        /* nothing to capture */
      }
      try {
        const host = editor.documentHelper?.viewerContainer || null;
        if (host) {
          view.host = host;
          view.scrollTop = host.scrollTop;
        }
      } catch {
        /* nothing to capture */
      }
      return view;
    },

    restoreView(view: unknown): void {
      const snapshot = view as ViewSnapshot;
      // Deferred on purpose, and only here: this path follows a full open(),
      // which has already rebuilt the document and moved the caret, so there is
      // no in-flight typing to fight. The patch path restores synchronously.
      setTimeout(() => {
        try {
          if (snapshot.caret && editor.selection?.select)
            editor.selection.select(snapshot.caret, snapshot.caret);
        } catch {
          /* best effort */
        }
        try {
          if (snapshot.host && snapshot.scrollTop != null)
            snapshot.host.scrollTop = snapshot.scrollTop;
        } catch {
          /* best effort */
        }
      }, 60);
    }
  };
}
