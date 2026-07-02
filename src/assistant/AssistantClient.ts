type AssistantClientCallbacks = {
  buttonOnClick: (button: any) => Promise<void>;
  runElementActions: (args: any) => Promise<any>;
  tableOnClick: (table: any, payload: any) => Promise<void>;
  changeValue: (value: any, field: any, index?: number | null) => void;
};

export type TableHandlers = {
  handleCellEdit: (fieldKey: string, rowIndex: number, value: any) => void;
  handleAddRow: () => void;
  handleDeleteRow: (rowIndex: number) => void;
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

  unregisterTable(tableId: string): void {
    this._tables.delete(tableId);
  }

  editTableCell(
    tableId: string,
    rowIndex: number,
    fieldKey: string,
    value: any
  ): boolean {
    const t = this._tables.get(tableId);
    if (!t) return false;
    t.handleCellEdit(fieldKey, rowIndex, value);
    return true;
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
}
