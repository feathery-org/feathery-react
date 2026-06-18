import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TableElement from '../index';
import { fieldValues } from '../../../../utils/init';

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

// applyTableStyles only calls addTargets and the render reads getTarget
const mockStyles = () => ({
  addTargets: jest.fn(),
  getTarget: jest.fn(() => ({}))
});

describe('TableElement - onClick column payload', () => {
  beforeEach(() => {
    seedFieldValues();
  });

  afterEach(() => {
    clearFieldValues();
    jest.clearAllMocks();
    sessionStorage.clear();
  });

  it('emits the clicked column for a normal-mode data-cell click (without double-firing the row handler)', () => {
    const onClick = jest.fn();
    render(
      <TableElement
        element={makeElement()}
        responsiveStyles={mockStyles()}
        onClick={onClick}
      />
    );

    // Cell at row 0, column "Age"
    fireEvent.click(screen.getByText('30'));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith({
      rowIndex: 0,
      rowData: { Name: 'Alice', Age: '30' },
      columnIndex: 1,
      columnKey: 'age_key',
      columnName: 'Age'
    });
  });

  it('emits the original column for a transposed-mode data-cell click', () => {
    const onClick = jest.fn();
    render(
      <TableElement
        element={makeElement({ transpose: true })}
        responsiveStyles={mockStyles()}
        onClick={onClick}
      />
    );

    // Transposed: rendered row 0 maps to original column "Name"; this cell holds
    // original row 0's value
    fireEvent.click(screen.getByText('Alice'));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith({
      rowIndex: 0,
      rowData: { Name: 'Alice', Age: '30' },
      columnIndex: 0,
      columnKey: 'name_key',
      columnName: 'Name'
    });
  });
});
