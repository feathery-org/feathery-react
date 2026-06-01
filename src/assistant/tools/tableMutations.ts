import {
  findTableOnCurrentStep,
  getTableCapabilities,
  type TableLookupErrorType
} from './utils';

type TableMutationErrorType =
  | TableLookupErrorType
  | 'not_allowed'
  | 'row_out_of_range'
  | 'unknown_field'
  | 'not_mounted'
  | 'dispatch_failed';

type TableMutationFailure = {
  ok: false;
  errorType: TableMutationErrorType;
  error: string;
};

type TableMutationResult = { ok: true } | TableMutationFailure;

type CellResult =
  | {
      rowIndex: number;
      fieldKey: string;
      ok: true;
      value: unknown;
      priorValue: unknown;
    }
  | {
      rowIndex: number;
      fieldKey: string;
      ok: false;
      errorType: TableMutationErrorType;
      error: string;
    };

type CellBatchResult = { results: CellResult[] };

const validateRowIndex = (
  rowIndex: number,
  rowCount: number
): TableMutationFailure | null => {
  if (!Number.isInteger(rowIndex) || rowIndex < 0) {
    return {
      ok: false,
      errorType: 'shape_mismatch',
      error: 'rowIndex must be a non-negative integer.'
    };
  }
  if (rowIndex >= rowCount) {
    return {
      ok: false,
      errorType: 'row_out_of_range',
      error: `Row ${rowIndex} is out of range (table has ${rowCount} row${
        rowCount === 1 ? '' : 's'
      }).`
    };
  }
  return null;
};

type Capability = 'add' | 'del' | 'edit';

const CAPABILITY_LABELS: Record<Capability, string> = {
  add: 'adding rows',
  del: 'deleting rows',
  edit: 'cell editing'
};

const requireCapability = (
  table: any,
  tableId: string,
  capability: Capability,
  rowCount: number
): TableMutationFailure | null => {
  const caps = getTableCapabilities(table, rowCount);
  const allowed =
    (capability === 'add' && caps.canAddRows) ||
    (capability === 'del' && caps.canDeleteRows) ||
    (capability === 'edit' && caps.canEditCells);
  if (allowed) return null;
  return {
    ok: false,
    errorType: 'not_allowed',
    error: `Table '${tableId}' does not allow ${CAPABILITY_LABELS[capability]}.`
  };
};

export async function dispatchAddTableRow(
  formUuid: string | undefined,
  tableId: string
): Promise<TableMutationResult> {
  const lookup = findTableOnCurrentStep(formUuid, tableId);
  if (!lookup.ok) return lookup;
  const { state, table, rowCount } = lookup.found;

  const cap = requireCapability(table, tableId, 'add', rowCount);
  if (cap) return cap;

  try {
    if (!state.assistantClient.addTableRow(tableId)) {
      return {
        ok: false,
        errorType: 'not_mounted',
        error: `Table '${tableId}' is not mounted yet.`
      };
    }
  } catch (err) {
    return {
      ok: false,
      errorType: 'dispatch_failed',
      error: err instanceof Error ? err.message : String(err)
    };
  }
  return { ok: true };
}

export async function dispatchDeleteTableRow(
  formUuid: string | undefined,
  tableId: string,
  rowIndex: number
): Promise<TableMutationResult> {
  const lookup = findTableOnCurrentStep(formUuid, tableId);
  if (!lookup.ok) return lookup;
  const { state, table, rowCount } = lookup.found;

  const cap = requireCapability(table, tableId, 'del', rowCount);
  if (cap) return cap;
  const rowErr = validateRowIndex(rowIndex, rowCount);
  if (rowErr) return rowErr;

  try {
    if (!state.assistantClient.deleteTableRow(tableId, rowIndex)) {
      return {
        ok: false,
        errorType: 'not_mounted',
        error: `Table '${tableId}' is not mounted yet.`
      };
    }
  } catch (err) {
    return {
      ok: false,
      errorType: 'dispatch_failed',
      error: err instanceof Error ? err.message : String(err)
    };
  }
  return { ok: true };
}

type CellInput = { rowIndex: unknown; fieldKey: unknown; value: unknown };

export async function dispatchSetTableCellValue(
  formUuid: string | undefined,
  tableId: string,
  cells: CellInput[]
): Promise<CellBatchResult> {
  const safeCells = (Array.isArray(cells) ? cells : []).map((c) => ({
    rowIndex: typeof c?.rowIndex === 'number' ? c.rowIndex : NaN,
    fieldKey: typeof c?.fieldKey === 'string' ? c.fieldKey : '',
    value: c?.value
  }));

  // Table-level failures fan out to every cell so the result shape is uniform
  const fanOut = (
    errorType: TableMutationErrorType,
    error: string
  ): CellBatchResult => ({
    results: safeCells.map((c) => ({
      rowIndex: c.rowIndex,
      fieldKey: c.fieldKey,
      ok: false,
      errorType,
      error
    }))
  });

  const lookup = findTableOnCurrentStep(formUuid, tableId);
  if (!lookup.ok) return fanOut(lookup.errorType, lookup.error);
  const { state, table, columns, rowCount } = lookup.found;

  const cap = requireCapability(table, tableId, 'edit', rowCount);
  if (cap) return fanOut(cap.errorType, cap.error);

  const priorValues = new Map<string, unknown>(
    safeCells
      .filter((c) => c.fieldKey)
      .map((c) => {
        const v = state.fields?.[c.fieldKey]?.value;
        const prior = Array.isArray(v) ? v[c.rowIndex] : undefined;
        return [
          `${c.fieldKey}:${c.rowIndex}`,
          prior == null ? null : JSON.parse(JSON.stringify(prior))
        ];
      })
  );

  const results: CellResult[] = [];
  for (const c of safeCells) {
    const { rowIndex, fieldKey, value } = c;
    if (!fieldKey) {
      results.push({
        rowIndex,
        fieldKey,
        ok: false,
        errorType: 'shape_mismatch',
        error: 'fieldKey is required.'
      });
      continue;
    }
    if (!columns.some((col: any) => col?.field_key === fieldKey)) {
      results.push({
        rowIndex,
        fieldKey,
        ok: false,
        errorType: 'unknown_field',
        error: `Table '${tableId}' has no column with fieldKey '${fieldKey}'.`
      });
      continue;
    }
    const rowErr = validateRowIndex(rowIndex, rowCount);
    if (rowErr) {
      results.push({
        rowIndex,
        fieldKey,
        ok: false,
        errorType: rowErr.errorType,
        error: rowErr.error
      });
      continue;
    }
    // Write what typing would produce: text only, clear as empty string
    const writeValue = value == null ? '' : String(value);
    try {
      if (
        !state.assistantClient.editTableCell(
          tableId,
          rowIndex,
          fieldKey,
          writeValue
        )
      ) {
        results.push({
          rowIndex,
          fieldKey,
          ok: false,
          errorType: 'not_mounted',
          error: `Table '${tableId}' is not mounted yet.`
        });
        continue;
      }
    } catch (err) {
      results.push({
        rowIndex,
        fieldKey,
        ok: false,
        errorType: 'dispatch_failed',
        error: err instanceof Error ? err.message : String(err)
      });
      continue;
    }
    results.push({
      rowIndex,
      fieldKey,
      ok: true,
      value: writeValue,
      priorValue: priorValues.get(`${fieldKey}:${rowIndex}`) ?? null
    });
  }

  return { results };
}
