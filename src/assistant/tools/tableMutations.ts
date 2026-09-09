import type {
  TableCellIssue,
  TableCellTarget,
  TableIssuesRead
} from '../AssistantClient';
import type {
  TableIssue,
  TableRowRef,
  UnresolvedIssue
} from '../../elements/basic/TableElement/spreadsheet/issues';
import {
  findTableOnCurrentStep,
  type TableCapabilities,
  type TableLookupErrorType,
  validateRowTarget
} from './utils';

type TableMutationErrorType =
  | TableLookupErrorType
  | 'not_allowed'
  | 'row_out_of_range'
  | 'row_deleted'
  | 'unknown_field'
  | 'read_only'
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

type Capability = 'add' | 'del' | 'edit';

const CAPABILITY_LABELS: Record<Capability, string> = {
  add: 'adding rows',
  del: 'deleting rows',
  edit: 'cell editing'
};

const requireCapability = (
  caps: TableCapabilities,
  tableId: string,
  capability: Capability
): TableMutationFailure | null => {
  const allowed =
    (capability === 'add' && caps.canAddRows) ||
    (capability === 'del' && caps.canDeleteRows) ||
    (capability === 'edit' && caps.canEditCells);
  if (allowed) return null;
  return {
    ok: false,
    errorType: 'not_allowed',
    error: `Table '${tableId}' does not allow ${CAPABILITY_LABELS[capability]} right now.`
  };
};

export async function dispatchAddTableRow(
  formUuid: string | undefined,
  tableId: string
): Promise<TableMutationResult> {
  const lookup = findTableOnCurrentStep(formUuid, tableId);
  if (!lookup.ok) return lookup;
  const { state } = lookup.found;

  const cap = requireCapability(lookup.found.capabilities, tableId, 'add');
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
  const { state } = lookup.found;

  const cap = requireCapability(lookup.found.capabilities, tableId, 'del');
  if (cap) return cap;
  const rowErr = validateRowTarget({ rowIndex }, lookup.found);
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
  const { state } = lookup.found;

  const cap = requireCapability(lookup.found.capabilities, tableId, 'edit');
  if (cap) return fanOut(cap.errorType, cap.error);

  const priorValues = new Map<string, unknown>(
    safeCells
      .filter((c) => c.fieldKey)
      .map((c) => {
        const prior = state.assistantClient.getTableRow(tableId, c.rowIndex)?.[
          c.fieldKey
        ];
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
    const rowErr = validateRowTarget({ rowIndex }, lookup.found);
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
    let written: unknown;
    try {
      const write = state.assistantClient.editTableCell(
        tableId,
        rowIndex,
        fieldKey,
        value
      );
      if (!write) {
        results.push({
          rowIndex,
          fieldKey,
          ok: false,
          errorType: 'not_mounted',
          error: `Table '${tableId}' is not mounted yet.`
        });
        continue;
      }
      if (!write.ok) {
        results.push({ rowIndex, fieldKey, ...write });
        continue;
      }
      written = write.value;
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
      value: written,
      priorValue: priorValues.get(`${fieldKey}:${rowIndex}`) ?? null
    });
  }

  return { results };
}

// entryId names a hub row exactly, so it wins over rowIndex when both are given
const rowTargetOf = (input: any): TableRowRef | null => {
  if (typeof input?.entryId === 'string' && input.entryId !== '')
    return { entryId: input.entryId };
  if (typeof input?.rowIndex === 'number') return { rowIndex: input.rowIndex };
  return null;
};

const noGridFailure = (tableId: string): TableMutationFailure => ({
  ok: false,
  errorType: 'not_mounted',
  error: `Table '${tableId}' has no spreadsheet grid mounted.`
});

type TableFindingRejection = {
  index: number;
  errorType:
    | 'shape_mismatch'
    | 'row_out_of_range'
    | 'row_deleted'
    | 'unknown_field'
    | 'unknown_entry'
    | 'row_not_shown';
  error: string;
};

type CellValidationResult =
  | { ok: true; applied: number; rejected: TableFindingRejection[] }
  | TableMutationFailure;

export async function dispatchSetCellValidation(
  formUuid: string | undefined,
  tableId: string,
  findings: any[]
): Promise<CellValidationResult> {
  const lookup = findTableOnCurrentStep(formUuid, tableId);
  if (!lookup.ok) return lookup;
  const { state } = lookup.found;

  const rejected: TableFindingRejection[] = [];
  // Each issue's place in the request, so a grid rejection can name its finding
  const findingIndexes: number[] = [];
  const issues: TableIssue[] = [];
  findings.forEach((finding: any, index: number) => {
    const reject = (
      errorType: TableFindingRejection['errorType'],
      error: string
    ) => rejected.push({ index, errorType, error });
    const row = rowTargetOf(finding);
    if (!row) {
      reject('shape_mismatch', 'Pass rowIndex or entryId.');
      return;
    }
    const rowErr = validateRowTarget(row, lookup.found);
    if (rowErr) {
      reject(rowErr.errorType, rowErr.error);
      return;
    }
    // An empty fieldKey is the model's way of saying row-level
    const field = finding.fieldKey || undefined;
    // The model fills an omitted suggestedValue with null rather than dropping it
    const suggested = finding.suggestedValue;
    const hasSuggestion =
      suggested !== undefined && suggested !== null && suggested !== '';
    const issue: TableIssue = {
      target:
        field === undefined
          ? { kind: 'row', row }
          : { kind: 'cell', row, field },
      message: hasSuggestion
        ? `${finding.message} Suggested: ${suggested}`
        : finding.message
    };
    findingIndexes.push(index);
    issues.push(issue);
  });

  let unresolved: UnresolvedIssue[] | null;
  try {
    unresolved = state.assistantClient.setTableIssues(tableId, issues);
  } catch (err) {
    return {
      ok: false,
      errorType: 'dispatch_failed',
      error: err instanceof Error ? err.message : String(err)
    };
  }
  if (!unresolved) return noGridFailure(tableId);

  unresolved.forEach(({ index: issueIndex, reason }) => {
    const index = findingIndexes[issueIndex];
    const finding = findings[index];
    if (reason === 'unknown_field') {
      rejected.push({
        index,
        errorType: 'unknown_field',
        error: `Table '${tableId}' has no column named '${finding.fieldKey}'.`
      });
    } else if (finding.entryId) {
      rejected.push({
        index,
        errorType: 'unknown_entry',
        error: `Table '${tableId}' has no loaded row with entryId '${finding.entryId}', a row filter may hide it.`
      });
    } else {
      rejected.push({
        index,
        errorType: 'row_not_shown',
        error: `Row ${finding.rowIndex} of table '${tableId}' is not shown right now.`
      });
    }
  });

  return {
    ok: true,
    applied: issues.length - unresolved.length,
    rejected: rejected.sort((a, b) => a.index - b.index)
  };
}

type FocusCellResult =
  | { ok: true; rowIndex: number }
  | {
      ok: false;
      errorType: TableMutationErrorType | 'unknown_entry' | 'row_hidden';
      error: string;
    };

export async function dispatchFocusTableCell(
  formUuid: string | undefined,
  tableId: string,
  input: unknown
): Promise<FocusCellResult> {
  const lookup = findTableOnCurrentStep(formUuid, tableId);
  if (!lookup.ok) return lookup;
  const { state } = lookup.found;

  const target = rowTargetOf(input);
  if (!target) {
    return {
      ok: false,
      errorType: 'shape_mismatch',
      error: 'Pass rowIndex or entryId.'
    };
  }
  // No fieldKey means the whole row, so the table selects all of it
  const fieldKey = (input as any)?.fieldKey || undefined;
  if (fieldKey !== undefined && typeof fieldKey !== 'string') {
    return {
      ok: false,
      errorType: 'shape_mismatch',
      error: 'fieldKey must be a column field key.'
    };
  }
  const rowErr = validateRowTarget(target, lookup.found);
  if (rowErr) return rowErr;

  const cellTarget: TableCellTarget = { ...target, fieldKey };
  let outcome;
  try {
    outcome = state.assistantClient.focusTableCell(tableId, cellTarget);
  } catch (err) {
    return {
      ok: false,
      errorType: 'dispatch_failed',
      error: err instanceof Error ? err.message : String(err)
    };
  }
  return outcome ?? noGridFailure(tableId);
}

type ReadIssue = Omit<TableCellIssue, 'rowIndex' | 'entryId'>;

type IssueGroup = ReadIssue & { count: number; rowIndexes: number[] };

type TableIssuesResult =
  | { ok: true; rowIndex?: number; entryId?: string; issues: ReadIssue[] }
  | { ok: true; total: number; groups: IssueGroup[] }
  | {
      ok: false;
      errorType: TableMutationErrorType | 'unknown_entry';
      error: string;
    };

// Enough of a group's rows to act on without spending the reply on row numbers
const ROW_INDEXES_PER_GROUP = 50;

const withoutRow = (cell: TableCellIssue): ReadIssue => ({
  ...(cell.fieldKey === undefined ? {} : { fieldKey: cell.fieldKey }),
  ...(cell.columnName === undefined ? {} : { columnName: cell.columnName }),
  message: cell.message,
  severity: cell.severity,
  source: cell.source
});

export async function dispatchGetTableIssues(
  formUuid: string | undefined,
  tableId: string,
  input: unknown
): Promise<TableIssuesResult> {
  const lookup = findTableOnCurrentStep(formUuid, tableId);
  if (!lookup.ok) return lookup;
  const { state } = lookup.found;

  const isRowScope = (input as any)?.scope === 'row';
  const target = isRowScope ? rowTargetOf(input) : null;
  if (isRowScope) {
    if (!target) {
      return {
        ok: false,
        errorType: 'shape_mismatch',
        error: 'Pass rowIndex or entryId.'
      };
    }
    const rowErr = validateRowTarget(target, lookup.found);
    if (rowErr) return rowErr;
  }

  let read: TableIssuesRead | null;
  try {
    read = state.assistantClient.getTableIssues(tableId, target ?? undefined);
  } catch (err) {
    return {
      ok: false,
      errorType: 'dispatch_failed',
      error: err instanceof Error ? err.message : String(err)
    };
  }
  if (!read) return noGridFailure(tableId);
  if (!read.ok) {
    if (read.reason === 'not_mounted') return noGridFailure(tableId);
    // A rowIndex was range-checked above, so only an entryId can be unknown here
    const entryId = target && 'entryId' in target ? target.entryId : '';
    return {
      ok: false,
      errorType: 'unknown_entry',
      error: `Table '${tableId}' has no loaded row with entryId '${entryId}', a row filter may hide it.`
    };
  }

  if (target) {
    return {
      ok: true,
      ...(read.rowIndex === undefined ? {} : { rowIndex: read.rowIndex }),
      ...('entryId' in target ? { entryId: target.entryId } : {}),
      issues: read.cells.map(withoutRow)
    };
  }

  const groups = new Map<string, IssueGroup>();
  read.cells.forEach((cell) => {
    const key = `${cell.source}|${cell.severity}|${cell.message}|${
      cell.fieldKey ?? ''
    }`;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        ...withoutRow(cell),
        count: 1,
        rowIndexes: [cell.rowIndex]
      });
      return;
    }
    group.count += 1;
    if (group.rowIndexes.length < ROW_INDEXES_PER_GROUP)
      group.rowIndexes.push(cell.rowIndex);
  });

  return {
    ok: true,
    total: read.cells.length,
    groups: [...groups.values()].sort((a, b) => b.count - a.count)
  };
}
