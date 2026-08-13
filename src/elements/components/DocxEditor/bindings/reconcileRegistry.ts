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
import { getAt, scanBindings } from './core/sfdtAdapter';
import { parseDisplay } from './core/valueTypes';
import type { SfdtBlock, SfdtDocument } from './core/sfdtTypes';

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
  | { type: 'remove-table'; tableId: string; tag: string };

export interface BindingCommandSurface {
  flush(): void;
  runCommands(commands: BindingCommand[]): ApplyRulesResult;
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

export function diffBindingCommands(
  before: SfdtDocument,
  after: SfdtDocument
): BindingCommand[] {
  const previous = scanBindings(before);
  const next = scanBindings(after);
  const previousTables = [...previous.tables.keys()].sort();
  const nextTables = [...next.tables.keys()].sort();
  const commands: BindingCommand[] = [];

  for (const tableId of previousTables) {
    if (next.tables.has(tableId)) continue;
    const table = previous.tables.get(tableId)!;
    const marker = getAt(before, table.markerPath) as any;
    commands.push({
      type: 'remove-table',
      tableId,
      tag: String(marker?.contentControlProperties?.tag || '')
    });
  }
  for (const tableId of nextTables) {
    if (previous.tables.has(tableId)) continue;
    const table = next.tables.get(tableId)!;
    const parent = table.markerPath.slice(0, -1);
    const at = Number(table.markerPath[table.markerPath.length - 1]);
    const anchor = [...previous.tables.values()]
      .filter(
        (candidate) =>
          JSON.stringify(candidate.markerPath.slice(0, -1)) ===
            JSON.stringify(parent) &&
          Number(candidate.markerPath[candidate.markerPath.length - 1]) < at
      )
      .sort(
        (a, b) =>
          Number(b.markerPath[b.markerPath.length - 1]) -
          Number(a.markerPath[a.markerPath.length - 1])
      )[0];
    if (!anchor) throw new Error(`no insertion anchor for table ${tableId}`);
    const anchorBlock = getAt(before, anchor.markerPath) as any;
    commands.push({
      type: 'add-table',
      afterTableId: anchor.tableId,
      afterTag: String(anchorBlock?.contentControlProperties?.tag || ''),
      block: getAt(after, table.markerPath) as SfdtBlock
    });
  }

  for (const tableId of nextTables.filter((id) => previous.tables.has(id))) {
    const beforeTable = previous.tables.get(tableId)!;
    const afterTable = next.tables.get(tableId)!;
    const beforeIds = new Set(beforeTable.rows.map((row) => row.rowId));
    const afterIds = new Set(afterTable.rows.map((row) => row.rowId));
    for (const row of beforeTable.rows)
      if (!afterIds.has(row.rowId))
        commands.push({ type: 'remove-row', tableId, rowId: row.rowId! });
    for (let i = 0; i < afterTable.rows.length; i++) {
      const row = afterTable.rows[i];
      if (!beforeIds.has(row.rowId))
        commands.push({
          type: 'add-row',
          tableId,
          afterRowId: i ? afterTable.rows[i - 1].rowId : null,
          rowId: row.rowId!
        });
    }
    for (const row of afterTable.rows) {
      for (const occurrence of row.bindings.values()) {
        if (occurrence.def.kind !== 'field') continue;
        const prior = beforeTable.rows
          .find((candidate) => candidate.rowId === row.rowId)
          ?.bindings.get(occurrence.name);
        if (prior?.text === occurrence.text) continue;
        commands.push({
          type: 'set-value',
          tableId,
          rowId: row.rowId!,
          name: occurrence.name,
          value: parseDisplay(occurrence.def.fieldType, occurrence.text)
        });
      }
    }
  }
  for (const [name, occurrences] of next.fields) {
    const occurrence = occurrences[0];
    if (!occurrence || previous.fields.get(name)?.[0]?.text === occurrence.text)
      continue;
    commands.push({
      type: 'set-value',
      name,
      value: parseDisplay(occurrence.def.fieldType, occurrence.text)
    });
  }
  return commands;
}
