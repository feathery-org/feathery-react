// Reconciliation controller: connects an editor to the pure engine.
//
//   idle -> serializing -> reconciling -> loading -> idle
//
// The editor is injected as a small interface, so the controller runs against a
// fake in unit tests and against Syncfusion in the product. It never imports the
// adapter directly - callers hand it adapter operations through runCommand.
//
// Value-only engine output (writes, and not structural) is patched into the live
// editor via updateValues so the editor's own undo/redo stacks survive
// reconciliation. Only structural transactions - row adoption, row commands,
// snapshot restores - reload via open(), which unavoidably destroys editor
// history; those are covered by this controller's snapshot undo instead.
//
// Three invariants keep the loop from eating itself: events fired while the
// controller is loading its own output are ignored, an older serialization can
// never overwrite a newer one, and a reconcile that changes nothing does not
// touch the editor at all.

import {
  applyRules,
  EngineWrite,
  hasBlockingErrors,
  ApplyRulesResult,
  ChangeRecord,
  ReconcileMode
} from './core/engine';
import { BindingIndex } from './core/sfdtAdapter';
import { Diagnostic, SfdtDocument } from './core/sfdtTypes';
import { DocumentPersistence, SaveResult } from './persistence';

/** What the controller needs from an editor. */
export interface EditorPort {
  /** The current document as verbose SFDT. */
  serialize(): string;
  /** Replace the document. Destroys native undo history. */
  open(sfdt: string): void;
  /**
   * Patch content-control display texts in place, preserving native history for
   * 'field' writes and suppressing it for the rest. Returns false when it could
   * not, so the controller falls back to open().
   */
  updateValues?(writes: EngineWrite[]): boolean;
  /** Selection/scroll snapshot, for the open() path only. */
  captureView?(): unknown;
  restoreView?(view: unknown): void;
}

export type ControllerEventName =
  | 'load'
  | 'reconcile'
  | 'command'
  | 'restore'
  | 'saved'
  | 'save-conflict'
  | 'error';

export interface ControllerEvent {
  // A type-only forward reference to the class below, which is fine at runtime.
  // eslint-disable-next-line no-use-before-define
  controller: ReconciliationController;
  event: ControllerEventName;
  changed?: ChangeRecord[];
}

export type TimerId = unknown;

export interface ControllerOptions {
  editor: EditorPort;
  persistence?: DocumentPersistence | null;
  /**
   * Milliseconds to wait after a content change before reconciling, or null for
   * manual-commit mode, where only explicit flush() calls commit. The product
   * uses manual mode: commits happen on Enter and on blur.
   */
  debounceMs?: number | null;
  onChange?: (event: ControllerEvent) => void;
  setTimeoutFn?: (fn: () => void, ms: number) => TimerId;
  clearTimeoutFn?: (id: TimerId) => void;
}

export type ControllerPhase =
  | 'idle'
  | 'serializing'
  | 'reconciling'
  | 'loading';

export type ControllerSaveResult =
  | SaveResult
  | { ok: false; reason: 'blocked-by-diagnostics' | 'no-persistence' };

interface CommitOptions {
  apply: 'none' | 'patch' | 'open';
  markDirty: boolean;
  event: ControllerEventName;
  skipUndo?: boolean;
}

const UNDO_DEPTH = 50;

export class ReconciliationController {
  readonly editor: EditorPort;

  persistence: DocumentPersistence | null;

  debounceMs: number | null;

  phase: ControllerPhase = 'idle';

  sequence = 0;

  dirty = false;

  diagnostics: Diagnostic[] = [];

  workingSfdt: SfdtDocument | null = null;

  /** Canonical values from the last valid snapshot, keyed by occurrence. */
  values: Map<string, string> | null = null;

  index: BindingIndex | null = null;

  persistedRevision = 0;

  undoStack: string[] = [];

  redoStack: string[] = [];

  timings: Record<string, number> = {};

  private readonly onChange: (event: ControllerEvent) => void;

  // Wrapped in arrows because browsers throw "Illegal invocation" when window
  // timer functions are called with a different `this`.
  private readonly setTimeoutFn: (fn: () => void, ms: number) => TimerId;

  private readonly clearTimeoutFn: (id: TimerId) => void;

  private debounceTimer: TimerId = null;

  private pendingFlush = false;

  constructor({
    editor,
    persistence = null,
    debounceMs = 350,
    onChange = () => {},
    setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
    clearTimeoutFn = (id) => clearTimeout(id as any)
  }: ControllerOptions) {
    this.editor = editor;
    this.persistence = persistence;
    this.debounceMs = debounceMs;
    this.onChange = onChange;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
  }

  /* ---- entry points ---- */

  /** Load a saved document: reconcile once, then open the result. */
  loadInitial(sfdt: SfdtDocument, revision = 0): void {
    const result = applyRules(sfdt, {});
    this.commit(result, { apply: 'open', markDirty: false, event: 'load' });
    this.persistedRevision = revision;
  }

  /** Wire this to the editor's contentChange event. */
  notifyContentChange(): void {
    if (this.phase === 'loading') return; // Our own write echoing back.
    if (this.phase !== 'idle') {
      this.pendingFlush = true;
      return;
    }
    if (this.debounceMs == null) return; // Manual-commit mode.
    this.clearTimeoutFn(this.debounceTimer);
    this.debounceTimer = this.setTimeoutFn(() => this.flush(), this.debounceMs);
  }

  /**
   * Serialize -> reconcile -> apply. Used on Enter, blur, commands, and before
   * saving. Pass mode 'self-heal' for undo/redo-originated reconciles: formulas
   * recompute, fields are left exactly as history restored them.
   */
  flush({ mode = 'commit' }: { mode?: ReconcileMode } = {}): void {
    this.clearTimeoutFn(this.debounceTimer);
    if (this.phase !== 'idle') {
      this.pendingFlush = true;
      return;
    }

    this.phase = 'serializing';
    this.sequence += 1;
    const mySequence = this.sequence;
    let parsed: SfdtDocument;
    try {
      const started = Date.now();
      const serialized = this.editor.serialize();
      this.timings.serializeMs = Date.now() - started;
      parsed = JSON.parse(serialized);
    } catch (thrown) {
      this.failPhase('serialize-failed', thrown);
      return;
    }

    this.phase = 'reconciling';
    let result: ApplyRulesResult;
    try {
      const started = Date.now();
      result = applyRules(parsed, { prevValues: this.values, mode });
      this.timings.reconcileMs = Date.now() - started;
    } catch (thrown) {
      this.failPhase('reconcile-failed', thrown);
      return;
    }

    // A newer flush started while this one was working: discard this result.
    if (mySequence !== this.sequence) {
      this.phase = 'idle';
      return;
    }

    const apply: CommitOptions['apply'] =
      result.sfdt === parsed
        ? 'none'
        : !result.structural && result.writes.length && this.editor.updateValues
        ? 'patch'
        : 'open';
    this.commit(result, { apply, markDirty: true, event: 'reconcile' });

    if (this.pendingFlush) {
      this.pendingFlush = false;
      this.debounceTimer = this.setTimeoutFn(() => this.flush(), 0);
    }
  }

  /**
   * Engine-side command: fn(workingSfdt, index) -> sfdt. This is how the app
   * performs setTaggedValue / addLineItem / removeLineItem without the
   * controller depending on the adapter.
   */
  runCommand(
    fn: (sfdt: SfdtDocument, index: BindingIndex | null) => SfdtDocument
  ): ApplyRulesResult {
    if (!this.workingSfdt) throw new Error('no document loaded');
    // Fold in any user edit not committed yet - a pending debounce, or an
    // uncommitted edit in manual mode.
    this.flush();
    const mutated = fn(this.workingSfdt as SfdtDocument, this.index);
    const result = applyRules(mutated, { prevValues: this.values });
    // Commands mutate JSON the editor has never seen (rows added or removed),
    // so they always repaint via open().
    this.commit(result, { apply: 'open', markDirty: true, event: 'command' });
    return result;
  }

  /* ---- snapshot undo/redo, for transactions that reloaded ---- */

  undo(): boolean {
    if (!this.undoStack.length) return false;
    this.redoStack.push(JSON.stringify(this.workingSfdt));
    this.restore(this.undoStack.pop() as string);
    return true;
  }

  redo(): boolean {
    if (!this.redoStack.length) return false;
    this.undoStack.push(JSON.stringify(this.workingSfdt));
    this.restore(this.redoStack.pop() as string);
    return true;
  }

  private restore(json: string): void {
    const result = applyRules(JSON.parse(json), {});
    this.commit(result, {
      apply: 'open',
      markDirty: true,
      event: 'restore',
      skipUndo: true
    });
  }

  /* ---- persistence ---- */

  canSave(): boolean {
    return !!this.workingSfdt && !hasBlockingErrors(this.diagnostics);
  }

  async save(): Promise<ControllerSaveResult> {
    if (this.workingSfdt) this.flush();
    if (!this.canSave()) return { ok: false, reason: 'blocked-by-diagnostics' };
    if (!this.persistence) return { ok: false, reason: 'no-persistence' };
    const result = await this.persistence.save(
      this.workingSfdt as SfdtDocument,
      this.persistedRevision
    );
    if (result.ok) {
      this.persistedRevision = result.revision;
      this.dirty = false;
      this.onChange({ controller: this, event: 'saved' });
    } else {
      this.onChange({ controller: this, event: 'save-conflict' });
    }
    return result;
  }

  /* ---- internals ---- */

  private failPhase(code: string, thrown: unknown): void {
    this.phase = 'idle';
    this.diagnostics = [
      {
        severity: 'error',
        code,
        message: String((thrown as Error)?.message ?? thrown),
        path: []
      }
    ];
    this.onChange({ controller: this, event: 'error' });
  }

  private commit(
    result: ApplyRulesResult,
    { apply, markDirty, event, skipUndo = false }: CommitOptions
  ): void {
    if (!skipUndo && this.workingSfdt && event !== 'load') {
      this.undoStack.push(JSON.stringify(this.workingSfdt));
      if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift();
      // A restore walks the stacks itself; anything else invalidates redo.
      if (event !== 'restore') this.redoStack = [];
    }
    this.workingSfdt = result.sfdt;
    this.values = result.values;
    this.index = result.index;
    this.diagnostics = result.diagnostics;
    if (markDirty) this.dirty = true;

    if (apply === 'patch' || apply === 'open') {
      this.phase = 'loading';
      let patched = false;
      if (apply === 'patch') {
        // updateValues restores selection and scroll itself, synchronously. An
        // async restore here fights a user already typing in the next field.
        const started = Date.now();
        try {
          patched =
            (this.editor.updateValues as (w: EngineWrite[]) => boolean)(
              result.writes
            ) === true;
        } catch {
          patched = false;
        }
        this.timings.patchMs = Date.now() - started;
      }
      if (!patched) {
        const view = this.editor.captureView ? this.editor.captureView() : null;
        const started = Date.now();
        this.editor.open(JSON.stringify(result.sfdt));
        this.timings.openMs = Date.now() - started;
        if (view != null && this.editor.restoreView)
          this.editor.restoreView(view);
      }
    }
    this.phase = 'idle';
    this.onChange({ controller: this, event, changed: result.changed });
  }
}
