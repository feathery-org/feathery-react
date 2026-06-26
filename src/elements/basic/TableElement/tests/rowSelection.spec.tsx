import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TableElement from '../index';
import { fieldValues } from '../../../../utils/init';
import { tableSelectionState, getSelectedRows } from '../../../../utils/tableState';

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
});
