// Lets code that holds an editor ask for a reconcile without knowing anything
// about the binding engine.
//
// The assistant is the caller that needs this. Its edits are ordinary
// user-origin edits as far as bindings are concerned, and some of them change
// what formulas depend on - inserting a row into a configured table is the clear
// case, since an unbound row has to be adopted before its formulas mean
// anything. Left to the user's next commit, the document would sit inconsistent
// in between.
//
// Keyed by the editor instance in a WeakMap, so a torn-down editor takes its
// registration with it even if dispose never runs.

import type { ApplyRulesResult } from './core/engine';
import type { SfdtBlock } from './core/sfdtTypes';

export type BindingCommand =
  | {
      type: 'set-value';
      name: string;
      value: string;
      tableId?: string;
      rowId?: string;
    }
  | {
      type: 'add-row';
      tableId: string;
      afterRowId: string | null;
      rowId: string;
    }
  | { type: 'remove-row'; tableId: string; rowId: string }
  | {
      type: 'add-table';
      afterTableId: string;
      afterTag: string;
      block: SfdtBlock;
    }
  | {
      type: 'replace-table';
      tableId: string;
      tag: string;
      block: SfdtBlock;
    }
  | { type: 'remove-table'; tableId: string; tag: string }
  | {
      /**
       * A formula's expression changed in a control that already exists.
       *
       * `set-value` cannot carry this and `add-table` cannot either: the first
       * moves text, the second only ever carries a WHOLE table being added or
       * removed. An expression rewritten in an existing control produced no
       * command at all, so it was dropped between the in-memory projection and
       * the live document and the two disagreed about what the document said.
       *
       * Both tags travel because the old one is the address - it is what the
       * live control still wears - and the new one is the payload.
       */
      type: 'set-expression';
      name: string;
      previousTag: string;
      tag: string;
      tableId: string | null;
      rowId: string | null;
      global: boolean;
    };

/**
 * Present only for an authored assistant batch. Ordinary commands omit this so
 * user edits and mechanical reconciliation never acquire review revisions.
 */
export interface BindingCommandProvenance {
  author: string;
  changeSetId: string;
  group: string;
}

export interface BindingCommandOptions {
  provenance?: BindingCommandProvenance;
}

export interface BindingCommandSurface {
  flush(): void;
  /** The document was replaced from outside: re-read it as the baseline (no write, no dirty). */
  reopened?(): void;
  runCommands(
    commands: BindingCommand[],
    options?: BindingCommandOptions
  ): ApplyRulesResult;
}

const reconcilers = new WeakMap<object, BindingCommandSurface>();

export function registerBindingReconciler(
  editor: object,
  surface: BindingCommandSurface
): void {
  reconcilers.set(editor, surface);
}

export function unregisterBindingReconciler(editor: object): void {
  reconcilers.delete(editor);
}

/**
 * Reconcile this editor's bindings, if it has any. Returns whether one ran, and
 * never throws: a failed reconcile must not turn into a failed assistant edit.
 */
export function reconcileBoundDocument(editor: unknown): boolean {
  if (!editor || typeof editor !== 'object') return false;
  const surface = reconcilers.get(editor as object);
  if (!surface) return false;
  try {
    surface.flush();
    return true;
  } catch (error) {
    console.error('Feathery: reconciling document bindings failed', error);
    return false;
  }
}

export function bindingCommandSurfaceFor(
  editor: unknown
): BindingCommandSurface | null {
  if (!editor || typeof editor !== 'object') return null;
  return reconcilers.get(editor as object) ?? null;
}
