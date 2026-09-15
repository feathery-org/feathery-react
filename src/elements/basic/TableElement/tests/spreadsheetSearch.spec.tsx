import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import TableElement from '../index';
import { fieldValues } from '../../../../utils/init';
import { findMatches } from '../spreadsheet/useGridSearch';
import {
  SEARCH_CURRENT_SHADING,
  SEARCH_MATCH_SHADING
} from '../spreadsheet/styles';

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
    name_key: ['Alice', 'Bob', 'Cara'],
    age_key: [30, 40, 50],
    city_key: ['Denver', 'Austin', 'Reno']
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
const grid = () => screen.getByRole('grid');
const findInput = () => screen.getByRole('textbox', { name: 'Find in table' });
const cell = (text: string) =>
  screen.getByText(text).closest('[role="gridcell"]') as HTMLElement;
// `Mod` resolves per platform; jsdom reports neither, so Ctrl is the modifier.
const openFind = () => fireEvent.keyDown(grid(), { key: 'f', ctrlKey: true });

describe('findMatches', () => {
  const rows = [
    { id: 'r0', rowIndex: 0, cells: { a: 'Alice', b: 30 } },
    { id: 'r1', rowIndex: 1, cells: { a: 'Bob', b: 'alpha' } }
  ];
  const columns = [
    { name: 'A', field_id: '', field_type: '', field_key: 'a' },
    { name: 'B', field_id: '', field_type: '', field_key: 'b' }
  ];

  test('matches displayed text case-insensitively, in reading order', () => {
    expect(findMatches(rows, columns, 'AL')).toEqual([
      { rowId: 'r0', rowIndex: 0, columnId: 'a' },
      { rowId: 'r1', rowIndex: 1, columnId: 'b' }
    ]);
    expect(findMatches(rows, columns, '3')).toEqual([
      { rowId: 'r0', rowIndex: 0, columnId: 'b' }
    ]);
  });

  test('a blank query matches nothing', () => {
    expect(findMatches(rows, columns, '   ')).toEqual([]);
  });
});

describe('find in the spreadsheet grid', () => {
  test('Ctrl+F opens the find bar with its input focused; Escape closes it and refocuses the grid', () => {
    renderGrid();
    expect(screen.queryByRole('search')).toBeNull();

    openFind();
    expect(findInput()).toHaveFocus();

    fireEvent.keyDown(findInput(), { key: 'Escape' });
    expect(screen.queryByRole('search')).toBeNull();
    expect(grid()).toHaveFocus();
  });

  test('typing jumps to the first match, Enter and Shift+Enter step through them, and matches are tinted', () => {
    renderGrid();
    openFind();

    fireEvent.change(findInput(), { target: { value: 'a' } });
    // Alice, Austin, Cara — down the rows, left to right.
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    expect(cell('Alice')).toHaveStyle({
      backgroundColor: SEARCH_CURRENT_SHADING.backgroundColor
    });
    expect(cell('Cara')).toHaveStyle({
      backgroundColor: SEARCH_MATCH_SHADING.backgroundColor
    });
    expect(cell('Bob')).not.toHaveStyle({
      backgroundColor: SEARCH_MATCH_SHADING.backgroundColor
    });

    fireEvent.keyDown(findInput(), { key: 'Enter' });
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    expect(cell('Austin')).toHaveStyle({
      backgroundColor: SEARCH_CURRENT_SHADING.backgroundColor
    });
    expect(cell('Alice')).toHaveStyle({
      backgroundColor: SEARCH_MATCH_SHADING.backgroundColor
    });

    fireEvent.keyDown(findInput(), { key: 'Enter' });
    fireEvent.keyDown(findInput(), { key: 'Enter' });
    // Wraps around.
    expect(screen.getByText('1 of 3')).toBeInTheDocument();

    fireEvent.keyDown(findInput(), { key: 'Enter', shiftKey: true });
    expect(screen.getByText('3 of 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Previous match' }));
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
  });

  test('reports when nothing matches and disables the steppers', () => {
    renderGrid();
    openFind();
    fireEvent.change(findInput(), { target: { value: 'zzz' } });
    expect(screen.getByText('No matches')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next match' })).toBeDisabled();
  });

  test('the close button dismisses the bar and clears the tint', () => {
    renderGrid();
    openFind();
    fireEvent.change(findInput(), { target: { value: 'bob' } });
    expect(cell('Bob')).toHaveStyle({
      backgroundColor: SEARCH_CURRENT_SHADING.backgroundColor
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close find' }));
    expect(screen.queryByRole('search')).toBeNull();
    expect(cell('Bob')).not.toHaveStyle({
      backgroundColor: SEARCH_CURRENT_SHADING.backgroundColor
    });
  });
});
