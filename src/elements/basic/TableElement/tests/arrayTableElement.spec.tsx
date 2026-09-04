import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TableElement from '../index';
import { fieldValues } from '../../../../utils/init';

const FIELD_KEY = 'table_data';

const makeElement = (propsOverride: Record<string, any> = {}) => ({
  id: 'table1',
  properties: {
    columns: [],
    actions: [],
    search: false,
    sort: false,
    pagination: 0,
    transpose: false,
    enable_editing: false,
    add_delete_rows: false,
    data_source: '2d_array',
    array_field_key: FIELD_KEY,
    ...propsOverride
  }
});

const responsiveStyles = {
  addTargets: jest.fn(),
  getTarget: () => ({})
};

const renderTable = (
  propsOverride: Record<string, any> = {},
  extra: Record<string, any> = {}
) =>
  render(
    <TableElement
      element={makeElement(propsOverride)}
      responsiveStyles={responsiveStyles}
      updateFieldValues={jest.fn()}
      submitCustom={jest.fn()}
      editMode={false}
      {...extra}
    />
  );

describe('TableElement - 2d_array source', () => {
  afterEach(() => {
    delete (fieldValues as any)[FIELD_KEY];
    sessionStorage.clear();
    jest.clearAllMocks();
  });

  it('renders the first row as headers and the rest as data', () => {
    (fieldValues as any)[FIELD_KEY] = [
      ['Name', 'Age'],
      ['Alice', 30],
      ['Bob', 40]
    ];
    renderTable();

    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Age')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    // A number cell is cast to a string for display.
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('parses a value that arrived as a JSON string', () => {
    (fieldValues as any)[FIELD_KEY] = '[["Name"],["Alice"]]';
    renderTable();

    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('shows an error banner instead of the table for a malformed value', () => {
    for (const bad of ['hello', { a: 1 }, [['A'], 'notarow']]) {
      (fieldValues as any)[FIELD_KEY] = bad;
      const { unmount } = renderTable();

      expect(screen.getByRole('alert')).toHaveTextContent(
        'table_data must be an array of arrays'
      );
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('shows the plain empty state, with no error, when the field is unset', () => {
    renderTable();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('No data available')).toBeInTheDocument();
  });

  it('writes the whole array back on a cell edit, keeping untouched types', () => {
    (fieldValues as any)[FIELD_KEY] = [
      ['Name', 'Age'],
      ['Alice', 30]
    ];
    const updateFieldValues = jest.fn();
    const submitCustom = jest.fn();
    renderTable({ enable_editing: true }, { updateFieldValues, submitCustom });

    fireEvent.click(screen.getByText('Alice'));
    const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'Alicia' } });
    fireEvent.blur(editor);

    const expected = [
      ['Name', 'Age'],
      ['Alicia', 30]
    ];
    expect(updateFieldValues).toHaveBeenCalledWith({ [FIELD_KEY]: expected });
    expect(submitCustom).toHaveBeenCalledWith({ [FIELD_KEY]: expected });
  });

  it('writes back a JSON string when the value came in as one', () => {
    (fieldValues as any)[FIELD_KEY] = '[["Name"],["Alice"]]';
    const updateFieldValues = jest.fn();
    renderTable({ enable_editing: true }, { updateFieldValues });

    fireEvent.click(screen.getByText('Alice'));
    const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'Alicia' } });
    fireEvent.blur(editor);

    expect(updateFieldValues).toHaveBeenCalledWith({
      [FIELD_KEY]: JSON.stringify([['Name'], ['Alicia']])
    });
  });

  it('hides Add Row until there is a header row defining the columns', () => {
    renderTable({ enable_editing: true, add_delete_rows: true });
    expect(screen.queryByText('+ Add Row')).not.toBeInTheDocument();

    (fieldValues as any)[FIELD_KEY] = [['Name']];
    renderTable({ enable_editing: true, add_delete_rows: true });
    expect(screen.getByText('+ Add Row')).toBeInTheDocument();
  });

  it('edits the right underlying row when the table is sorted', () => {
    (fieldValues as any)[FIELD_KEY] = [
      ['Name'],
      ['Alice'],
      ['Bob'],
      ['Carol']
    ];
    const updateFieldValues = jest.fn();
    renderTable(
      { enable_editing: true, sort: true },
      { updateFieldValues }
    );

    // Sort descending so display order (Carol, Bob, Alice) no longer matches
    // the array order.
    const header = screen.getByText('Name');
    fireEvent.click(header);
    fireEvent.click(header);
    expect(screen.getAllByRole('cell').map((c) => c.textContent)).toEqual([
      'Carol',
      'Bob',
      'Alice'
    ]);

    // Editing the top display row must write Carol's row, not Alice's.
    fireEvent.click(screen.getByText('Carol'));
    const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'Caroline' } });
    fireEvent.blur(editor);

    expect(updateFieldValues).toHaveBeenCalledWith({
      [FIELD_KEY]: [['Name'], ['Alice'], ['Bob'], ['Caroline']]
    });
  });

  it('renders placeholder columns in the builder, where the value is unknown', () => {
    renderTable({}, { editMode: true });

    expect(screen.getByText('Column 1')).toBeInTheDocument();
    expect(screen.getByText('Column 3')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
