jest.mock('../formHelperFunctions', () => ({ rerenderAllForms: jest.fn() }));

import {
  tableSelectionState,
  registerTableRowCount,
  clampIndices,
  getSelectedRows,
  setSelectedRows,
  toggleRow,
  clearTableSelection,
  remapAfterDelete
} from '../tableState';
import { rerenderAllForms } from '../formHelperFunctions';

describe('tableState', () => {
  beforeEach(() => {
    Object.keys(tableSelectionState).forEach((k) => delete tableSelectionState[k]);
    (rerenderAllForms as jest.Mock).mockClear();
    registerTableRowCount('t1', 5);
  });

  it('clampIndices keeps unique, in-range, sorted integers', () => {
    expect(clampIndices([3, 3, 0, -1, 5, 2.5, 1], 5)).toEqual([0, 1, 3]);
  });

  it('set/get round-trips through clamp and rerenders', () => {
    setSelectedRows('t1', [4, 1, 99]);
    expect(getSelectedRows('t1')).toEqual([1, 4]);
    expect(rerenderAllForms).toHaveBeenCalled();
  });

  it('toggleRow adds then removes', () => {
    toggleRow('t1', 2);
    expect(getSelectedRows('t1')).toEqual([2]);
    toggleRow('t1', 2);
    expect(getSelectedRows('t1')).toEqual([]);
  });

  it('clearTableSelection empties selection', () => {
    setSelectedRows('t1', [0, 2]);
    clearTableSelection('t1');
    expect(getSelectedRows('t1')).toEqual([]);
  });

  it('remapAfterDelete drops deleted index and shifts higher down', () => {
    setSelectedRows('t1', [0, 2, 4]);
    remapAfterDelete('t1', 2);
    expect(Array.from(tableSelectionState['t1']).sort((a, b) => a - b)).toEqual([0, 3]);
  });
});
