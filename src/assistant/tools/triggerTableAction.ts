import {
  buildRowData,
  findTableOnCurrentStep,
  getLiveStepKey,
  getTableCapabilities,
  snapshotInlineErrors,
  type TableLookupErrorType
} from './utils';

type TableActionErrorType =
  | TableLookupErrorType
  | 'unknown_action'
  | 'not_allowed'
  | 'row_out_of_range'
  | 'not_mounted'
  | 'dispatch_failed';

type TableActionResult =
  | {
      ok: true;
      navigated: { fromStepKey: string; toStepKey: string } | null;
      fieldErrors?: Record<string, string>;
    }
  | {
      ok: false;
      errorType: TableActionErrorType;
      error: string;
    };

export async function dispatchTriggerTableAction(
  formUuid: string | undefined,
  tableId: string,
  rowIndex: number,
  actionLabel: string | undefined
): Promise<TableActionResult> {
  const lookup = findTableOnCurrentStep(formUuid, tableId);
  if (!lookup.ok) return lookup;
  const { state, table, rowCount } = lookup.found;

  const hasLabel = typeof actionLabel === 'string' && actionLabel.length > 0;
  if (actionLabel !== undefined && !hasLabel) {
    return {
      ok: false,
      errorType: 'shape_mismatch',
      error: 'actionLabel must be a non-empty string when provided.'
    };
  }
  if (!Number.isInteger(rowIndex) || rowIndex < 0) {
    return {
      ok: false,
      errorType: 'shape_mismatch',
      error: 'rowIndex must be a non-negative integer.'
    };
  }
  if (hasLabel) {
    const actions = Array.isArray(table?.properties?.actions)
      ? table.properties.actions
      : [];
    if (!actions.some((a: any) => a?.label === actionLabel)) {
      return {
        ok: false,
        errorType: 'unknown_action',
        error: `Table '${tableId}' has no action labeled '${actionLabel}'.`
      };
    }
  } else if (getTableCapabilities(table, rowCount).canEditCells) {
    // Editable tables suppress the bare row click, so the user can't fire it either
    return {
      ok: false,
      errorType: 'not_allowed',
      error: `Table '${tableId}' is editable, so bare row clicks are not wired; use a named action.`
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

  const rowData = buildRowData(lookup.found, rowIndex);
  const fromStepKey = getLiveStepKey(state);
  const errorsBefore = snapshotInlineErrors(state);

  try {
    await state.assistantClient.runTableAction({
      table,
      payload: hasLabel
        ? { action: actionLabel as string, rowIndex, rowData }
        : { rowIndex, rowData }
    });
  } catch (err) {
    return {
      ok: false,
      errorType: 'dispatch_failed',
      error: err instanceof Error ? err.message : String(err)
    };
  }

  const toStepKey = getLiveStepKey(state) ?? fromStepKey;
  const errorsAfter = snapshotInlineErrors(state);
  const fieldErrors: Record<string, string> = {};
  for (const key of Object.keys(errorsAfter)) {
    if (errorsAfter[key] !== errorsBefore[key])
      fieldErrors[key] = errorsAfter[key];
  }

  return {
    ok: true,
    navigated: toStepKey !== fromStepKey ? { fromStepKey, toStepKey } : null,
    ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {})
  };
}
