import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import TableElement from '../index';
import { fieldValues } from '../../../../utils/init';

const COLUMNS = [
  { name: 'Name', field_id: 'f1', field_type: 'text', field_key: 'name_key' },
  { name: 'Age', field_id: 'f2', field_type: 'text', field_key: 'age_key' },
  { name: 'City', field_id: 'f3', field_type: 'text', field_key: 'city_key' }
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
    age_key: [40, 50, 30],
    city_key: ['Austin', 'Boston', 'Austin']
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
  ['name_key', 'age_key', 'city_key'].forEach((key) => {
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
const headerOrder = () =>
  screen
    .getAllByRole('columnheader')
    .sort(
      (a, b) =>
        Number(a.getAttribute('aria-colindex')) -
        Number(b.getAttribute('aria-colindex'))
    )
    .map((h) => h.textContent);
const dataRows = () => screen.getAllByRole('row').slice(1);
const rowTexts = () =>
  dataRows().map((row) =>
    within(row)
      .getAllByRole('gridcell')
      .map((cell) => cell.textContent)
      .join('|')
  );
const rowNumber = (n: number) =>
  screen.getByRole('button', { name: `Select row ${n}` });

describe('spreadsheet pinning', () => {
  test('pinning a column moves it to the left edge and unpinning restores it', () => {
    renderGrid();
    expect(headerOrder()).toEqual(['Name', 'Age', 'City']);

    fireEvent.contextMenu(header('City'), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin column' }));
    expect(headerOrder()).toEqual(['City', 'Name', 'Age']);
    // Cells follow the header order.
    expect(rowTexts()[0]).toBe('Austin|Bob|40');

    fireEvent.contextMenu(header('City'), { clientX: 10, clientY: 10 });
    const menu = screen.getByRole('menu', { name: 'Column City actions' });
    expect(
      within(menu).queryByRole('menuitem', { name: 'Pin column' })
    ).toBeNull();
    fireEvent.click(
      within(menu).getByRole('menuitem', { name: 'Unpin column' })
    );
    expect(headerOrder()).toEqual(['Name', 'Age', 'City']);
  });

  test('pinning a row lifts it to the top, in pin order, and unpinning returns it', () => {
    renderGrid();
    expect(rowTexts().map((t) => t.split('|')[0])).toEqual([
      'Bob',
      'Alice',
      'Cara'
    ]);

    fireEvent.contextMenu(rowNumber(3), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin row' }));
    expect(rowTexts().map((t) => t.split('|')[0])).toEqual([
      'Cara',
      'Bob',
      'Alice'
    ]);
    expect(dataRows()[0]).toHaveAttribute('aria-rowindex', '2');

    // The pinned row is now row 1; its menu offers to unpin it.
    fireEvent.contextMenu(rowNumber(1), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unpin row' }));
    expect(rowTexts().map((t) => t.split('|')[0])).toEqual([
      'Bob',
      'Alice',
      'Cara'
    ]);
  });

  test('a pinned row stays pinned through a sort and a filter that hides it', () => {
    renderGrid();
    fireEvent.contextMenu(rowNumber(2), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin row' }));
    // Alice (Boston) pinned; sort by Name Z→A reorders only the rest.
    fireEvent.contextMenu(header('Name'), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sort Z → A' }));
    expect(rowTexts().map((t) => t.split('|')[0])).toEqual([
      'Alice',
      'Cara',
      'Bob'
    ]);

    fireEvent.contextMenu(header('City'), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Filter…' }));
    const dialog = screen.getByRole('dialog', { name: 'Filter column City' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Boston' }));
    expect(rowTexts().map((t) => t.split('|')[0])).toEqual(['Cara', 'Bob']);
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Clear filter' })
    );
    expect(rowTexts().map((t) => t.split('|')[0])).toEqual([
      'Alice',
      'Cara',
      'Bob'
    ]);
  });
});
