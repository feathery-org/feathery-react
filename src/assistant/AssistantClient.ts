import type {
  TableIssue,
  TableRowRef,
  UnresolvedIssue
} from '../elements/basic/TableElement/spreadsheet/issues';
import type { Column } from '../elements/basic/TableElement/types';

type AssistantClientCallbacks = {
  buttonOnClick: (button: any) => Promise<void>;
  runElementActions: (args: any) => Promise<any>;
  tableOnClick: (table: any, payload: any) => Promise<void>;
  changeValue: (value: any, field: any, index?: number | null) => void;
};

/** Something wrong on a table as the assistant reads it, no fieldKey means the whole row */
export type TableCellIssue = {
  rowIndex: number;
  entryId?: string;
  fieldKey?: string;
  columnName?: string;
  message: string;
  severity: 'error' | 'warning';
  source: 'rule' | 'assistant';
};

/** A row the table does not have reads as unknown_row, never as a clean row */
export type TableIssuesRead =
  | { ok: true; rowIndex?: number; cells: TableCellIssue[] }
  | { ok: false; reason: 'not_mounted' | 'unknown_row' };

export type TableCellTarget = {
  rowIndex?: number;
  entryId?: string;
  fieldKey?: string;
};

export type TableFocusOutcome =
  | { ok: true; rowIndex: number }
  | {
      ok: false;
      errorType: 'unknown_entry' | 'unknown_field' | 'row_hidden';
      error: string;
    };

export type CellWriteResult =
  | { ok: true; value: unknown }
  | {
      ok: false;
      errorType: 'unknown_field' | 'read_only' | 'row_deleted';
      error: string;
    };

export type TableLiveState = {
  rowCount: number;
  canEditCells?: boolean;
  canAddRows?: boolean;
  canDeleteRows?: boolean;
  selection?: {
    rowIndex: number;
    entryId?: string;
    fieldKey: string;
    columnName: string;
    value: unknown;
    error?: string;
    row: Record<string, unknown>;
  };
  viewport?: { visibleRowIndexes: number[] };
  ruleErrors?: { total: number };
  findings?: number;
  pendingEdits?: Array<{
    rowIndex: number;
    entryId?: string;
    fieldKey: string;
    value: unknown;
  }>;
  pendingDeletions?: Array<{ rowIndex: number; entryId?: string }>;
};

export type TableHandlers = {
  // The columns the grid is actually rendering, which on a Hub table are
  // resolved from the live Hub schema rather than the ones stored on the element
  columns: Column[];
  handleCellEdit: (
    fieldKey: string,
    rowIndex: number,
    value: unknown
  ) => CellWriteResult;
  handleAddRow: () => void;
  handleDeleteRow: (rowIndex: number) => void;
  /**
   * Replaces the assistant's findings on this table. Each call is the full
   * set, so a re-run of a verification rule supersedes the previous run
   * rather than piling onto it. Returns the findings that named a row or
   * column the table does not have, or null when it has no grid to mark.
   */
  setIssues: (issues: TableIssue[]) => UnresolvedIssue[] | null;
  clearIssues: () => void;
  getIssues: (row?: TableRowRef) => TableIssuesRead;
  focusCell: (target: TableCellTarget) => TableFocusOutcome | null;
  getLiveState: () => TableLiveState;
  // A row's values as the grid shows them, keyed by the column's published field key
  getRow: (rowIndex: number) => Record<string, unknown> | null;
};

export default class AssistantClient {
  private _callbacks: AssistantClientCallbacks;
  private _tables = new Map<string, TableHandlers>();

  constructor(callbacks: AssistantClientCallbacks) {
    this._callbacks = callbacks;
  }

  updateCallbacks(callbacks: AssistantClientCallbacks): void {
    this._callbacks = callbacks;
  }

  click(button: any): Promise<void> {
    return this._callbacks.buttonOnClick(button);
  }

  runActions(args: {
    actions: any[];
    element: any;
    elementType: 'button' | 'text' | 'container' | 'progress_bar' | 'tab';
    submit?: boolean;
  }): Promise<any> {
    return this._callbacks.runElementActions(args);
  }

  changeValue(value: any, field: any, index: number | null = null): void {
    this._callbacks.changeValue(value, field, index);
  }

  runTableAction(args: {
    table: any;
    payload: {
      action?: string;
      rowIndex: number;
      rowData: Record<string, any>;
    };
  }): Promise<void> {
    return this._callbacks.tableOnClick(args.table, args.payload);
  }

  registerTable(tableId: string, handlers: TableHandlers): void {
    this._tables.set(tableId, handlers);
  }

  /** Columns a mounted table is rendering, null when it isn't mounted */
  getTableColumns(tableId: string): Column[] | null {
    return this._tables.get(tableId)?.columns ?? null;
  }

  unregisterTable(tableId: string): void {
    this._tables.delete(tableId);
  }

  editTableCell(
    tableId: string,
    rowIndex: number,
    fieldKey: string,
    value: unknown
  ): CellWriteResult | null {
    const t = this._tables.get(tableId);
    if (!t) return null;
    return t.handleCellEdit(fieldKey, rowIndex, value);
  }

  addTableRow(tableId: string): boolean {
    const t = this._tables.get(tableId);
    if (!t) return false;
    t.handleAddRow();
    return true;
  }

  deleteTableRow(tableId: string, rowIndex: number): boolean {
    const t = this._tables.get(tableId);
    if (!t) return false;
    t.handleDeleteRow(rowIndex);
    return true;
  }

  /**
   * Flags cells, rows or ranges of a mounted table with the outcome of a
   * custom validation / verification rule. Returns null when the table is
   * not mounted, like the other table hooks.
   */
  setTableIssues(
    tableId: string,
    issues: TableIssue[]
  ): UnresolvedIssue[] | null {
    const t = this._tables.get(tableId);
    if (!t) return null;
    return t.setIssues(issues);
  }

  clearTableIssues(tableId: string): boolean {
    const t = this._tables.get(tableId);
    if (!t) return false;
    t.clearIssues();
    return true;
  }

  /** Every issue the table is showing, the hub's own rules included */
  getTableIssues(tableId: string, row?: TableRowRef): TableIssuesRead | null {
    const t = this._tables.get(tableId);
    if (!t) return null;
    return t.getIssues(row);
  }

  focusTableCell(
    tableId: string,
    target: TableCellTarget
  ): TableFocusOutcome | null {
    const t = this._tables.get(tableId);
    if (!t) return null;
    return t.focusCell(target);
  }

  getTableLiveState(tableId: string): TableLiveState | null {
    const t = this._tables.get(tableId);
    if (!t) return null;
    return t.getLiveState();
  }

  getTableRow(
    tableId: string,
    rowIndex: number
  ): Record<string, unknown> | null {
    return this._tables.get(tableId)?.getRow(rowIndex) ?? null;
  }
}
