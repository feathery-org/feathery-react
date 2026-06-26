import Table from '../entities/Table';
import { registerTableRowCount, tableSelectionState } from '../tableState';

jest.mock('../formHelperFunctions', () => ({ rerenderAllForms: jest.fn() }));

describe('Table entity', () => {
  beforeEach(() => {
    Object.keys(tableSelectionState).forEach(
      (k) => delete tableSelectionState[k]
    );
    registerTableRowCount('tbl_1', 4);
  });

  it('exposes id and rowCount', () => {
    const t = new Table('tbl_1', 'form_1');
    expect(t.id).toBe('tbl_1');
    expect(t.rowCount).toBe(4);
  });

  it('get/set selectedRows with clamping', () => {
    const t = new Table('tbl_1', 'form_1');
    t.selectedRows = [2, 0, 99];
    expect(t.selectedRows).toEqual([0, 2]);
  });

  it('clearSelection empties', () => {
    const t = new Table('tbl_1', 'form_1');
    t.selectedRows = [1, 3];
    t.clearSelection();
    expect(t.selectedRows).toEqual([]);
  });

  it('tolerates a non-array assignment', () => {
    const t = new Table('tbl_1', 'form_1');
    // @ts-expect-error testing runtime guard
    t.selectedRows = null;
    expect(t.selectedRows).toEqual([]);
  });
});
