import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import TableElement from '../index';
import { fieldValues } from '../../../../utils/init';

const COLUMNS = [
  { name: 'Name', field_id: 'f1', field_type: 'text', field_key: 'name_key' },
  { name: 'Age', field_id: 'f2', field_type: 'text', field_key: 'age_key' }
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
    // The classic toggle is off: the grid sorts from its header menu regardless.
    sort: false,
    pagination: 0,
    transpose: false,
    display_mode: 'spreadsheet',
    enable_editing: true
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
    name_key: ['Bob', 'Alice', 'Cara'],
    age_key: [40, 50, 30]
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
  ['name_key', 'age_key'].forEach((key) => {
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

describe('spreadsheet column sorting', () => {
  test('right-clicking a header offers sort options, and sorting reorders the rows', () => {
    renderGrid();
    expect(namesInOrder()).toEqual(['Bob', 'Alice', 'Cara']);

    fireEvent.contextMenu(header('Age'), { clientX: 10, clientY: 10 });
    const menu = screen.getByRole('menu', { name: 'Column Age actions' });
    expect(
      within(menu).queryByRole('menuitem', { name: 'Clear sort' })
    ).toBeNull();

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Sort A → Z' }));
    expect(namesInOrder()).toEqual(['Cara', 'Bob', 'Alice']);
    expect(header('Age')).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.contextMenu(header('Age'), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sort Z → A' }));
    expect(namesInOrder()).toEqual(['Alice', 'Bob', 'Cara']);
    expect(header('Age')).toHaveAttribute('aria-sort', 'descending');

    fireEvent.contextMenu(header('Age'), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear sort' }));
    expect(namesInOrder()).toEqual(['Bob', 'Alice', 'Cara']);
    expect(header('Age')).not.toHaveAttribute('aria-sort');
  });

  test('sorting another column replaces the previous sort', () => {
    renderGrid();
    fireEvent.contextMenu(header('Age'), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sort A → Z' }));
    fireEvent.contextMenu(header('Name'), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sort A → Z' }));
    expect(namesInOrder()).toEqual(['Alice', 'Bob', 'Cara']);
    expect(header('Age')).not.toHaveAttribute('aria-sort');
    expect(header('Name')).toHaveAttribute('aria-sort', 'ascending');
  });
});
