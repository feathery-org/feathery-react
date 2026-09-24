import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import TableElement from '../index';
import { fieldValues } from '../../../../utils/init';
import { TABLE_CLASS } from '../classNames';

const COLUMNS = [
  { name: 'Name', field_id: 'f1', field_type: 'text', field_key: 'name_key' },
  { name: 'City', field_id: 'f2', field_type: 'text', field_key: 'city_key' }
];

const mockStyles = () => ({
  addTargets: jest.fn(),
  apply: jest.fn(),
  getTarget: jest.fn(() => ({}))
});

const element = {
  id: 'table1',
  styles: {},
  properties: {
    columns: COLUMNS,
    actions: [],
    search: false,
    sort: false,
    pagination: 0,
    transpose: false,
    display_mode: 'spreadsheet',
    enable_editing: true,
    add_delete_rows: true
  }
};

// jsdom lays nothing out; give the virtualizers a viewport (see spreadsheetGrid.spec).
const originalSize = {
  offsetWidth: Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'offsetWidth'
  ),
  offsetHeight: Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'offsetHeight'
  )
};
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 900
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 600
  });
  Object.assign(fieldValues, {
    name_key: ['Bob', 'Alice', 'Cara', 'Dan'],
    city_key: ['Austin', 'Boston', 'Austin', '']
  });
});
afterEach(() => {
  if (originalSize.offsetWidth) {
    Object.defineProperty(
      HTMLElement.prototype,
      'offsetWidth',
      originalSize.offsetWidth
    );
  }
  if (originalSize.offsetHeight) {
    Object.defineProperty(
      HTMLElement.prototype,
      'offsetHeight',
      originalSize.offsetHeight
    );
  }
  ['name_key', 'city_key'].forEach((key) => {
    delete (fieldValues as any)[key];
  });
  sessionStorage.clear();
});

const renderGrid = () =>
  render(
    <TableElement
      element={element}
      responsiveStyles={mockStyles()}
      updateFieldValues={jest.fn()}
      submitCustom={jest.fn()}
    />
  );
const header = (name: string) =>
  screen.getByRole('columnheader', { name: new RegExp(`^${name}`) });
const namesInOrder = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('gridcell')[0].textContent);
const openFilter = (column: string) => {
  fireEvent.contextMenu(header(column), { clientX: 10, clientY: 10 });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Filter…' }));
  return screen.getByRole('dialog', { name: `Filter column ${column}` });
};
const isFiltered = (column: string) =>
  header(column).querySelector(`.${TABLE_CLASS.gridFilterIndicator}`) !== null;

describe('spreadsheet column filters', () => {
  test('unchecking a value hides its rows, marks the header and blocks adding rows', () => {
    renderGrid();
    expect(namesInOrder()).toEqual(['Bob', 'Alice', 'Cara', 'Dan']);
    expect(screen.getByRole('button', { name: /Add row/ })).toBeTruthy();

    const dialog = openFilter('City');
    expect(
      within(dialog)
        .getAllByRole('checkbox')
        .map((box) => (box as HTMLInputElement).checked)
    ).toEqual([true, true, true, true]);
    expect(
      within(dialog).getByRole('checkbox', { name: '(Blanks)' })
    ).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Boston' }));
    expect(namesInOrder()).toEqual(['Bob', 'Cara', 'Dan']);
    expect(isFiltered('City')).toBe(true);
    expect(isFiltered('Name')).toBe(false);
    expect(screen.queryByRole('button', { name: /Add row/ })).toBeNull();
    // The popover stays open for further changes; the list keeps every value.
    expect(
      within(dialog).getByRole('checkbox', { name: 'Boston' })
    ).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('checkbox', { name: '(Blanks)' }));
    expect(namesInOrder()).toEqual(['Bob', 'Cara']);

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Clear filter' })
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(namesInOrder()).toEqual(['Bob', 'Alice', 'Cara', 'Dan']);
    expect(isFiltered('City')).toBe(false);
    expect(screen.getByRole('button', { name: /Add row/ })).toBeTruthy();
  });

  test('the search box filters rows by contained text and narrows the value list', () => {
    renderGrid();
    const dialog = openFilter('City');
    fireEvent.change(
      within(dialog).getByRole('textbox', { name: 'Search City values' }),
      { target: { value: 'ost' } }
    );
    expect(namesInOrder()).toEqual(['Alice']);
    expect(
      within(dialog)
        .getAllByRole('checkbox')
        .map((box) => box.parentElement?.textContent)
    ).toEqual(['(Select all)', 'Boston']);
    expect(isFiltered('City')).toBe(true);
  });

  test('select all unchecks everything, then checking a value restores it; all checked lifts the filter', () => {
    renderGrid();
    const dialog = openFilter('City');
    fireEvent.click(
      within(dialog).getByRole('checkbox', { name: '(Select all)' })
    );
    expect(namesInOrder()).toEqual([]);
    expect(isFiltered('City')).toBe(true);
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Austin' }));
    expect(namesInOrder()).toEqual(['Bob', 'Cara']);
    fireEvent.click(
      within(dialog).getByRole('checkbox', { name: '(Select all)' })
    );
    expect(namesInOrder()).toEqual(['Bob', 'Alice', 'Cara', 'Dan']);
    expect(isFiltered('City')).toBe(false);
  });

  test('filters on two columns combine, and the header menu clears one or all', () => {
    renderGrid();
    let dialog = openFilter('City');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Boston' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(namesInOrder()).toEqual(['Bob', 'Cara', 'Dan']);

    dialog = openFilter('Name');
    // Only names of rows the City filter lets through are offered.
    expect(
      within(dialog)
        .getAllByRole('checkbox')
        .map((box) => box.parentElement?.textContent)
    ).toEqual(['(Select all)', 'Bob', 'Cara', 'Dan']);
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Dan' }));
    expect(namesInOrder()).toEqual(['Bob', 'Cara']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));

    fireEvent.contextMenu(header('Name'), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear filter' }));
    expect(namesInOrder()).toEqual(['Bob', 'Cara', 'Dan']);

    fireEvent.contextMenu(header('Name'), { clientX: 10, clientY: 10 });
    const menu = screen.getByRole('menu');
    expect(
      within(menu).queryByRole('menuitem', { name: 'Clear filter' })
    ).toBeNull();
    fireEvent.click(
      within(menu).getByRole('menuitem', { name: 'Clear all filters' })
    );
    expect(namesInOrder()).toEqual(['Bob', 'Alice', 'Cara', 'Dan']);
    expect(isFiltered('City')).toBe(false);
  });

  test('unchecking a value under a search leaves the values the search hid alone', () => {
    renderGrid();
    const dialog = openFilter('City');
    fireEvent.change(
      within(dialog).getByRole('textbox', { name: 'Search City values' }),
      { target: { value: 'aus' } }
    );
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Austin' }));
    fireEvent.change(
      within(dialog).getByRole('textbox', { name: 'Search City values' }),
      { target: { value: '' } }
    );
    // Boston and the blank row were never touched, so they are still shown.
    expect(namesInOrder()).toEqual(['Alice', 'Dan']);
  });

  test('opening another header menu closes the filter popover', () => {
    renderGrid();
    openFilter('City');
    // A contextmenu with no preceding mousedown (Shift+F10, a long press).
    fireEvent.contextMenu(header('Name'), { clientX: 10, clientY: 10 });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      screen.getByRole('menu', { name: 'Column Name actions' })
    ).toBeTruthy();
  });

  test('a filter survives sorting and is applied to the sorted order', () => {
    renderGrid();
    const dialog = openFilter('City');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Boston' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    fireEvent.contextMenu(header('Name'), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sort Z → A' }));
    expect(namesInOrder()).toEqual(['Dan', 'Cara', 'Bob']);
  });
});
