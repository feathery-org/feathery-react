// Everything needed to make a live editor's bindings work, with no React in it.
//
// One call wires the whole loop onto an already-open document: convert any
// [[...]] tokens the template still carries, reconcile once so formulas hold real
// values, then listen for the events that decide when an edit becomes a commit.
// One dispose() call takes it all back off again, which matters because the host
// recreates its editor instance whenever review mode flips.
//
// Framework-free on purpose: the risky part of this integration is the editor,
// not the effect, so it is tested against a real DocumentEditor directly.

import { convertTemplateTokens } from './core/templateImport';
import { hasBlockingErrors } from './core/engine';
import { Diagnostic, SfdtDocument } from './core/sfdtTypes';
import {
  ControllerEvent,
  ReconciliationController,
  TimerId
} from './controller';
import {
  configureEditorForBindings,
  createEditorAdapter,
  SyncfusionEditorLike
} from './editorAdapter';
import { installKeystrokeGuard } from './keystrokeGuard';
import { createCommitTriggers } from './commitTriggers';
import { watchRowCommands } from './rowCommandWatch';
import {
  installTableDeleteGuard,
  isDeleteGuardBusy,
  TableDeleteImpact
} from './tableDeleteGuard';
import { DocumentPersistence } from './persistence';
import {
  registerBindingReconciler,
  unregisterBindingReconciler
} from './reconcileRegistry';

export interface BindingsOptions {
  /**
   * Convert [[...]] text tokens into content controls when attaching. Idempotent,
   * so it is safe on a document that was already converted.
   */
  convertTokensOnOpen?: boolean;
  /** Committed document-level field values, after every reconcile. */
  onFieldValues?: (values: Record<string, string>) => void;
  /** Diagnostics after every reconcile, including the ones that block saving. */
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
  /**
   * Called around writes the engine performs on its own behalf, so the host can
   * stop counting them as user edits. The initial reconcile is the case that
   * matters: computing a template's formulas is not the user dirtying anything.
   */
  onSuppressContentChange?: (suppressed: boolean) => void;
  /**
   * Asked before a table deletion that would orphan formulas elsewhere in the
   * document (they read values the table holds). Resolving false cancels the
   * deletion; absent means such deletes proceed without a prompt.
   */
  confirmTableDelete?: (impact: TableDeleteImpact) => Promise<boolean>;
  /**
   * Fired (debounced) when the user's edit is refused because it lands on a
   * locked content control - typing into a computed cell, or deleting across a
   * binding without fully covering it. The host shows a brief "locked" hint so
   * the refusal is not silent.
   */
  onLockedEdit?: () => void;
  persistence?: DocumentPersistence | null;
  setTimeoutFn?: (fn: () => void, ms: number) => TimerId;
  clearTimeoutFn?: (id: TimerId) => void;
}

export interface AttachedBindings {
  controller: ReconciliationController;
  /**
   * Reconcile anything uncommitted, then report whether the document may be
   * saved. False means blocking diagnostics remain - invalid input, an ambiguous
   * edit - and the bytes would persist a document the engine considers wrong.
   */
  commitForSave(): boolean;
  diagnostics(): Diagnostic[];
  fieldValues(): Record<string, string>;
  /** Diagnostics from the one-time token conversion, if it ran. */
  importDiagnostics: Diagnostic[];
  dispose(): void;
}

type EventfulEditor = SyncfusionEditorLike & {
  addEventListener?: (name: string, handler: (...args: any[]) => void) => void;
  removeEventListener?: (
    name: string,
    handler: (...args: any[]) => void
  ) => void;
};

/** Document-level field values, one per binding name. */
function collectFieldValues(
  controller: ReconciliationController
): Record<string, string> {
  const out: Record<string, string> = {};
  const { index, values } = controller;
  if (!index || !values) return out;
  for (const [name, occurrences] of index.fields) {
    const known = occurrences.find((occurrence) => values.has(occurrence.key));
    if (known) out[name] = values.get(known.key) as string;
  }
  return out;
}

export function attachBindings(
  editor: SyncfusionEditorLike,
  {
    convertTokensOnOpen = true,
    onFieldValues,
    onDiagnostics,
    onSuppressContentChange,
    confirmTableDelete,
    onLockedEdit,
    persistence = null,
    setTimeoutFn,
    clearTimeoutFn
  }: BindingsOptions = {}
): AttachedBindings {
  // Best effort - the reliable place is the constructor. When this fails the
  // engine still refuses minified SFDT loudly rather than reading no bindings.
  configureEditorForBindings(editor);

  const report = (event: ControllerEvent): void => {
    onDiagnostics?.(event.controller.diagnostics);
    onFieldValues?.(collectFieldValues(event.controller));
  };

  const editorPort = createEditorAdapter(editor);
  const controller = new ReconciliationController({
    editor: editorPort,
    persistence,
    // Manual commit: edits reconcile on Enter and on blur, never mid-keystroke.
    debounceMs: null,
    onChange: report,
    ...(setTimeoutFn ? { setTimeoutFn } : {}),
    ...(clearTimeoutFn ? { clearTimeoutFn } : {})
  });

  const importDiagnostics: Diagnostic[] = [];
  onSuppressContentChange?.(true);
  try {
    const parsed = JSON.parse(editor.serialize()) as SfdtDocument;
    let initial = parsed;
    if (convertTokensOnOpen) {
      const converted = convertTemplateTokens(parsed);
      importDiagnostics.push(...converted.diagnostics);
      initial = converted.sfdt;
    }
    // loadInitial reconciles and opens the result, so a template's formulas hold
    // real values before the user ever sees them.
    controller.loadInitial(initial);
  } finally {
    onSuppressContentChange?.(false);
  }

  // The assistant writes through its own engine and knows nothing about
  // bindings; this is how its batches get reconciled.
  registerBindingReconciler(editor, {
    flush: () => controller.flush(),
    runCommands: (commands, options) =>
      controller.runCommands(commands, options)
  });

  const triggers = createCommitTriggers(editor, controller, {
    ...(setTimeoutFn ? { setTimeoutFn } : {}),
    ...(clearTimeoutFn ? { clearTimeoutFn } : {})
  });
  const uninstallGuard = installKeystrokeGuard(editor);
  // Explicit whole-table/row deletion: lift the content-control locks that
  // made deleteTable/deleteRow silent no-ops, and confirm/unwrap when the
  // deleted values feed formulas elsewhere (tableDeleteGuard has the full
  // story). Installed BEFORE watchRowCommands so the row watcher's wrapper
  // stays outermost and its reconcile runs after the guard's grouped history
  // entry closes.
  const uninstallTableDelete = installTableDeleteGuard(editor, {
    ...(confirmTableDelete ? { confirm: confirmTableDelete } : {}),
    onDeleted: () => {
      if (controller.phase !== 'idle') return;
      const history = editor.editorHistoryModule;
      if (history?.isUndoing || history?.isRedoing) return;
      controller.flush({ mode: 'self-heal' });
    }
  });
  // Native insertRow/deleteRow bypass runCommands. After the user's command
  // the interceptor adopts and recomputes in the same turn. Replay during
  // undo/redo must not flush: that inserts content controls mid-history and
  // leaves redo unable to delete the row.
  const unwatchRowCommands = watchRowCommands(editor, () => {
    if (controller.phase !== 'idle') return;
    const history = editor.editorHistoryModule;
    if (history?.isUndoing || history?.isRedoing) return;
    controller.flush({ mode: 'self-heal' });
  });

  const eventful = editor as EventfulEditor;
  // Going back a form step unmounts the editor: the host destroys the Syncfusion
  // instance in a sibling effect, and React runs that cleanup BEFORE this
  // binding's dispose. Destroy fires teardown selectionChange/contentChange
  // events that still reach these listeners, now pointed at half-null editor
  // internals - Syncfusion throws "Cannot convert undefined or null to object"
  // and reports it as "Error caught while running custom logic", which reaches
  // the host's error boundary and takes the form down. A handler that never
  // throws, and bails once the editor is gone, cannot start that chain.
  let disposed = false;
  const runGuarded = (fn: () => void): void => {
    if (disposed || (editor as { isDestroyed?: boolean }).isDestroyed) return;
    try {
      fn();
    } catch (error) {
      console.error('Feathery: document bindings event handler failed', error);
    }
  };
  const onContentChange = () => runGuarded(() => triggers.onContentChange());
  const onSelectionChange = () =>
    runGuarded(() => triggers.onSelectionChange());
  const onKeyDown = (args: any) =>
    runGuarded(() => triggers.onKeyDown(args?.event?.key));
  const onBlur = () => runGuarded(() => triggers.onEditorBlur());

  // Syncfusion fires 'contentControl' the instant a lock refuses an edit
  // (typing into a computed cell, a delete that crosses a binding). Debounce
  // so a held key or a burst is one hint, and never while the delete guard is
  // mid-operation - those refusals are ours to resolve, not to complain about.
  let lockedHintTimer: TimerId | null = null;
  const scheduleTimeout = setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const cancelTimeout = clearTimeoutFn ?? ((id) => clearTimeout(id as never));
  const onLockedControl = () =>
    runGuarded(() => {
      if (!onLockedEdit || isDeleteGuardBusy()) return;
      if (lockedHintTimer !== null) return;
      onLockedEdit();
      lockedHintTimer = scheduleTimeout(() => {
        lockedHintTimer = null;
      }, 600);
    });

  eventful.addEventListener?.('contentChange', onContentChange);
  eventful.addEventListener?.('selectionChange', onSelectionChange);
  eventful.addEventListener?.('keyDown', onKeyDown);
  eventful.addEventListener?.('contentControl', onLockedControl);
  // Clicking into a toolbar or a side panel must not strand an edit.
  const editableDiv = editor.documentHelper?.editableDiv;
  editableDiv?.addEventListener?.('blur', onBlur);

  return {
    controller,
    commitForSave(): boolean {
      // Fold in whatever the user typed but has not committed, then judge the
      // document as it will actually be written.
      controller.flush();
      return !hasBlockingErrors(controller.diagnostics);
    },
    diagnostics: () => controller.diagnostics,
    fieldValues: () => collectFieldValues(controller),
    importDiagnostics,
    dispose(): void {
      // Set first: removing a listener can itself fire an event, and any stray
      // timer that fires after this point must find the handlers inert.
      disposed = true;
      // React runs the host's instance.destroy() cleanup BEFORE this one, so by
      // the time dispose runs the editor is often already torn down. Calling
      // removeEventListener (and the un-patch helpers) on a destroyed Syncfusion
      // instance can dereference its null internals and throw "Cannot convert
      // undefined or null to object". dispose runs inside React's unmount commit,
      // where a throw is caught by the nearest error boundary and takes the form
      // down - so every step is isolated and a failure is logged, never thrown.
      const step = (label: string, fn: () => void): void => {
        try {
          fn();
        } catch (error) {
          console.error(
            `Feathery: document bindings dispose (${label})`,
            error
          );
        }
      };
      step('unregister', () => unregisterBindingReconciler(editor));
      step('contentChange', () =>
        eventful.removeEventListener?.('contentChange', onContentChange)
      );
      step('selectionChange', () =>
        eventful.removeEventListener?.('selectionChange', onSelectionChange)
      );
      step('keyDown', () =>
        eventful.removeEventListener?.('keyDown', onKeyDown)
      );
      step('contentControl', () =>
        eventful.removeEventListener?.('contentControl', onLockedControl)
      );
      step('lockedHintTimer', () => {
        if (lockedHintTimer !== null) cancelTimeout(lockedHintTimer);
      });
      step('blur', () => editableDiv?.removeEventListener?.('blur', onBlur));
      step('guard', () => uninstallGuard());
      step('rowCommands', () => unwatchRowCommands());
      step('tableDelete', () => uninstallTableDelete());
      step('triggers', () => triggers.dispose());
      // Cancels the deferred view restore, which would otherwise read
      // editor.selection ~60ms after the editor was destroyed.
      step('editorPort', () => editorPort.dispose?.());
    }
  };
}
