import type { TableRowRef } from '../../elements/basic/TableElement/spreadsheet/issues';
import type { TableLiveState } from '../AssistantClient';
import internalState from '../../utils/internalState';
import { getPositionKey } from '../../utils/hideAndRepeats';
import { InlineErrorEntry, InlineErrors } from '../../utils/inlineErrors';

export const getLiveStepKey = (state: any): string | undefined =>
  state.latestStepName ?? state.currentStep?.key;

// One reported error, with the field key and repeat row kept as SEPARATE
// fields. Never encode the row into the key string: field keys are
// unrestricted, so a literal field named `f[0]` would collide with row 0 of a
// repeated field `f` -- the exact collision this structure exists to avoid.
export interface InlineErrorReport {
  key: string;
  repeatIndex?: number;
  message: string;
}

// Structured snapshot: field key -> { field-wide message, per-row messages }.
export type InlineErrorSnapshot = Map<
  string,
  { message?: string; byIndex: Map<number, string> }
>;

export const snapshotInlineErrors = (state: any): InlineErrorSnapshot => {
  const out: InlineErrorSnapshot = new Map();
  // Typed against the canonical shape so a rename/restructure of
  // InlineErrorEntry breaks this parity layer at compile time instead of
  // silently desyncing what the assistant reports from what renders.
  const inlineErrors: InlineErrors = state?.inlineErrors ?? {};
  for (const key of Object.keys(inlineErrors)) {
    const entry: InlineErrorEntry = inlineErrors[key] ?? {};
    const byIndex = new Map<number, string>();
    for (const [idx, data] of Object.entries(entry.byIndex ?? {})) {
      if (typeof data?.message === 'string' && data.message.length > 0)
        byIndex.set(Number(idx), data.message);
    }
    const message =
      typeof entry.message === 'string' && entry.message.length > 0
        ? entry.message
        : undefined;
    if (message || byIndex.size) out.set(key, { message, byIndex });
  }
  return out;
};

// Errors present in `after` that weren't in `before` (new or changed), keeping
// each error's (key, repeatIndex) identity intact.
export const diffInlineErrorSnapshots = (
  before: InlineErrorSnapshot,
  after: InlineErrorSnapshot
): InlineErrorReport[] => {
  const out: InlineErrorReport[] = [];
  after.forEach((entry, key) => {
    const prev = before.get(key);
    if (entry.message && entry.message !== prev?.message)
      out.push({ key, message: entry.message });
    entry.byIndex.forEach((message, repeatIndex) => {
      if (message !== prev?.byIndex.get(repeatIndex))
        out.push({ key, repeatIndex, message });
    });
  });
  return out;
};

// A button's submit error is published asynchronously (loaders must unrender
// first), so programmatic callers must await the producer's pending
// publication before snapshotting, rather than guessing with a fixed wait.
export const awaitPendingInlineErrors = async (state: any): Promise<void> => {
  const pending = state?.pendingInlineErrorPublish;
  if (pending) await pending;
};

// Subgrids whose position is a strict prefix of `position` (callers pre-filter to those whose handler does anything), innermost first.
export const findClickableAncestorSubgrids = (
  subgrids: any[] | undefined,
  position: number[]
): any[] => {
  if (
    !Array.isArray(subgrids) ||
    !Array.isArray(position) ||
    position.length === 0
  )
    return [];
  const matches: any[] = [];
  for (const sg of subgrids) {
    const pos = Array.isArray(sg?.position) ? sg.position : [];
    if (pos.length >= position.length) continue;
    let isPrefix = true;
    for (let i = 0; i < pos.length; i++) {
      if (pos[i] !== position[i]) {
        isPrefix = false;
        break;
      }
    }
    if (!isPrefix) continue;
    matches.push(sg);
  }
  matches.sort((a, b) => b.position.length - a.position.length);
  return matches;
};

export type RepeatIndexFailure = {
  errorType:
    | 'repeated_index_missing'
    | 'repeated_index_out_of_range'
    | 'repeated_index_unexpected';
  error: string;
};

export function validateRepeatIndex(
  repeatIndex: number | null | undefined,
  inRepeat: boolean,
  rowCount: number,
  id: string
): RepeatIndexFailure | null {
  if (!inRepeat) {
    if (typeof repeatIndex === 'number') {
      return {
        errorType: 'repeated_index_unexpected',
        error: `'${id}' is not in a repeated container; do not pass repeatIndex.`
      };
    }
    return null;
  }
  if (typeof repeatIndex !== 'number') {
    const range =
      rowCount === 0 ? '(none yet - add a row first)' : `0..${rowCount - 1}`;
    return {
      errorType: 'repeated_index_missing',
      error: `'${id}' is in a repeated container; pass repeatIndex ${range}.`
    };
  }
  if (repeatIndex < 0 || repeatIndex >= rowCount) {
    return {
      errorType: 'repeated_index_out_of_range',
      error: `repeatIndex ${repeatIndex} is out of range for '${id}' (rowCount ${rowCount}).`
    };
  }
  return null;
}

export type TableLookupErrorType =
  | 'no_form_state'
  | 'shape_mismatch'
  | 'not_on_step'
  | 'hidden';

export type TableCapabilities = {
  canEditCells: boolean;
  canAddRows: boolean;
  canDeleteRows: boolean;
};

export type FoundTable = {
  state: any;
  table: any;
  columns: Array<{ name: string; field_key?: string }>;
  fieldKeys: string[];
  isMounted: boolean;
  rowCount: number;
  capabilities: TableCapabilities;
  // Rows the user removed from the grid, still in the source until the save
  pendingDeletions: Array<{ rowIndex: number; entryId?: string }>;
};

export type RowTargetFailure = {
  ok: false;
  errorType: 'shape_mismatch' | 'row_out_of_range' | 'row_deleted';
  error: string;
};

// One gate for every row-targeting tool, so a row that left the grid stays
// unaddressable until its deletion saves
export const validateRowTarget = (
  target: TableRowRef,
  found: FoundTable
): RowTargetFailure | null => {
  if ('rowIndex' in target) {
    if (!Number.isInteger(target.rowIndex) || target.rowIndex < 0) {
      return {
        ok: false,
        errorType: 'shape_mismatch',
        error: 'rowIndex must be a non-negative integer.'
      };
    }
    if (target.rowIndex >= found.rowCount) {
      return {
        ok: false,
        errorType: 'row_out_of_range',
        error: `Row ${target.rowIndex} is out of range (table has ${
          found.rowCount
        } row${found.rowCount === 1 ? '' : 's'}).`
      };
    }
  }
  const deleted = found.pendingDeletions.some((row) =>
    'entryId' in target
      ? row.entryId === target.entryId
      : row.rowIndex === target.rowIndex
  );
  if (!deleted) return null;
  const name =
    'entryId' in target
      ? `Entry '${target.entryId}'`
      : `Row ${target.rowIndex}`;
  return {
    ok: false,
    errorType: 'row_deleted',
    error: `${name} was removed from the grid and is waiting on the save.`
  };
};

// A hub column is named by its Hub field key, a form-backed one by its field key
export const tableColumnFieldKey = (table: any, col: any): string =>
  (table?.properties?.data_source === 'hub'
    ? col?.hub_field_key
    : col?.field_key) ?? '';

export type TableLookupResult =
  | { ok: true; found: FoundTable }
  | { ok: false; errorType: TableLookupErrorType; error: string };

export const findTableOnCurrentStep = (
  formUuid: string | undefined,
  tableId: string
): TableLookupResult => {
  if (!formUuid) {
    return {
      ok: false,
      errorType: 'no_form_state',
      error: 'Form has not loaded yet.'
    };
  }
  const state = internalState[formUuid];
  if (!state || !state.currentStep || !state.assistantClient) {
    return {
      ok: false,
      errorType: 'no_form_state',
      error: 'Form has not loaded yet.'
    };
  }
  if (typeof tableId !== 'string' || tableId.length === 0) {
    return {
      ok: false,
      errorType: 'shape_mismatch',
      error: 'tableId is required.'
    };
  }
  const table = (state.currentStep.tables ?? []).find(
    (t: any) => t?.id === tableId
  );
  if (!table) {
    return {
      ok: false,
      errorType: 'not_on_step',
      error: `Table '${tableId}' is not on the current step.`
    };
  }
  const flags = state.visiblePositions?.[getPositionKey(table) ?? 'root'];
  if (Array.isArray(flags) && !flags.some(Boolean)) {
    return {
      ok: false,
      errorType: 'hidden',
      error: `Table '${tableId}' is on the current step but is hidden right now.`
    };
  }
  const columns = Array.isArray(table?.properties?.columns)
    ? table.properties.columns
    : [];
  const fieldKeys = columns
    .map((col: any) => tableColumnFieldKey(table, col))
    .filter(Boolean);
  const fieldsMap = state.fields ?? {};
  const fieldRowCount = columns.reduce((max: number, col: any) => {
    const v = col?.field_key ? fieldsMap[col.field_key]?.value : undefined;
    return Array.isArray(v) ? Math.max(max, v.length) : max;
  }, 0);
  // A mounted table knows its real row count, which for a hub table is not in the form fields at all
  const liveState = state.assistantClient.getTableLiveState?.(tableId);
  const rowCount = liveState?.rowCount ?? fieldRowCount;
  return {
    ok: true,
    found: {
      state,
      table,
      columns,
      fieldKeys,
      isMounted: !!liveState,
      rowCount,
      capabilities: getTableCapabilities(table, rowCount, liveState),
      pendingDeletions: liveState?.pendingDeletions ?? []
    }
  };
};

export const getTableCapabilities = (
  table: any,
  rowCount: number,
  liveState?: TableLiveState | null
): TableCapabilities => {
  // A mounted table grants what its grid lets the user do
  if (liveState) {
    return {
      canEditCells: !!liveState.canEditCells,
      canAddRows: !!liveState.canAddRows,
      canDeleteRows: !!liveState.canDeleteRows
    };
  }
  const props = table?.properties ?? {};
  // Hub rows live in the Data Hub, so only the mounted grid can address them by row index
  if (props.data_source === 'hub') {
    return { canEditCells: false, canAddRows: false, canDeleteRows: false };
  }
  // A transpose table with zero rows renders un-transposed, so it stays editable
  const canEditCells =
    !!props.enable_editing && !(props.transpose && rowCount > 0);
  const addDelete = canEditCells && !!props.add_delete_rows;
  return { canEditCells, canAddRows: addDelete, canDeleteRows: addDelete };
};

// Keyed by column name, the shape the table's own row click sends
export const buildRowData = (
  found: FoundTable,
  rowIndex: number
): Record<string, any> => {
  const rowData: Record<string, any> = {};
  const tableId = found.table?.id ?? '';
  const mountedRow = found.isMounted
    ? found.state.assistantClient.getTableRow?.(tableId, rowIndex)
    : null;
  if (mountedRow) {
    const liveColumns =
      found.state.assistantClient.getTableColumns?.(tableId) ?? [];
    for (const col of liveColumns) {
      rowData[col.name] = mountedRow[tableColumnFieldKey(found.table, col)];
    }
    return rowData;
  }
  for (const col of found.columns) {
    if (!col?.field_key) continue;
    const v = found.state.fields?.[col.field_key]?.value;
    const cValue = Array.isArray(v) ? v[rowIndex] : v;
    rowData[col.name] = cValue;
  }
  return rowData;
};
