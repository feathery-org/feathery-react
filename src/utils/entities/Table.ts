import {
  clearTableSelection,
  getSelectedRows,
  getTableRowCount,
  setSelectedRows
} from '../tableState';

/**
 * Represents a Table element in a form. Part of the SDK coding model.
 * `selectedRows` is an array of base row indices and is readable + writeable
 * from logic rules, e.g. `mytable.selectedRows = [0, 2]`.
 */
export default class Table {
  _tableId = '';
  _formUuid = '';

  constructor(tableId: string, formUuid: string) {
    this._tableId = tableId;
    this._formUuid = formUuid;
  }

  get id(): string {
    return this._tableId;
  }

  get rowCount(): number {
    return getTableRowCount(this._tableId);
  }

  get selectedRows(): number[] {
    return getSelectedRows(this._tableId);
  }

  set selectedRows(indices: number[]) {
    setSelectedRows(this._tableId, Array.isArray(indices) ? indices : []);
  }

  clearSelection(): void {
    clearTableSelection(this._tableId);
  }
}
