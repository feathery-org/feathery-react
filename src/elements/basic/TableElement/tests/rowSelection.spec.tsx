import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import TableElement from '../index';
import { fieldValues } from '../../../../utils/init';
import {
  tableSelectionState,
  getSelectedRows,
  setSelectedRows,
  registerTableRowCount,
  remapAfterDelete,
  clearTableSelection
} from '../../../../utils/tableState';
import { useTableMutations } from '../useTableMutations';

jest.mock('../../../../utils/formHelperFunctions', () => ({
  rerenderAllForms: jest.fn()
}));

const COLUMNS = [
  { name: 'Name', field_id: 'f1', field_type: 'text', field_key: 'name_key' },
  { name: 'Age', field_id: 'f2', field_type: 'text', field_key: 'age_key' }
];

const seedFieldValues = () => {
  Object.assign(fieldValues, {
    name_key: ['Alice', 'Bob'],
    age_key: ['30', '40']
  });
};

const clearFieldValues = () => {
  delete (fieldValues as any).name_key;
  delete (fieldValues as any).age_key;
};

const makeElement = (propsOverride: Record<string, any> = {}) => ({
  id: 'table1',
  properties: {
    columns: COLUMNS,
    actions: [],
    search: false,
    sort: false,
    pagination: 0,
    transpose: false,
    enable_editing: false,
    ...propsOverride
  }
});

const mockStyles = () => ({
  addTargets: jest.fn(),
  getTarget: jest.fn(() => ({}))
});

describe('TableElement - row selection', () => {
  beforeEach(() => {
    seedFieldValues();
    // Clear selection state for this table
    Object.keys(tableSelectionState).forEach((k) => delete tableSelectionState[k]);
  });

  afterEach(() => {
    clearFieldValues();
    jest.clearAllMocks();
    sessionStorage.clear();
  });

  it('renders a checkbox per row when enabled and toggles selection', () => {
    render(
      <TableElement
        element={makeElement({ enable_row_selection: true })}
        responsiveStyles={mockStyles()}
        onClick={jest.fn()}
      />
    );

    const checkboxes = screen.getAllByRole('checkbox', { name: /select row/i });
    expect(checkboxes).toHaveLength(2);

    // Click 2nd row checkbox (base index 1)
    fireEvent.click(checkboxes[1]);
    expect(getSelectedRows('table1')).toEqual([1]);
  });

  it('does not render row checkboxes when disabled', () => {
    render(
      <TableElement
        element={makeElement({ enable_row_selection: false })}
        responsiveStyles={mockStyles()}
        onClick={jest.fn()}
      />
    );

    expect(screen.queryByRole('checkbox', { name: /select row/i })).toBeNull();
  });

  it('clears selection when search query changes', () => {
    render(
      <TableElement
        element={makeElement({ enable_row_selection: true, search: true })}
        responsiveStyles={mockStyles()}
        onClick={jest.fn()}
      />
    );

    // Select the first row
    const checkboxes = screen.getAllByRole('checkbox', { name: /select row/i });
    fireEvent.click(checkboxes[0]);
    expect(getSelectedRows('table1')).toEqual([0]);

    // Changing search query should clear the selection
    const searchInput = screen.getByPlaceholderText('Search');
    fireEvent.change(searchInput, { target: { value: 'Bob' } });
    expect(getSelectedRows('table1')).toEqual([]);
  });
});

describe('remapAfterDelete - helper contract', () => {
  beforeEach(() => {
    Object.keys(tableSelectionState).forEach((k) => delete tableSelectionState[k]);
  });

  it('remaps selection after a row delete (helper contract used by the hook)', () => {
    registerTableRowCount('tbl_x', 5);
    setSelectedRows('tbl_x', [0, 2, 4]);
    remapAfterDelete('tbl_x', 2);
    expect(getSelectedRows('tbl_x')).toEqual([0, 3]);
  });
});

describe('useTableMutations - remap wiring', () => {
  const minimalProps = {
    columns: [],
    updateFieldValues: jest.fn(),
    submitCustom: jest.fn(),
    editMode: false,
    editModeFieldValues: {},
    enablePagination: false,
    setCurrentPage: jest.fn(),
    setSearchQuery: jest.fn(),
    searchQuery: '',
    onMutate: jest.fn(),
    tableId: 't1'
  };

  beforeEach(() => {
    Object.keys(tableSelectionState).forEach((k) => delete tableSelectionState[k]);
    jest.clearAllMocks();
  });

  it('remaps selection in the store when handleDeleteRow is called', () => {
    registerTableRowCount('t1', 5);
    setSelectedRows('t1', [0, 2, 4]);

    const { result } = renderHook(() => useTableMutations(minimalProps));

    act(() => {
      result.current.handleDeleteRow(2);
    });

    expect(getSelectedRows('t1')).toEqual([0, 3]);
  });

  it('remaps selection in the store when handleRemoveRowLocal is called', () => {
    registerTableRowCount('t1', 5);
    setSelectedRows('t1', [0, 2, 4]);

    const { result } = renderHook(() => useTableMutations(minimalProps));

    act(() => {
      result.current.handleRemoveRowLocal(2);
    });

    expect(getSelectedRows('t1')).toEqual([0, 3]);
  });
});
