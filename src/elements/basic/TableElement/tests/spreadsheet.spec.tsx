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
    display_mode: 'spreadsheet',
    ...propsOverride
  }
});

const mockStyles = () => ({
  addTargets: jest.fn(),
  getTarget: jest.fn(() => ({}))
});

const renderTable = (propsOverride: Record<string, any> = {}, extra = {}) =>
  render(
    <TableElement
      element={makeElement(propsOverride)}
      responsiveStyles={mockStyles()}
      {...extra}
    />
  );

const getCell = (text: string) => screen.getByText(text).closest('td')!;

describe('TableElement - spreadsheet mode', () => {
  beforeEach(() => {
    seedFieldValues();
  });

  afterEach(() => {
    clearFieldValues();
    jest.clearAllMocks();
    sessionStorage.clear();
  });

  it('renders a row-number gutter with 1-based display-order numbers', () => {
    renderTable();
    const gutterCells = document.querySelectorAll('.feathery-table-row-number');
    // header spacer + one per row
    expect(gutterCells.length).toBe(3);
    expect(gutterCells[1].textContent).toBe('1');
    expect(gutterCells[2].textContent).toBe('2');
    expect(document.querySelector('table')!.getAttribute('role')).toBe('grid');
  });

  it('does not render a gutter in classic mode', () => {
    renderTable({ display_mode: 'classic' });
    expect(document.querySelector('.feathery-table-row-number')).toBeNull();
    expect(document.querySelector('table')!.getAttribute('role')).toBeNull();
  });

  it('selects the first cell when the grid receives keyboard focus', () => {
    renderTable();
    const container = document.querySelector('.feathery-table-container')!;
    fireEvent.focus(container);
    expect(getCell('Alice').getAttribute('aria-selected')).toBe('true');
  });

  it('clears the selection when the search query changes', () => {
    renderTable({ search: true });
    fireEvent.click(screen.getByText('Alice'));
    expect(getCell('Alice').getAttribute('aria-selected')).toBe('true');

    const searchInput = document.querySelector(
      '.feathery-table-search-input'
    ) as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'Bob' } });
    // Clearing the query re-renders the previously selected row; a stale
    // selectedCell would make it reappear as selected
    fireEvent.change(searchInput, { target: { value: '' } });

    expect(document.querySelector('[aria-selected]')).toBeNull();
  });

  it('clears the selection when a row is added', () => {
    renderTable({ enable_editing: true, add_delete_rows: true });
    fireEvent.click(screen.getByText('Alice'));
    expect(getCell('Alice').getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByText('+ Add Row'));

    expect(document.querySelector('[aria-selected]')).toBeNull();
  });

  it('selects a cell on click and still fires the custom onClick action', () => {
    const onClick = jest.fn();
    renderTable({}, { onClick });

    fireEvent.click(screen.getByText('30'));

    expect(getCell('30').getAttribute('aria-selected')).toBe('true');
    expect(onClick).toHaveBeenCalledWith(
      expect.objectContaining({ rowIndex: 0, columnKey: 'age_key' })
    );
  });

  it('moves the selection with arrow keys, clamped at edges', () => {
    renderTable();
    fireEvent.click(screen.getByText('Alice'));

    const container = document.querySelector('.feathery-table-container')!;
    fireEvent.keyDown(container, { key: 'ArrowRight' });
    expect(getCell('30').getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(container, { key: 'ArrowDown' });
    expect(getCell('40').getAttribute('aria-selected')).toBe('true');

    // Clamped: already at the last row/column
    fireEvent.keyDown(container, { key: 'ArrowDown' });
    fireEvent.keyDown(container, { key: 'ArrowRight' });
    expect(getCell('40').getAttribute('aria-selected')).toBe('true');
  });

  it('opens the editor with the current value on Enter when editing is enabled', () => {
    renderTable({ enable_editing: true });
    fireEvent.click(screen.getByText('Alice'));

    const container = document.querySelector('.feathery-table-container')!;
    fireEvent.keyDown(container, { key: 'Enter' });

    const input = document.querySelector(
      '.feathery-table-cell-input'
    ) as HTMLTextAreaElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('Alice');
  });

  it('starts editing with the typed character replacing the content', () => {
    renderTable({ enable_editing: true });
    fireEvent.click(screen.getByText('Alice'));

    const container = document.querySelector('.feathery-table-container')!;
    fireEvent.keyDown(container, { key: 'X' });

    const input = document.querySelector(
      '.feathery-table-cell-input'
    ) as HTMLTextAreaElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('X');
  });

  it('commits on Enter while editing and moves the selection down', () => {
    const updateFieldValues = jest.fn();
    renderTable({ enable_editing: true }, { updateFieldValues });
    fireEvent.click(screen.getByText('Alice'));

    const container = document.querySelector('.feathery-table-container')!;
    fireEvent.keyDown(container, { key: 'Enter' });

    const input = document.querySelector(
      '.feathery-table-cell-input'
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Anna' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(updateFieldValues).toHaveBeenCalledWith(
      expect.objectContaining({ name_key: ['Anna', 'Bob'] })
    );
    expect(getCell('Bob').getAttribute('aria-selected')).toBe('true');
  });

  it('ignores keystrokes coming from the search input', () => {
    renderTable({ enable_editing: true, search: true });
    fireEvent.click(screen.getByText('Alice'));

    const searchInput = document.querySelector(
      '.feathery-table-search-input'
    ) as HTMLInputElement;
    fireEvent.keyDown(searchInput, { key: 'X' });
    fireEvent.keyDown(searchInput, { key: 'Enter' });

    expect(document.querySelector('.feathery-table-cell-input')).toBeNull();
  });

  it('does not open the editor when editing is disabled', () => {
    renderTable();
    fireEvent.click(screen.getByText('Alice'));

    const container = document.querySelector('.feathery-table-container')!;
    fireEvent.keyDown(container, { key: 'Enter' });
    fireEvent.keyDown(container, { key: 'X' });

    expect(document.querySelector('.feathery-table-cell-input')).toBeNull();
  });
});
