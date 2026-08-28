// Reconciliation controller: connects an editor to the pure engine.
//
//   idle -> serializing -> reconciling -> loading -> idle
//
// The editor is injected as a small interface, so the controller runs against a
// fake in unit tests and against Syncfusion in the product. It never imports the
// adapter directly - callers hand it adapter operations through EditorPort.
//
// Syncfusion owns undo/redo. Value-only engine output is patched in place via
// updateValues. Structural work (row adoption, insert/delete) is applied as
// native editor mutations so the same history module records them. open() is
// only for the initial document load or an explicit document replacement; a
// failed live patch never reloads, because open() destroys editorHistoryModule.
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
  ReconcileMode,
  RowTemplates
} from './core/engine';
import {
  addLineItem,
  BindingIndex,
  getAt,
  NativeStructuralMutation,
  removeLineItem,
  scanBindings,
  setAt,
  setOccurrenceText,
  setTaggedValue
} from './core/sfdtAdapter';
import {
  Diagnostic,
  SfdtBlock,
  SfdtDocument,
  SfdtPath,
  SfdtRow
} from './core/sfdtTypes';
import { renderDisplay } from './core/valueTypes';
import { DocumentPersistence, SaveResult } from './persistence';
import type {
  BindingCommand,
  BindingCommandOptions,
  BindingCommandProvenance
} from './reconcileRegistry';

/** What the controller needs from an editor. */
export interface EditorPort {
  /** The current document as verbose SFDT. */
  serialize(): string;
  /** Replace the document. Destroys native undo history. */
  open(sfdt: string): void;
  /**
   * Patch content-control display texts in place, preserving native history for
   * 'field' writes and suppressing it for the rest. Returns false when it could
   * not; the controller surfaces a diagnostic and leaves native history intact.
   */
  updateValues?(writes: EngineWrite[]): boolean;
  applyStructuralMutations?(mutations: NativeStructuralMutation[]): boolean;
  /**
   * Run one authored batch with the editor writing its OWN revisions -
   * undoable, correctly authored, correctly grouped - instead of having
   * revisions authored into the SFDT and installed by `open`.
   *
   * The adapter owns this because the switches are SDK details and the port is
   * the seam that keeps them there; a controller that set them itself would be
   * setting them on the port object, not on the editor behind it.
   */
  withAuthoredRevisions?<T>(
    provenance: BindingCommandProvenance,
    run: () => T
  ): T;
  /** Selection/scroll snapshot, for the open() path only. */
  captureView?(): unknown;
  restoreView?(view: unknown): void;
  /** Cancel any pending async work (e.g. a deferred view restore). */
  dispose?(): void;
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
  apply: 'none' | 'patch' | 'structural' | 'open';
  markDirty: boolean;
  event: ControllerEventName;
  /** Present for an authored assistant batch; drives the tracked scope. */
  provenance?: BindingCommandProvenance;
}

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

  /**
   * Each table's last seen bound row. Survives the user deleting every bound row,
   * which is otherwise the point where the document loses the only copy of the
   * row shape and no further row can be adopted.
   */
  rowTemplates: RowTemplates = new Map();

  persistedRevision = 0;

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
    const result = applyRules(sfdt, { rowTemplates: this.rowTemplates });
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
   * recompute, fields are left exactly as history restored them. Pass
   * adoptRows: false after undo/redo so a restored row is never re-wrapped.
   */
  flush({
    mode = 'commit',
    adoptRows
  }: { mode?: ReconcileMode; adoptRows?: boolean } = {}): void {
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
      result = applyRules(parsed, {
        prevValues: this.values,
        mode,
        rowTemplates: this.rowTemplates,
        ...(adoptRows === false ? { adoptRows: false } : {})
      });
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
        : result.structural && adoptRows !== false
        ? 'structural'
        : result.writes.length && this.editor.updateValues
        ? 'patch'
        : 'none';
    this.commit(result, { apply, markDirty: true, event: 'reconcile' });

    if (this.pendingFlush) {
      this.pendingFlush = false;
      this.debounceTimer = this.setTimeoutFn(() => this.flush(), 0);
    }
  }

  runCommands(
    commands: BindingCommand[],
    options: BindingCommandOptions = {}
  ): ApplyRulesResult {
    if (!this.workingSfdt) throw new Error('no document loaded');
    this.flush();
    let mutated = this.workingSfdt as SfdtDocument;
    let index = this.index ?? scanBindings(mutated);
    const beforeCommands = index;
    const structuralMutations: NativeStructuralMutation[] = [];
    // Where each insert-table's blocks sit in the document being built, so the
    // mutation can carry POST-rules content. See `finalizedMutations`.
    const insertedTableSpans = new Map<
      NativeStructuralMutation,
      { blocksPath: SfdtPath; at: number; count: number }
    >();
    for (const command of commands) {
      if (command.type === 'set-value') {
        if (command.tableId && command.rowId) {
          const occurrence = index.tables
            .get(command.tableId)
            ?.rows.find((row) => row.rowId === command.rowId)
            ?.bindings.get(command.name);
          if (!occurrence || occurrence.def.kind !== 'field')
            throw new Error(
              `no field ${command.name} in ${command.tableId}/${command.rowId}`
            );
          mutated = setOccurrenceText(
            mutated,
            occurrence,
            renderDisplay(occurrence.def.fieldType, command.value)
          );
        } else {
          mutated = setTaggedValue(mutated, command.name, command.value, index);
        }
      } else if (command.type === 'add-row') {
        const added = addLineItem(
          mutated,
          command.tableId,
          command.afterRowId,
          index,
          command.rowId
        );
        mutated = added.sfdt;
        const nextIndex = scanBindings(mutated);
        const table = nextIndex.tables.get(command.tableId);
        const row = table?.rows.find((entry) => entry.rowId === added.rowId);
        if (!table?.tablePath || !row?.path)
          throw new Error(`added row ${added.rowId} could not be planned`);
        structuralMutations.push({
          kind: 'insert-row',
          tableId: command.tableId,
          tablePath: table.tablePath,
          rowIndex: Number(row.path[row.path.length - 1]),
          rowId: added.rowId,
          row: getAt(mutated, row.path) as SfdtRow,
          afterRowId: command.afterRowId
        });
      } else if (command.type === 'remove-row') {
        const row = index.tables
          .get(command.tableId)
          ?.rows.find((entry) => entry.rowId === command.rowId);
        const tag = row && [...row.bindings.values()][0]?.tag;
        if (!tag) throw new Error(`row ${command.rowId} could not be located`);
        structuralMutations.push({
          kind: 'delete-row',
          tableId: command.tableId,
          rowId: command.rowId,
          tag
        });
        mutated = removeLineItem(
          mutated,
          command.tableId,
          command.rowId,
          index
        );
      } else if (command.type === 'add-table') {
        const anchor = index.tables.get(command.afterTableId);
        if (!anchor) throw new Error(`table ${command.afterTableId} not found`);
        const blocksPath = anchor.markerPath.slice(0, -1);
        const at = Number(anchor.markerPath[anchor.markerPath.length - 1]);
        const blocks = getAt(mutated, blocksPath) as SfdtBlock[];
        const hasTable = (block: SfdtBlock | undefined): boolean => {
          if (!block) return false;
          if (Array.isArray(block.rows)) return true;
          return (block.blocks ?? []).some(hasTable);
        };
        // Word coalesces adjacent top-level tables into one grid. A paragraph
        // is a storage-topology separator, so add-table owns that invariant for
        // every caller rather than requiring each caller to remember it.
        const insertedBlocks: SfdtBlock[] = [
          { inlines: [] },
          command.block,
          ...(hasTable(blocks[at + 1]) ? [{ inlines: [] }] : [])
        ];
        mutated = setAt(mutated, blocksPath, [
          ...blocks.slice(0, at + 1),
          ...insertedBlocks,
          ...blocks.slice(at + 1)
        ]);
        const insertTable: NativeStructuralMutation = {
          kind: 'insert-table',
          afterTag: command.afterTag,
          blocks: insertedBlocks
        };
        structuralMutations.push(insertTable);
        insertedTableSpans.set(insertTable, {
          blocksPath,
          at: at + 1,
          count: insertedBlocks.length
        });
      } else {
        const table = index.tables.get(command.tableId);
        if (!table) throw new Error(`table ${command.tableId} not found`);
        const blocksPath = table.markerPath.slice(0, -1);
        const at = Number(table.markerPath[table.markerPath.length - 1]);
        const blocks = getAt(mutated, blocksPath) as SfdtBlock[];
        mutated = setAt(mutated, blocksPath, [
          ...blocks.slice(0, at),
          ...blocks.slice(at + 1)
        ]);
        structuralMutations.push({ kind: 'delete-table', tag: command.tag });
      }
      index = scanBindings(mutated);
    }
    const result = applyRules(mutated, {
      prevValues: this.values,
      rowTemplates: this.rowTemplates
    });
    // Rules run AFTER the commands, and they recompute formulas - so content
    // captured while building the mutation is pre-recomputation and stale. The
    // row case already knew this; the table case did not, and the reopen hid it
    // by installing the whole recomputed document wholesale. Both now re-read
    // their content from the post-rules result, which is the same law.
    const finalizedMutations = structuralMutations.map((mutation) => {
      const span = insertedTableSpans.get(mutation);
      if (span) {
        const blocks = getAt(result.sfdt, span.blocksPath) as SfdtBlock[];
        return {
          ...mutation,
          blocks: blocks.slice(span.at, span.at + span.count)
        };
      }
      if (mutation.kind !== 'insert-row') return mutation;
      const row = result.index.tables
        .get(mutation.tableId)
        ?.rows.find((entry) => entry.rowId === mutation.rowId);
      return row?.path
        ? {
            ...mutation,
            row: getAt(result.sfdt, row.path) as SfdtRow,
            rowIndex: Number(row.path[row.path.length - 1])
          }
        : mutation;
    });
    result.structuralMutations = [
      ...finalizedMutations,
      ...result.structuralMutations
    ];
    const authoredWrites: EngineWrite[] = [];
    for (const occurrence of result.index.occurrences) {
      const previous = beforeCommands.occurrences.find(
        (candidate) => candidate.tag === occurrence.tag
      );
      // New controls are created by the structural mutation with their display
      // text already set. Recording them as field writes would add extra native
      // history entries on top of the insert/adopt group.
      if (!previous || previous.text === occurrence.text) continue;
      authoredWrites.push({
        tag: occurrence.tag,
        text: occurrence.text,
        kind: occurrence.def.kind === 'formula' ? 'formula' : 'field'
      });
    }
    result.writes = [
      ...new Map(
        [...authoredWrites, ...result.writes].map((write) => [write.tag, write])
      ).values()
    ];
    // An authored batch takes the SAME native route as every other command.
    // It used to author revisions into the SFDT and install them with `open`,
    // which bought review records at the price of the document's whole undo
    // history - ours AND the user's, because `open` resets the stack. The
    // review records are now produced by the editor itself, inside the tracked
    // scope `commit` opens, so nothing is traded away in either direction.
    this.commit(result, {
      apply: result.structuralMutations.length
        ? 'structural'
        : result.writes.length
        ? 'patch'
        : 'none',
      markDirty: true,
      event: 'command',
      provenance: options.provenance
    });
    return result;
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

  /**
   * Authored batches go through the port's tracked scope; everything else runs
   * exactly as before. An adapter that does not implement the capability still
   * applies the edit natively - it simply produces no review records, which is
   * a degraded card, never a lost or unrecoverable document.
   */
  private inTrackedScope<T>(
    provenance: BindingCommandProvenance | undefined,
    run: () => T
  ): T {
    if (!provenance || !this.editor.withAuthoredRevisions) return run();
    return this.editor.withAuthoredRevisions(provenance, run);
  }

  private commit(
    result: ApplyRulesResult,
    { apply, markDirty, event, provenance }: CommitOptions
  ): void {
    let failed = false;

    if (apply === 'patch' || apply === 'structural' || apply === 'open') {
      this.phase = 'loading';
      let patched = false;
      if (apply === 'patch') {
        // updateValues restores selection and scroll itself, synchronously. An
        // async restore here fights a user already typing in the next field.
        const started = Date.now();
        try {
          patched = this.inTrackedScope(
            provenance,
            () =>
              (this.editor.updateValues as (w: EngineWrite[]) => boolean)(
                result.writes
              ) === true
          );
        } catch {
          patched = false;
        }
        this.timings.patchMs = Date.now() - started;
      } else if (apply === 'structural') {
        const started = Date.now();
        try {
          patched = this.inTrackedScope(provenance, () => {
            let ok =
              this.editor.applyStructuralMutations?.(
                result.structuralMutations
              ) === true;
            if (ok && result.writes.length && this.editor.updateValues)
              ok = this.editor.updateValues(result.writes) === true;
            return ok;
          });
        } catch {
          patched = false;
        }
        this.timings.patchMs = Date.now() - started;
      }
      if (!patched && apply === 'open') {
        const view = this.editor.captureView ? this.editor.captureView() : null;
        const started = Date.now();
        this.editor.open(JSON.stringify(result.sfdt));
        this.timings.openMs = Date.now() - started;
        if (view != null && this.editor.restoreView)
          this.editor.restoreView(view);
      } else if (!patched) {
        failed = true;
      }
    }
    if (failed) {
      this.diagnostics = [
        ...result.diagnostics,
        {
          severity: 'error',
          code: 'native-mutation-failed',
          message:
            'The binding update could not be applied without replacing the live document.',
          path: []
        }
      ];
    } else {
      this.workingSfdt = result.sfdt;
      this.values = result.values;
      this.index = result.index;
      this.rowTemplates = result.rowTemplates;
      this.diagnostics = result.diagnostics;
    }
    if (markDirty) this.dirty = true;
    this.phase = 'idle';
    this.onChange({
      controller: this,
      event: failed ? 'error' : event,
      changed: result.changed
    });
  }
}
