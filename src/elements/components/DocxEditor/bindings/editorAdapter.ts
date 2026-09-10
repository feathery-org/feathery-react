// The Syncfusion side of the controller's EditorPort.
//
// Value-only engine output is written INSIDE the control, located by exact tag
// match over documentHelper.contentControlCollection: select the control's
// interior with selection.selectContentControlInternal (the SDK's own
// mark-exclusive selection, the one its Text/Date writes use), then insertText.
// Three deliberate choices, all measured on this SDK:
//
//   - NOT Syncfusion's title-matched importContentControlData, whose
//     (type, title) matching collides whenever two controls share a title.
//   - NOT the PUBLIC selection.selectContentControl + insertText. That selection
//     spans the boundary marks themselves, so the replace DELETES the content
//     control, tag and all, locked or not (lockContents.spec). The internal
//     selection stops at the marks; the write lands between them and the
//     binding survives (also lockContents.spec).
//   - NOT editorModule.updateContentControl for RichText controls. For that
//     type it is a PASTE of a one-block document merged into the cell's
//     paragraph, and the merge stamps every paragraph-format default
//     explicitly (borders, indents, outline level). Semantically a no-op, but
//     the serialized document is never again byte-identical to what the author
//     uploaded, and a review card's reject can no longer prove it restored the
//     document - because the formula cells it recomputed differ in bytes it
//     never meant to touch. insertText leaves the paragraph format alone
//     (measured: the same value written back yields the identical file).
//     updateContentControl stays the write for every other control type; it is
//     the SDK's per-type dispatcher and RichText is the one type it pastes.
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

/**
 * The scroll container. BOTH axes matter: every write selects its target, and
 * selectRange scrolls that target into view, which sets scrollLeft as readily as
 * scrollTop (viewer.js scrollToPosition). Putting only scrollTop back leaves the
 * page horizontally offset - the document visibly shifts sideways after a value
 * updates.
 */
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
 * True when the control is still in the live document tree. deleteRow does
 * not drop widgets from contentControlCollection, so a deleted row's tags
 * stay findable and steal later writes.
 */
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
    // A header or footer is a root of its own: it is not a child of anything
    // (indexInOwner reads -1) and no content edit removes it. Its controls are
    // as attached as the body's. Measured 2026-09-09 without this: the first
    // recompute after a resolve pruned every header control from the
    // collection, and the header bindings went dark.
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
  positioned.sort((a, b) => {
    if (!a.position || !b.position) return 0;
    try {
      if (a.position.isAtSamePosition(b.position)) return 0;
      return a.position.isExistBefore(b.position) ? -1 : 1;
    } catch {
      return 0;
    }
  });
  collection.splice(0, collection.length, ...positioned.map((e) => e.control));
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

/**
 * Depth of the authored-batch scope below. `updateValues` serves two callers
 * with opposite requirements - mechanical reconciliation, which must never
 * author revisions, and an authored assistant batch, which must - so the
 * decision belongs to the caller rather than being hard-coded in the writer.
 */
let authoredDepth = 0;

let adapterWriteDepth = 0;
/**
 * True while the adapter itself is moving the selection to write: value writes
 * and structural mutations both select programmatically, and every one of
 * those selection changes reaches the editor's selectionChange listeners. They
 * are not the user's caret. A commit trigger that treated them as one flushed
 * the controller INSIDE the adapter's own write (measured 2026-09-09: a row
 * adoption ran between selecting a control's interior and inserting its text,
 * and the text landed in another table).
 */
export function isAdapterWriting(): boolean {
  return adapterWriteDepth > 0;
}

/** True while an authored assistant batch is applying through this adapter. */
export function isApplyingAuthoredBatch(): boolean {
  return authoredDepth > 0;
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
      // A PROGRAMMATIC MUTATION LEAVES THE SELECTION WHERE IT FOUND IT. The
      // native mutations select the tables and rows they work on; the caller's
      // selection - the user's caret, or the engine's own selection in the
      // middle of a write - must be exactly where it was when they return.
      // Measured 2026-09-09 without this: a row adoption, run from a
      // selectionChange the assistant's restripe had just fired, left the
      // selection in the adopted table, so the restripe painted that table's
      // cells and the SDK's own reject, entered the same way, removed content
      // from it.
      adapterWriteDepth += 1;
      try {
        return preserveDocumentViewDuring(editor as any, () =>
          applyNativeStructuralMutations(editor, mutations)
        );
      } finally {
        adapterWriteDepth -= 1;
      }
    },

    /**
     * Borrow three editor switches for one authored batch, then hand every one
     * of them back.
     *
     * Restoration is a `finally` around the whole run, not the happy path, and
     * it restores the PRIOR values rather than assuming defaults. A leaked
     * `enableTrackChanges` would silently start tracking the user's own typing;
     * a leaked `currentUser` would stamp their later edits with the assistant's
     * name, which is an authorship corruption worse than the defect this exists
     * to fix. Same three switches, and the same discipline, as the assistant's
     * older op seam.
     */
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
          if (!matches.length) return false;
          for (const control of matches) writeControl(control, write.text);
        }
        return true;
      };

      adapterWriteDepth += 1;
      try {
        // Reconciliation is mechanical normalization, not an authored edit, so
        // it must never author tracked-change revisions. Leave tracking off
        // afterwards too: restoring a leftover `true` (Assist batch, document
        // flag, container drift) would make the user's next keystroke inside
        // this control a tracked insertion.
        //
        // An AUTHORED batch is the one caller for which the opposite holds: its
        // value writes are the assistant's own edits and must appear on the
        // review card like any other. The authored scope owns restoring these
        // switches, so this path leaves them alone entirely while inside it.
        if (!authoredDepth) editor.enableTrackChanges = false;
        // Formula cells normally get no history entry of their own: they are
        // derived values, and recording them would put an undo step between the
        // user and the edit that caused them. Under an authored batch that
        // reasoning inverts twice over. The derived cells are part of the one
        // change the reviewer accepts or rejects, so they belong in the SAME
        // grouped history entry as the rest - and, measured on this SDK, a
        // tracked write with history disabled loses its insertion outright: the
        // old text is deleted, nothing replaces it, and the binding reads empty.
        // Tracked editing and history are entangled here, so an authored batch
        // keeps both on and lets the group carry the derived cells.
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
        // DERIVED VALUES ARE NOT REVIEWED EDITS. A formula output follows the
        // document; it is not a decision anyone accepts or rejects. Writing it
        // as a tracked revision made two cards collide on every shared total
        // (measured 2026-09-09: split then delete, five accept/reject orders,
        // every one left a subtotal stale), because the editor cannot keep two
        // identities' pending edits on one run. So formula outputs are written
        // untracked inside an assistant change set exactly as they already were
        // for the user's own typing: the card tracks the causes (rows, values),
        // and the totals recompute after every change, accept and reject.
        //
        // ONE EXCEPTION, and it is the editor's, not ours: a plain run cannot
        // live inside a tracked insertion. Writing one there splits the
        // insertion's range around it, and rejecting that insertion afterwards
        // removes far more than the insertion (measured 2026-09-09: a row
        // inserted by a card, its line total recomputed untracked into it, the
        // card rejected - every text run in the document gone). A derived value
        // whose cell sits inside a pending insertion is therefore written AS
        // THAT INSERTION: tracked, under the insertion's own author, so the
        // editor replaces the run inside the insertion instead of splitting it
        // (a second identity layered inside the first splits it, and the split
        // tail is a fragment no card can own cleanly). The value then follows
        // the insertion - kept with it, discarded with it - which is what a
        // total inside a pending row or table means.
        //
        // Such a write keeps HISTORY on as well: measured on this SDK (and
        // recorded above for the authored batch), a tracked write with history
        // disabled loses its insertion outright - the old run goes, nothing
        // replaces it, the control reads empty. One undo entry for a derived
        // value inside a pending card is the price of the value existing.
        const derivedWrites = applicableWrites.filter(
          (write) => write.kind !== 'field'
        );
        const priorTrackingForDerived = editor.enableTrackChanges;
        const priorUserForDerived = editor.currentUser;
        const priorHistoryForDerived = editor.enableEditorHistory;
        try {
          for (const write of derivedWrites) {
            const matches = controlsForTag(collection, write.tag);
            if (!matches.length) return false;
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
              editor.enableTrackChanges = false;
              editor.enableEditorHistory = priorHistoryForDerived;
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
