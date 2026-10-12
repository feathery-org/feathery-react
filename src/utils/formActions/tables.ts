import internalState from '../internalState';
import { getPositionKey } from '../hideAndRepeats';
import {
  awaitPendingInlineErrors,
  diffInlineErrorSnapshots,
  getLiveStepKey,
  InlineErrorReport,
  NOT_LOADED_MESSAGE,
  snapshotInlineErrors
} from './utils';

export const TABLE_ROWS_READ_LIMIT = 50;

export type TableCellValue = string | number | boolean | null;

// A hub row is named by its entry id, every other row by its index in the source data
export type TableRowTarget = { rowIndex?: number; entryId?: string };

export type TableLiveState = {
  hubId?: string;
  columns: Array<{ name: string; fieldKey: string; readOnly?: boolean }>;
  rowCount: number;
  canEditCells: boolean;
  canAddRows: boolean;
  canDeleteRows: boolean;
  showsActions: boolean;
  allowsRowClick: boolean;
  buffersEdits: boolean;
  entryIds?: Array<string | null>;
  pending?: { edits: number; deletions: number };
};

export type TableRowRead = {
  rowIndex: number;
  entryId?: string | null;
  values: Record<string, unknown>;
  pending?: true;
};

export type TableCellWrite = {
  rowIndex: number;
  fieldKey: string;
  value: TableCellValue;
};

export type TableCellOutcome =
  | { ok: true; value: unknown }
  | {
      ok: false;
      reason: 'row_deleted' | 'unknown_column' | 'read_only';
      message: string;
    };

// Registered by the mounted grid, the only path by which the form's host reads or writes a table
export type TableHandlers = {
  getLiveState: () => TableLiveState;
  getRow: (rowIndex: number) => Record<string, unknown> | null;
  getRows: (query: { offset: number; limit: number; search?: string }) => {
    rowCount: number;
    rows: TableRowRead[];
  };
  editCells: (writes: TableCellWrite[]) => TableCellOutcome[];
  addRow: () => number;
  deleteRow: (rowIndex: number) => void;
  runAction: (rowIndex: number, actionLabel?: string) => Promise<void>;
};

type TableRejectReason =
  | 'not_loaded'
  | 'not_on_step'
  | 'hidden'
  | 'not_mounted'
  | 'not_allowed'
  | 'unknown_row'
  | 'row_deleted'
  | 'unknown_action'
  | 'action_failed';

export type TableActionFailure = {
  ok: false;
  reason: TableRejectReason;
  message: string;
};

export type GetTableRowsResult =
  | { ok: true; rowCount: number; offset: number; rows: TableRowRead[] }
  | TableActionFailure;

export type SetTableCellsInput = TableRowTarget & {
  fieldKey: string;
  value: TableCellValue;
};

type ResolvedRow = { rowIndex: number; entryId?: string | null };

type AppliedCell = ResolvedRow & {
  fieldKey: string;
  value: unknown;
  priorValue: unknown;
  pending?: true;
};

type RejectedCell = {
  rowIndex?: number;
  entryId?: string | null;
  fieldKey: string;
  reason: 'unknown_row' | 'row_deleted' | 'unknown_column' | 'read_only';
  message: string;
};

export type SetTableCellsResult =
  | { ok: true; applied: AppliedCell[]; rejected: RejectedCell[] }
  | TableActionFailure;

export type TableRowMutationResult =
  | (ResolvedRow & { ok: true; rowCount: number; pending?: true })
  | TableActionFailure;

export type TriggerTableActionResult =
  | {
      ok: true;
      navigated: { fromStepKey: string; toStepKey: string } | null;
      fieldErrors?: InlineErrorReport[];
    }
  | TableActionFailure;

type FoundTable = {
  state: any;
  table: any;
  handlers: TableHandlers;
  live: TableLiveState;
};

function findTable(
  formUuid: string,
  tableId: string
): ({ ok: true } & FoundTable) | TableActionFailure {
  const state = internalState[formUuid];
  if (!state?.currentStep) {
    return { ok: false, reason: 'not_loaded', message: NOT_LOADED_MESSAGE };
  }
  const table = (state.currentStep.tables ?? []).find(
    (t: any) => t?.id === tableId
  );
  if (!table) {
    return {
      ok: false,
      reason: 'not_on_step',
      message: `Table '${tableId}' is not on the current step.`
    };
  }
  const flags = state.visiblePositions?.[getPositionKey(table) ?? 'root'];
  if (Array.isArray(flags) && !flags.some(Boolean)) {
    return {
      ok: false,
      reason: 'hidden',
      message: `Table '${tableId}' is on the current step but is hidden right now.`
    };
  }
  const handlers = state.tables?.get(tableId);
  if (!handlers) {
    return {
      ok: false,
      reason: 'not_mounted',
      message: `Table '${tableId}' is not rendered right now, so it cannot be read or edited.`
    };
  }
  return { ok: true, state, table, handlers, live: handlers.getLiveState() };
}

const notAllowed = (tableId: string, what: string): TableActionFailure => ({
  ok: false,
  reason: 'not_allowed',
  message: `Table '${tableId}' does not allow ${what} right now.`
});

// entryId names a hub row exactly, so it wins over rowIndex when both are given
function resolveRow(
  target: TableRowTarget,
  live: TableLiveState
): ({ ok: true } & ResolvedRow) | TableActionFailure {
  if (target.entryId) {
    const rowIndex = live.entryIds?.indexOf(target.entryId) ?? -1;
    if (rowIndex === -1) {
      return {
        ok: false,
        reason: 'unknown_row',
        message: `Entry '${target.entryId}' is not shown in this table, a row filter may hide it.`
      };
    }
    return { ok: true, rowIndex, entryId: target.entryId };
  }
  const { rowIndex } = target;
  if (typeof rowIndex !== 'number') {
    return {
      ok: false,
      reason: 'unknown_row',
      message: 'Name the row with rowIndex or entryId.'
    };
  }
  if (
    !Number.isInteger(rowIndex) ||
    rowIndex < 0 ||
    rowIndex >= live.rowCount
  ) {
    return {
      ok: false,
      reason: 'unknown_row',
      message: `Row ${rowIndex} is out of range (table has ${
        live.rowCount
      } row${live.rowCount === 1 ? '' : 's'}).`
    };
  }
  return {
    ok: true,
    rowIndex,
    ...(live.entryIds ? { entryId: live.entryIds[rowIndex] ?? null } : {})
  };
}

const rowDeleted = (rowIndex: number): TableActionFailure => ({
  ok: false,
  reason: 'row_deleted',
  message: `Row ${rowIndex} was removed and is waiting on the table's save.`
});

export function getTableRows(
  formUuid: string,
  tableId: string,
  query: { offset?: number; limit?: number; search?: string } = {}
): GetTableRowsResult {
  const found = findTable(formUuid, tableId);
  if (!found.ok) return found;
  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.min(
    Math.max(1, query.limit ?? TABLE_ROWS_READ_LIMIT),
    TABLE_ROWS_READ_LIMIT
  );
  const { rowCount, rows } = found.handlers.getRows({
    offset,
    limit,
    search: query.search?.trim() || undefined
  });
  return { ok: true, rowCount, offset, rows };
}

export function setTableCells(
  formUuid: string,
  tableId: string,
  cells: SetTableCellsInput[]
): SetTableCellsResult {
  const found = findTable(formUuid, tableId);
  if (!found.ok) return found;
  const { handlers, live } = found;
  if (!live.canEditCells) return notAllowed(tableId, 'cell editing');

  type Verdict = AppliedCell | RejectedCell;
  const verdicts: Verdict[] = new Array(cells.length);
  const writes: TableCellWrite[] = [];
  const writeCells: number[] = [];
  cells.forEach((cell, index) => {
    const row = resolveRow(cell, live);
    if (!row.ok) {
      verdicts[index] = {
        ...(cell.rowIndex === undefined ? {} : { rowIndex: cell.rowIndex }),
        ...(cell.entryId ? { entryId: cell.entryId } : {}),
        fieldKey: cell.fieldKey,
        reason: 'unknown_row',
        message: row.message
      };
      return;
    }
    verdicts[index] = {
      rowIndex: row.rowIndex,
      ...('entryId' in row ? { entryId: row.entryId } : {}),
      fieldKey: cell.fieldKey,
      value: undefined,
      priorValue: handlers.getRow(row.rowIndex)?.[cell.fieldKey] ?? null,
      ...(live.buffersEdits ? { pending: true } : {})
    };
    writes.push({
      rowIndex: row.rowIndex,
      fieldKey: cell.fieldKey,
      value: cell.value
    });
    writeCells.push(index);
  });

  // One grid call for the whole batch, each accepted cell takes the value the grid stored
  handlers.editCells(writes).forEach((outcome, writeIndex) => {
    const index = writeCells[writeIndex];
    const { rowIndex, entryId, fieldKey } = verdicts[index];
    verdicts[index] = outcome.ok
      ? { ...verdicts[index], value: outcome.value }
      : {
          rowIndex,
          ...(entryId === undefined ? {} : { entryId }),
          fieldKey,
          reason: outcome.reason,
          message: outcome.message
        };
  });

  const isRejected = (verdict: Verdict): verdict is RejectedCell =>
    'reason' in verdict;
  return {
    ok: true,
    applied: verdicts.filter((v): v is AppliedCell => !isRejected(v)),
    rejected: verdicts.filter(isRejected)
  };
}

export function addTableRow(
  formUuid: string,
  tableId: string
): TableRowMutationResult {
  const found = findTable(formUuid, tableId);
  if (!found.ok) return found;
  const { handlers, live } = found;
  if (!live.canAddRows) return notAllowed(tableId, 'adding rows');
  const rowIndex = handlers.addRow();
  return {
    ok: true,
    rowIndex,
    ...(live.entryIds ? { entryId: null } : {}),
    rowCount: live.rowCount + 1,
    ...(live.buffersEdits ? { pending: true } : {})
  };
}

export function deleteTableRow(
  formUuid: string,
  tableId: string,
  target: TableRowTarget
): TableRowMutationResult {
  const found = findTable(formUuid, tableId);
  if (!found.ok) return found;
  const { handlers, live } = found;
  if (!live.canDeleteRows) return notAllowed(tableId, 'deleting rows');
  const row = resolveRow(target, live);
  if (!row.ok) return row;
  if (!handlers.getRow(row.rowIndex)) return rowDeleted(row.rowIndex);
  handlers.deleteRow(row.rowIndex);
  // A buffered deletion keeps its slot in the source until the person saves
  return {
    ok: true,
    rowIndex: row.rowIndex,
    ...('entryId' in row ? { entryId: row.entryId } : {}),
    rowCount: live.buffersEdits ? live.rowCount : live.rowCount - 1,
    ...(live.buffersEdits ? { pending: true } : {})
  };
}

export async function triggerTableAction(
  formUuid: string,
  tableId: string,
  target: TableRowTarget,
  actionLabel?: string
): Promise<TriggerTableActionResult> {
  const found = findTable(formUuid, tableId);
  if (!found.ok) return found;
  const { state, table, handlers, live } = found;

  if (actionLabel) {
    if (!live.showsActions) {
      return notAllowed(tableId, 'row actions, this table shows none');
    }
    const actions = Array.isArray(table.properties?.actions)
      ? table.properties.actions
      : [];
    if (!actions.some((a: any) => a?.label === actionLabel)) {
      return {
        ok: false,
        reason: 'unknown_action',
        message: `Table '${tableId}' has no action labeled '${actionLabel}'.`
      };
    }
  } else if (!live.allowsRowClick) {
    return notAllowed(
      tableId,
      'a bare row click, the person cannot click its rows either'
    );
  }
  const row = resolveRow(target, live);
  if (!row.ok) return row;
  if (!handlers.getRow(row.rowIndex)) return rowDeleted(row.rowIndex);

  const fromStepKey = getLiveStepKey(state) ?? '';
  const errorsBefore = snapshotInlineErrors(state);
  try {
    await handlers.runAction(row.rowIndex, actionLabel);
  } catch (err) {
    return {
      ok: false,
      reason: 'action_failed',
      message: err instanceof Error ? err.message : String(err)
    };
  }

  const toStepKey = getLiveStepKey(state) ?? fromStepKey;
  await awaitPendingInlineErrors(state);
  const fieldErrors = diffInlineErrorSnapshots(
    errorsBefore,
    snapshotInlineErrors(state)
  );
  return {
    ok: true,
    navigated: toStepKey !== fromStepKey ? { fromStepKey, toStepKey } : null,
    ...(fieldErrors.length > 0 ? { fieldErrors } : {})
  };
}
