import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TableElement from '../index';
import { fieldValues } from '../../../../utils/init';

// Two columns, two rows of real (non-edit-mode) data read from `fieldValues`.
const COLUMNS = [
  { name: 'A', field_id: 'col_a', field_type: 'text', field_key: 'col_a' },
  { name: 'B', field_id: 'col_b', field_type: 'text', field_key: 'col_b' }
];

const element = {
  id: 'table-1',
  properties: {
    columns: COLUMNS,
    actions: [],
    search: false,
    sort: false,
    pagination: 0,
    transpose: false,
    enable_editing: true,
    add_delete_rows: false
  }
};

const responsiveStyles = {
  addTargets: jest.fn(),
  getTarget: () => ({})
};

const renderTable = () =>
  render(
    <TableElement
      element={element}
      responsiveStyles={responsiveStyles}
      updateFieldValues={jest.fn()}
      submitCustom={jest.fn()}
      editMode={false}
    />
  );

const openEditor = () => screen.getByRole('textbox') as HTMLTextAreaElement;

describe('TableElement - Tab navigation between cells', () => {
  beforeEach(() => {
    Object.assign(fieldValues, { col_a: ['a1', 'a2'], col_b: ['b1', 'b2'] });
  });

  afterEach(() => {
    delete (fieldValues as any).col_a;
    delete (fieldValues as any).col_b;
    sessionStorage.clear();
    jest.clearAllMocks();
  });

  it('opens the next column to the right on Tab and focuses it', () => {
    renderTable();

    fireEvent.click(screen.getByText('a1'));
    expect(openEditor().value).toBe('a1');

    fireEvent.keyDown(openEditor(), { key: 'Tab' });

    const next = openEditor();
    expect(next.value).toBe('b1');
    expect(next).toHaveFocus();
  });

  it('wraps to the first column of the next row at the row end', () => {
    renderTable();

    fireEvent.click(screen.getByText('b1'));
    fireEvent.keyDown(openEditor(), { key: 'Tab' });

    expect(openEditor().value).toBe('a2');
  });

  it('moves backward (left/up) on Shift+Tab', () => {
    renderTable();

    fireEvent.click(screen.getByText('b1'));
    fireEvent.keyDown(openEditor(), { key: 'Tab', shiftKey: true });

    expect(openEditor().value).toBe('a1');
  });

  it('commits and stays put (no open editor) past the last editable cell', () => {
    renderTable();

    fireEvent.click(screen.getByText('b2'));
    fireEvent.keyDown(openEditor(), { key: 'Tab' });

    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('persists an in-flight edit before navigating away', () => {
    const updateFieldValues = jest.fn();
    render(
      <TableElement
        element={element}
        responsiveStyles={responsiveStyles}
        updateFieldValues={updateFieldValues}
        submitCustom={jest.fn()}
        editMode={false}
      />
    );

    fireEvent.click(screen.getByText('a1'));
    fireEvent.change(openEditor(), { target: { value: 'edited' } });
    fireEvent.keyDown(openEditor(), { key: 'Tab' });

    expect(updateFieldValues).toHaveBeenCalledWith({
      col_a: ['edited', 'a2']
    });
    expect(openEditor().value).toBe('b1');
  });
});
