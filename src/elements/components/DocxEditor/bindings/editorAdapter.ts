// Syncfusion adapter for exact-tag content-control writes. RichText uses an
// internal mark-exclusive selection so the binding survives and its paragraph
// format remains byte-stable. Authored batches track derived writes; mechanical
// reconciliation does not. Selection and scroll restoration are synchronous.

import { EngineWrite } from './core/engine';
import type { NativeStructuralMutation } from './core/sfdtAdapter';
import { EditorPort } from './controller';
import type { BindingCommandProvenance } from './reconcileRegistry';
import {
  adoptRevisionsIntoAuthorsCard,
  preserveDocumentViewDuring,
  revisionGroupTag,
  snapshotRevisions
} from '../../../../utils/documentEditorPrimitives';
import { anchorCaret, CaretAnchor, resolveAnchor } from './controlGeometry';
import { applyNativeStructuralMutations } from './nativeStructuralAdapter';

export interface ContentControlLike {
  contentControlProperties?: { tag?: string; [key: string]: unknown };
  [key: string]: unknown;
}

interface ScrollHost {
  scrollTop: number;
  scrollLeft: number;
}

/** The Syncfusion surface this module touches, including engine internals. */
export interface SyncfusionEditorLike {
  serialize(): string;
  open(sfdt: string): void;
  documentHelper?: {
    contentControlCollection?: ContentControlLike[];
    viewerContainer?: ScrollHost | null;
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
    insertText?: (text: string) => void;
    handleTextInput?: (text: string) => void;
    [key: string]: unknown;
  };
  /**
   * Also reachable as `editor.editorHistory` - that is a getter for this same
   * object, so patching here is seen by the toolbar and by Ctrl+Z alike.
   */
  editorHistoryModule?: {
    isUndoing?: boolean;
    isRedoing?: boolean;
    [key: string]: unknown;
  };
  selection?: {
    startOffset?: string;
    endOffset?: string;
    currentContentControl?: ContentControlLike | null;
    select?: (start: string, end: string) => void;
    /** Selects the control's contents, boundary marks excluded. */
    selectContentControlInternal?: (control: ContentControlLike) => void;
    /** Paragraph + offset -> the "0;2;1;1;0;3" form select() takes. */
    getHierarchicalIndex?: (paragraph: unknown, offset: string) => string;
    /** The caret's start position; read for its paragraph identity. */
    start?: { paragraph?: unknown; [key: string]: unknown };
    [key: string]: unknown;
  };
  enableEditorHistory?: boolean;
  enableTrackChanges?: boolean;
  currentUser?: string;
  documentEditorSettings?: { optimizeSfdt?: boolean; [key: string]: unknown };
  [key: string]: unknown;
}

interface ViewSnapshot {
  caret?: string;
  host?: ScrollHost | null;
  scrollTop?: number;
  scrollLeft?: number;
}

/**
 * The author of the pending INSERTION a control sits inside, if any: the row
 * that holds it, the paragraph mark, or the control's own boundary marks carry
 * an Insertion revision. Undefined when the control is in settled content. See
 * updateValues on why a write into such a place is authored as that insertion.
 */
export function pendingInsertionAuthorAround(
  control: ContentControlLike
): string | undefined {
  const insertionAuthor = (revisions: unknown): string | undefined => {
    if (!Array.isArray(revisions)) return undefined;
    const insertion = revisions.find(
      (revision: any) => revision?.revisionType === 'Insertion'
    );
    return insertion ? String(insertion.author ?? '') : undefined;
  };
  const start = control as any;
  const end = start?.reference;
  const own =
    insertionAuthor(start?.revisions) ?? insertionAuthor(end?.revisions);
  if (own !== undefined) return own;
  const seen = new Set<unknown>();
  let inline = start?.nextNode;
  while (inline && inline !== end && !seen.has(inline)) {
    seen.add(inline);
    const author = insertionAuthor(inline.revisions);
    if (author !== undefined) return author;
    inline = inline.nextNode;
  }
  const paragraph = start?.line?.paragraph;
  const mark = insertionAuthor(paragraph?.characterFormat?.revisions);
  if (mark !== undefined) return mark;
  let row = paragraph?.associatedCell?.ownerRow;
  while (row) {
    const rowAuthor = insertionAuthor(row.rowFormat?.revisions);
    if (rowAuthor !== undefined) return rowAuthor;
    // A table inside a cell: the enclosing row may be the pending one.
    row = row.ownerTable?.containerWidget?.ownerRow;
  }
  return undefined;
}

/** Exclude controls whose widgets were detached by a structural command. */
export function isContentControlAttached(control: ContentControlLike): boolean {
  const line = control.line as
    | { paragraph?: Record<string, unknown> }
    | undefined;
  let widget: Record<string, unknown> | undefined = line?.paragraph;
  // Stubs and controls we have not laid out have no widget tree; keep them.
  if (!widget) return true;
  const seen = new Set<Record<string, unknown>>();
  while (widget) {
    if (seen.has(widget)) return false;
    seen.add(widget);
    // A text frame (the body of a text box) hangs off the shape element on a
    // line of the anchoring paragraph, not off a container widget; its own
    // indexInOwner reads -1. Continue the walk from that paragraph.
    const shape = widget.containerShape as
      | { line?: { paragraph?: Record<string, unknown> } }
      | undefined;
    if (shape) {
      const anchoring = shape.line?.paragraph;
      if (!anchoring) return false;
      widget = anchoring;
      continue;
    }
    // Header/footer widgets are attached roots despite indexInOwner === -1.
    if (typeof widget.headerFooterType === 'string') return true;
    if (widget.indexInOwner === -1) return false;
    const parent = widget.containerWidget as
      | Record<string, unknown>
      | undefined;
    if (!parent) return true;
    widget = parent;
  }
  return true;
}

/**
 * Run with Syncfusion's canEditContentControl gate forced open. The gate makes
 * every command touching a locked control return silently; callers assert the
 * operation is a deliberate whole-control one (table delete, history replay).
 */
export function withContentControlLocksBypassed<T>(
  module: object,
  run: () => T
): T {
  const hadOwn = Object.prototype.hasOwnProperty.call(
    module,
    'canEditContentControl'
  );
  const previous = hadOwn
    ? Object.getOwnPropertyDescriptor(module, 'canEditContentControl')
    : undefined;
  Object.defineProperty(module, 'canEditContentControl', {
    configurable: true,
    enumerable: true,
    get: () => true
  });
  try {
    return run();
  } finally {
    if (hadOwn && previous)
      Object.defineProperty(module, 'canEditContentControl', previous);
    else
      delete (module as { canEditContentControl?: unknown })
        .canEditContentControl;
  }
}

/** Drop content controls whose widgets were removed by a table-clone command. */
export function pruneDetachedContentControls(
  editor: SyncfusionEditorLike
): void {
  const collection = editor.documentHelper?.contentControlCollection;
  if (!Array.isArray(collection)) return;
  for (let i = collection.length - 1; i >= 0; i--) {
    if (!isContentControlAttached(collection[i])) collection.splice(i, 1);
  }
}

/**
 * Prune detached entries, then restore DOCUMENT ORDER in the content control
 * collection. Undo re-registers restored controls at the END of the
 * collection, but Syncfusion's lookups assume document order — the
 * getContentControls scan early-breaks at the first control past the caret,
 * so an out-of-order entry is never found: selection.currentContentControl
 * returns undefined and the control loses its chrome, its lock, and the
 * engine's writes. Verified live: re-sorting alone restores all three.
 */
export function normalizeContentControlCollection(
  editor: SyncfusionEditorLike
): void {
  pruneDetachedContentControls(editor);
  const collection = editor.documentHelper?.contentControlCollection;
  const selection = editor.selection as any;
  if (
    !Array.isArray(collection) ||
    typeof selection?.getPosition !== 'function'
  )
    return;
  const positioned = collection.map((control) => {
    try {
      return {
        control,
        position: selection.getPosition(control, true)?.startPosition ?? null
      };
    } catch {
      return { control, position: null };
    }
  });
  const comparePosition = (
    a: typeof positioned[number],
    b: typeof positioned[number]
  ) => {
    if (!a.position || !b.position) return 0;
    try {
      if (a.position.isAtSamePosition(b.position)) return 0;
      return a.position.isExistBefore(b.position) ? -1 : 1;
    } catch {
      return 0;
    }
  };
  const headers = positioned.filter(
    ({ control }) => !!(control as any)?.paragraph?.isInHeaderFooter
  );
  const body = positioned.filter(
    ({ control }) => !(control as any)?.paragraph?.isInHeaderFooter
  );
  body.sort(comparePosition);
  collection.splice(
    0,
    collection.length,
    ...headers.map(({ control }) => control),
    ...body.map(({ control }) => control)
  );
}

export function refreshContentControlCollection(
  editor: SyncfusionEditorLike
): void {
  const live = editor as any;
  const layout = live.documentHelper?.layout;
  if (typeof layout?.layoutWholeDocument !== 'function') return;
  const layoutWasOn = live.enableLayout === true;
  if (!layoutWasOn) live.setProperties?.({ enableLayout: true }, true);
  try {
    layout.layoutWholeDocument();
  } finally {
    if (!layoutWasOn) live.setProperties?.({ enableLayout: false }, true);
  }
  normalizeContentControlCollection(editor);
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

let authoredDepth = 0;

let adapterWriteDepth = 0;
/** Distinguish adapter selection moves from the user's caret changes. */
export function isAdapterWriting(): boolean {
  return adapterWriteDepth > 0;
}

export function createEditorAdapter(editor: SyncfusionEditorLike): EditorPort {
  // The deferred restore below outlives the synchronous call. On a step-back the
  // editor is destroyed before it fires; tracking it lets dispose() cancel it so
  // it never reads selection on a torn-down instance.
  let pendingRestoreTimer: ReturnType<typeof setTimeout> | null = null;

  const controlsForTag = (
    collection: ContentControlLike[],
    tag: string
  ): ContentControlLike[] =>
    collection.filter(
      (control) =>
        isContentControlAttached(control) &&
        control.contentControlProperties &&
        String(control.contentControlProperties.tag) === tag
    );

  return {
    serialize: () => editor.serialize(),
    open: (sfdt: string) => editor.open(sfdt),
    applyStructuralMutations: (mutations: NativeStructuralMutation[]) => {
      // Native structural commands borrow the selection and restore it.
      adapterWriteDepth += 1;
      try {
        return preserveDocumentViewDuring(editor as any, () =>
          applyNativeStructuralMutations(editor, mutations)
        );
      } finally {
        adapterWriteDepth -= 1;
      }
    },

    /** Borrow tracking, author, and group metadata for one authored batch. */
    withAuthoredRevisions<T>(
      provenance: BindingCommandProvenance,
      run: () => T
    ): T {
      const settings = editor.documentEditorSettings as
        | { revisionSettings?: { customData?: string } }
        | undefined;
      const revisionSettings = settings?.revisionSettings;
      const priorTracking = editor.enableTrackChanges;
      const priorUser = (editor as any).currentUser;
      const priorCustomData = revisionSettings?.customData;
      authoredDepth += 1;
      try {
        editor.enableTrackChanges = true;
        (editor as any).currentUser = provenance.author;
        // Editors without `revisionSettings` (test doubles) go ungrouped, as
        // they do on the older seam. Grouping is a review affordance; the
        // authorship and the undoability are the load-bearing parts.
        if (revisionSettings)
          revisionSettings.customData = revisionGroupTag(
            provenance.changeSetId,
            provenance.group
          );
        return run();
      } finally {
        authoredDepth -= 1;
        editor.enableTrackChanges = priorTracking;
        (editor as any).currentUser = priorUser;
        if (revisionSettings) revisionSettings.customData = priorCustomData;
      }
    },

    updateValues(writes: EngineWrite[]): boolean {
      const helper = editor.documentHelper;
      const editorModule = editor.editorModule;
      if (!helper || !editorModule || !editorModule.updateContentControl)
        return false;
      pruneDetachedContentControls(editor);
      const collection = helper.contentControlCollection;
      if (!Array.isArray(collection)) return false;
      // Empty text would be replaced by the editor's placeholder string.
      const applicableWrites = writes.filter((write) => !!write.text);
      if (!applicableWrites.length) return false;

      const previousHistory = editor.enableEditorHistory;
      const history = editor.editorHistoryModule as any;
      const fieldWrites = applicableWrites.filter(
        (write) => write.kind === 'field'
      );
      let complex = false;
      let selection: { start: string; end: string } | null = null;
      // Where the caret sits WITHIN its control, which survives the control
      // changing length; the absolute offset below does not.
      let anchor: CaretAnchor | null = null;
      let scrollHost: ScrollHost | null = null;
      let scrollTop: number | null = null;
      let scrollLeft: number | null = null;
      try {
        if (editor.selection?.startOffset) {
          selection = {
            start: editor.selection.startOffset,
            end: editor.selection.endOffset || editor.selection.startOffset
          };
        }
        anchor = anchorCaret(editor);
      } catch {
        selection = null;
      }
      try {
        scrollHost = helper.viewerContainer || null;
        if (scrollHost) {
          scrollTop = scrollHost.scrollTop;
          scrollLeft = scrollHost.scrollLeft;
        }
      } catch {
        scrollHost = null;
      }

      const writeControl = (control: ContentControlLike, text: string) => {
        const type = (
          control.contentControlProperties as { type?: string } | undefined
        )?.type;
        const selectInterior = editor.selection?.selectContentControlInternal;
        const insertText = editorModule.insertText;
        if (type === 'RichText' && selectInterior && insertText) {
          // See the header: RichText is the type updateContentControl PASTES.
          selectInterior.call(editor.selection, control);
          insertText.call(editorModule, text);
          return;
        }
        (
          editorModule.updateContentControl as (
            c: ContentControlLike,
            v: string
          ) => void
        )(control, text);
      };
      const apply = (list: EngineWrite[]): boolean => {
        for (const write of list) {
          const matches = controlsForTag(collection, write.tag);
          for (const control of matches) writeControl(control, write.text);
        }
        return true;
      };
      const allWrites = [
        ...fieldWrites,
        ...applicableWrites.filter((write) => write.kind !== 'field')
      ];
      if (
        allWrites.some((write) => !controlsForTag(collection, write.tag).length)
      )
        return false;

      adapterWriteDepth += 1;
      try {
        // Mechanical reconciliation is untracked; authored scopes own tracking.
        if (!authoredDepth) editor.enableTrackChanges = false;
        // Authored derived writes share one history group with their cause.
        const groupedWrites = authoredDepth
          ? applicableWrites.length
          : fieldWrites.length;
        if (
          groupedWrites > 1 &&
          typeof (editorModule as any).initComplexHistory === 'function'
        ) {
          (editorModule as any).initComplexHistory('BindingValues');
          complex = true;
        }
        if (!apply(fieldWrites)) return false;
        if (!authoredDepth) editor.enableEditorHistory = false;
        // Formula output caused by an authored batch is reviewable too. If the
        // formula already sits in a pending insertion, keep updating that same
        // insertion identity instead of layering a second card onto one run.
        // Mechanical reconciles stay untracked except inside a pending
        // insertion, where a plain write would break rejection of that range.
        const derivedWrites = applicableWrites.filter(
          (write) => write.kind !== 'field'
        );
        const priorTrackingForDerived = editor.enableTrackChanges;
        const priorUserForDerived = editor.currentUser;
        const priorHistoryForDerived = editor.enableEditorHistory;
        try {
          for (const write of derivedWrites) {
            const matches = controlsForTag(collection, write.tag);
            for (const control of matches) {
              const insertionAuthor = pendingInsertionAuthorAround(control);
              if (insertionAuthor !== undefined) {
                editor.enableTrackChanges = true;
                editor.enableEditorHistory = true;
                editor.currentUser = insertionAuthor;
                // The SDK may mint a new revision for the rewritten run; it
                // belongs to the insertion's card (adoptRevisionsIntoAuthorsCard).
                const before = new Set(snapshotRevisions(editor as any));
                writeControl(control, write.text);
                adoptRevisionsIntoAuthorsCard(
                  editor as any,
                  snapshotRevisions(editor as any).filter((r) => !before.has(r))
                );
                continue;
              }
              editor.enableTrackChanges = authoredDepth > 0;
              editor.enableEditorHistory = authoredDepth
                ? true
                : priorHistoryForDerived;
              editor.currentUser = priorUserForDerived;
              writeControl(control, write.text);
            }
          }
        } finally {
          editor.enableTrackChanges = priorTrackingForDerived;
          editor.enableEditorHistory = priorHistoryForDerived;
          editor.currentUser = priorUserForDerived;
        }
        return true;
      } catch {
        return false;
      } finally {
        adapterWriteDepth -= 1;
        if (complex) history?.updateComplexHistory?.();
        editor.enableEditorHistory = previousHistory;
        if (!authoredDepth) editor.enableTrackChanges = false;
        try {
          // Prefer the anchored position. Normalizing "0012" to "12" shrinks the
          // control's interior by two offsets, so the saved absolute offset -
          // unchanged, and therefore looking correct - now points at the closing
          // boundary, OUTSIDE the binding. The caret appears not to have moved
          // while the next character silently lands outside the field.
          const anchored = anchor ? resolveAnchor(editor, anchor) : null;
          if (anchored && editor.selection?.select)
            editor.selection.select(anchored, anchored);
          else if (selection && editor.selection?.select)
            editor.selection.select(selection.start, selection.end);
        } catch {
          /* a failed restore must not fail the write */
        }
        try {
          if (scrollHost && scrollTop != null) scrollHost.scrollTop = scrollTop;
          if (scrollHost && scrollLeft != null)
            scrollHost.scrollLeft = scrollLeft;
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
          view.scrollLeft = host.scrollLeft;
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
      //
      // "No in-flight typing" holds only until the user does something in the
      // 60ms. Read where open() left the caret now, and defer to whoever moved
      // it since - a click into a cell during the gap must not be undone by a
      // stale offset from before the reload.
      let caretAfterOpen: string | undefined;
      try {
        caretAfterOpen = editor.selection?.startOffset;
      } catch {
        caretAfterOpen = undefined;
      }
      if (pendingRestoreTimer != null) clearTimeout(pendingRestoreTimer);
      pendingRestoreTimer = setTimeout(() => {
        pendingRestoreTimer = null;
        try {
          const caretNow = editor.selection?.startOffset;
          if (
            snapshot.caret &&
            caretNow === caretAfterOpen &&
            editor.selection?.select
          )
            editor.selection.select(snapshot.caret, snapshot.caret);
        } catch {
          /* best effort */
        }
        try {
          if (snapshot.host && snapshot.scrollTop != null)
            snapshot.host.scrollTop = snapshot.scrollTop;
          if (snapshot.host && snapshot.scrollLeft != null)
            snapshot.host.scrollLeft = snapshot.scrollLeft;
        } catch {
          /* best effort */
        }
      }, 60);
    },

    dispose(): void {
      if (pendingRestoreTimer != null) {
        clearTimeout(pendingRestoreTimer);
        pendingRestoreTimer = null;
      }
    }
  };
}
