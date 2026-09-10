import { CellErrors, cellErrorKey } from './validation';

/**
 * What is wrong with a cell, and how much it matters.
 *
 * Severity and blocking are fixed by where an issue came from — not chosen per
 * issue — so the grid reads consistently:
 *
 *  - `hub_rule`: the Data Hub's own field rules (required, format, options,
 *    unique…). Always an error (red). It blocks the save on a verified row,
 *    because the hub would reject the write anyway. On an unverified row it
 *    is still red — the value is wrong — but the save goes through: staged
 *    data exists to be corrected, and a half-fixed row is better stored than
 *    lost.
 *  - `assistant`: a custom check run by the Feathery assistant against the
 *    table (a verification rule, a cross-reference, a judgement call). Always
 *    a warning (orange), never blocking — the hub has no rule behind it.
 */
export type IssueSource = 'hub_rule' | 'assistant';
export type IssueSeverity = 'error' | 'warning';

export type CellIssue = {
  message: string;
  source: IssueSource;
  severity: IssueSeverity;
  blocking: boolean;
};

/** `${rowIndex}:${fieldKey}` -> the issue shown on that cell. */
export type CellIssues = Record<string, CellIssue>;

/**
 * How the assistant names a row: by its position in the table, or — for a
 * Data Hub table — by the hub entry it is showing, which survives rows being
 * added or removed above it.
 */
export type TableRowRef = { rowIndex: number } | { entryId: string };

/**
 * Where an assistant issue lands. Fields are named the way the table's author
 * sees them (the Data Hub field key, or the column name / form field key of a
 * field-backed table), never by the grid's internal storage keys.
 */
export type TableIssueTarget =
  | { kind: 'cell'; row: TableRowRef; field: string }
  | { kind: 'row'; row: TableRowRef }
  | {
      kind: 'range';
      from: { row: TableRowRef; field: string };
      to: { row: TableRowRef; field: string };
    };

export type TableIssue = {
  target: TableIssueTarget;
  message: string;
};

export type ResolveIssuesContext = {
  /** Source row indices currently rendered, in display order. */
  rowIndices: number[];
  /** Rendered columns' storage keys, left to right. */
  fieldKeys: string[];
  /** Author-facing field name -> storage key; undefined when unknown. */
  resolveField: (name: string) => string | undefined;
  /** Row reference -> source row index; undefined when the row is not shown. */
  resolveRow: (ref: TableRowRef) => number | undefined;
};

export type ResolvedIssues = {
  /** `${rowIndex}:${fieldKey}` -> message, for every cell an issue covers. */
  cells: CellErrors;
  /** Issues that named a row or field the table does not have. */
  unresolved: TableIssue[];
};

/**
 * Expands row- and range-scoped issues onto the cells they cover. A cell named
 * by several issues keeps the first message, so the assistant controls what
 * shows by the order it sends them.
 */
export function resolveTableIssues(
  issues: TableIssue[],
  context: ResolveIssuesContext
): ResolvedIssues {
  const cells: CellErrors = {};
  const unresolved: TableIssue[] = [];
  const shownRows = new Set(context.rowIndices);
  const columnIndex = new Map(
    context.fieldKeys.map((key, index) => [key, index])
  );

  const rowOf = (ref: TableRowRef): number | undefined => {
    const rowIndex = context.resolveRow(ref);
    return rowIndex !== undefined && shownRows.has(rowIndex)
      ? rowIndex
      : undefined;
  };
  const columnOf = (name: string): number | undefined => {
    const key = context.resolveField(name);
    return key === undefined ? undefined : columnIndex.get(key);
  };
  const mark = (rowIndex: number, fieldKey: string, message: string) => {
    const key = cellErrorKey(rowIndex, fieldKey);
    if (!(key in cells)) cells[key] = message;
  };

  issues.forEach((issue) => {
    const { target, message } = issue;
    if (target.kind === 'cell') {
      const rowIndex = rowOf(target.row);
      const fieldKey = context.resolveField(target.field);
      if (rowIndex === undefined || !fieldKey || !columnIndex.has(fieldKey)) {
        unresolved.push(issue);
        return;
      }
      mark(rowIndex, fieldKey, message);
      return;
    }
    if (target.kind === 'row') {
      const rowIndex = rowOf(target.row);
      if (rowIndex === undefined) {
        unresolved.push(issue);
        return;
      }
      context.fieldKeys.forEach((fieldKey) =>
        mark(rowIndex, fieldKey, message)
      );
      return;
    }
    const fromRow = rowOf(target.from.row);
    const toRow = rowOf(target.to.row);
    const fromColumn = columnOf(target.from.field);
    const toColumn = columnOf(target.to.field);
    if (
      fromRow === undefined ||
      toRow === undefined ||
      fromColumn === undefined ||
      toColumn === undefined
    ) {
      unresolved.push(issue);
      return;
    }
    // A range covers the rows between its corners in DISPLAY order, so a
    // sorted or filtered table still gets the block the author pointed at.
    const rowPositions = new Map(
      context.rowIndices.map((rowIndex, position) => [rowIndex, position])
    );
    const [firstRow, lastRow] = [
      rowPositions.get(fromRow) as number,
      rowPositions.get(toRow) as number
    ].sort((a, b) => a - b);
    const [firstColumn, lastColumn] = [fromColumn, toColumn].sort(
      (a, b) => a - b
    );
    for (let position = firstRow; position <= lastRow; position++) {
      const rowIndex = context.rowIndices[position];
      for (let column = firstColumn; column <= lastColumn; column++) {
        mark(rowIndex, context.fieldKeys[column], message);
      }
    }
  });

  return { cells, unresolved };
}

export type BuildCellIssuesOptions = {
  /** Hub field-rule failures (client-side mirror plus server rejections). */
  ruleErrors: CellErrors;
  /** Assistant findings, already expanded onto cells. */
  assistantMessages: CellErrors;
  /**
   * Whether a row is verified data. A field-backed table has no staging, so
   * every row counts as verified there.
   */
  isRowVerified: (rowIndex: number) => boolean;
};

const rowOfKey = (key: string) => Number(key.slice(0, key.indexOf(':')));

/**
 * Merges the two issue sources onto cells. A hub rule failure wins over an
 * assistant finding on the same cell: the rule is the harder fact, and the
 * red cell has to be the one the user sees first.
 */
export function buildCellIssues({
  ruleErrors,
  assistantMessages,
  isRowVerified
}: BuildCellIssuesOptions): CellIssues {
  const issues: CellIssues = {};
  Object.entries(assistantMessages).forEach(([key, message]) => {
    issues[key] = {
      message,
      source: 'assistant',
      severity: 'warning',
      blocking: false
    };
  });
  Object.entries(ruleErrors).forEach(([key, message]) => {
    issues[key] = {
      message,
      source: 'hub_rule',
      severity: 'error',
      blocking: isRowVerified(rowOfKey(key))
    };
  });
  return issues;
}

export type IssueCounts = {
  /** Hub rule errors on verified rows: the save is held until they are fixed. */
  blocking: number;
  /** Hub rule errors on unverified rows: red, but the save still goes through. */
  errors: number;
  /** Assistant findings. */
  warnings: number;
};

export function countIssues(issues: CellIssues): IssueCounts {
  const counts: IssueCounts = { blocking: 0, errors: 0, warnings: 0 };
  Object.values(issues).forEach((issue) => {
    if (issue.blocking) counts.blocking += 1;
    else if (issue.severity === 'error') counts.errors += 1;
    else counts.warnings += 1;
  });
  return counts;
}

/**
 * The order the bar's stepper walks issues in: what holds the save back, then
 * the other rule breaks, then the advisory findings.
 */
export const issueRank = (issue: CellIssue): number =>
  issue.blocking ? 0 : issue.severity === 'error' ? 1 : 2;
