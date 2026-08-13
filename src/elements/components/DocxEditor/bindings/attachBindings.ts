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

  const controller = new ReconciliationController({
    editor: createEditorAdapter(editor),
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
    runCommand: (fn) => controller.runCommand(fn)
  });

  const triggers = createCommitTriggers(editor, controller, {
    ...(setTimeoutFn ? { setTimeoutFn } : {}),
    ...(clearTimeoutFn ? { clearTimeoutFn } : {})
  });
  const uninstallGuard = installKeystrokeGuard(editor);

  const eventful = editor as EventfulEditor;
  const onContentChange = () => triggers.onContentChange();
  const onSelectionChange = () => triggers.onSelectionChange();
  const onKeyDown = (args: any) => triggers.onKeyDown(args?.event?.key);
  const onBlur = () => triggers.onEditorBlur();

  eventful.addEventListener?.('contentChange', onContentChange);
  eventful.addEventListener?.('selectionChange', onSelectionChange);
  eventful.addEventListener?.('keyDown', onKeyDown);
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
      unregisterBindingReconciler(editor);
      eventful.removeEventListener?.('contentChange', onContentChange);
      eventful.removeEventListener?.('selectionChange', onSelectionChange);
      eventful.removeEventListener?.('keyDown', onKeyDown);
      editableDiv?.removeEventListener?.('blur', onBlur);
      uninstallGuard();
      triggers.dispose();
    }
  };
}
