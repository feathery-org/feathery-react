import internalState from '../../utils/internalState';
import { getPositionKey } from '../../utils/hideAndRepeats';

export function snapshotInlineErrors(state: any): Record<string, string> {
  const out: Record<string, string> = {};
  const inlineErrors = state?.inlineErrors ?? {};
  for (const key of Object.keys(inlineErrors)) {
    const message = inlineErrors[key]?.message;
    if (typeof message === 'string' && message.length > 0) out[key] = message;
  }
  return out;
}

// Subgrids whose position is a strict prefix of `position` (callers pre-filter to those whose handler does anything), innermost first.
export function findClickableAncestorSubgrids(
  subgrids: any[] | undefined,
  position: number[]
): any[] {
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
}

type RepeatIndexFailure = {
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

type FoundTable = {
  state: any;
  table: any;
  columns: Array<{ name: string; field_key?: string }>;
  rowCount: number;
};

type TableLookupResult =
  | { ok: true; found: FoundTable }
  | { ok: false; errorType: TableLookupErrorType; error: string };

export function findTableOnCurrentStep(
  formUuid: string | undefined,
  tableId: string
): TableLookupResult {
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
  const fieldsMap = state.fields ?? {};
  const rowCount = columns.reduce((max: number, col: any) => {
    const v = col?.field_key ? fieldsMap[col.field_key]?.value : undefined;
    return Array.isArray(v) ? Math.max(max, v.length) : max;
  }, 0);
  return { ok: true, found: { state, table, columns, rowCount } };
}

export function getTableCapabilities(
  table: any,
  rowCount: number
): { canEditCells: boolean; canAddRows: boolean; canDeleteRows: boolean } {
  const props = table?.properties ?? {};
  // A transpose table with zero rows renders un-transposed, so it stays editable
  const canEditCells =
    !!props.enable_editing && !(props.transpose && rowCount > 0);
  const addDelete = canEditCells && !!props.add_delete_rows;
  return { canEditCells, canAddRows: addDelete, canDeleteRows: addDelete };
}

export function buildRowData(
  found: FoundTable,
  rowIndex: number
): Record<string, any> {
  const rowData: Record<string, any> = {};
  for (const col of found.columns) {
    if (!col?.field_key) continue;
    const v = found.state.fields?.[col.field_key]?.value;
    const cValue = Array.isArray(v) ? v[rowIndex] : v;
    rowData[col.name] = cValue;
  }
  return rowData;
}
