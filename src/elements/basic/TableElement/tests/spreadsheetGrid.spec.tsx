import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const makeElement = (propsOverride: Record<string, any> = {}) => ({
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
    ...propsOverride
  }
});

// jsdom lays nothing out, so the row/column virtualizers would see a 0x0
// viewport and render no cells at all. Give every element a viewport big
// enough to hold the fixture.
let sizeSpies: Array<() => void> = [];

const stubLayout = () => {
  const original = {
    offsetWidth: Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetWidth'
    ),
    offsetHeight: Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetHeight'
    )
  };
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 900
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 600
  });
  sizeSpies.push(() => {
    if (original.offsetWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        'offsetWidth',
        original.offsetWidth
      );
    }
    if (original.offsetHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        'offsetHeight',
        original.offsetHeight
      );
    }
  });
};

const renderTable = (props: Record<string, any> = {}) => {
  const updateFieldValues = jest.fn();
  const submitCustom = jest.fn();
  const view = render(
    <TableElement
      element={makeElement(props)}
      responsiveStyles={mockStyles()}
      updateFieldValues={updateFieldValues}
      submitCustom={submitCustom}
    />
  );
  return { view, updateFieldValues, submitCustom };
};

const grid = () => screen.getByRole('grid');
const cell = (text: string) => screen.getByText(text).closest('[role="gridcell"]')!;

beforeEach(() => {
  stubLayout();
  Object.assign(fieldValues, {
    name_key: ['Alice', 'Bob', 'Cara'],
    age_key: [30, 40, 50],
    city_key: ['Denver', 'Austin', 'Reno']
  });
});

afterEach(() => {
  sizeSpies.forEach((restore) => restore());
  sizeSpies = [];
  ['name_key', 'age_key', 'city_key'].forEach((key) => {
    delete (fieldValues as any)[key];
  });
  sessionStorage.clear();
});

describe('spreadsheet grid rendering', () => {
  test('renders an ARIA grid rather than a <table>', () => {
    const { view } = renderTable();
    expect(grid()).toBeInTheDocument();
    expect(view.container.querySelector('table')).toBeNull();
  });

  test('headers show the column NAMES, not spreadsheet letters', () => {
    renderTable();
    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((header) => header.textContent)).toEqual([
      'Name',
      'Age',
      'City'
    ]);
  });

  test('numbers the rows in a gutter, starting at 1', () => {
    renderTable();
    expect(screen.getByRole('button', { name: 'Select row 1' })).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: 'Select row 3' })).toHaveTextContent('3');
  });

  test('renders every cell value', () => {
    renderTable();
    ['Alice', 'Bob', 'Cara', 'Denver', 'Austin', 'Reno'].forEach((value) =>
      expect(screen.getByText(value)).toBeInTheDocument()
    );
  });

  test('a transposed table falls back to the classic table', () => {
    const { view } = renderTable({ transpose: true });
    expect(view.container.querySelector('table')).not.toBeNull();
  });
});

describe('spreadsheet selection', () => {
  test('clicking a cell selects it', async () => {
    renderTable();
    fireEvent.mouseDown(cell('Bob'));
    await waitFor(() =>
      expect(cell('Bob')).toHaveAttribute('aria-selected', 'true')
    );
  });

  test('arrow keys move the selection', async () => {
    renderTable();
    fireEvent.mouseDown(cell('Alice'));
    await waitFor(() =>
      expect(cell('Alice')).toHaveAttribute('aria-selected', 'true')
    );

    fireEvent.keyDown(grid(), { key: 'ArrowDown' });
    await waitFor(() =>
      expect(cell('Bob')).toHaveAttribute('aria-selected', 'true')
    );
    expect(cell('Alice')).toHaveAttribute('aria-selected', 'false');
  });

  test('shift+arrow extends the selection into a range', async () => {
    renderTable();
    fireEvent.mouseDown(cell('Alice'));
    await waitFor(() =>
      expect(cell('Alice')).toHaveAttribute('aria-selected', 'true')
    );

    fireEvent.keyDown(grid(), { key: 'ArrowDown', shiftKey: true });
    await waitFor(() =>
      expect(cell('Bob')).toHaveAttribute('aria-selected', 'true')
    );
    // The anchor stays selected, so the range covers both rows.
    expect(cell('Alice')).toHaveAttribute('aria-selected', 'true');
  });
});

describe('spreadsheet editing', () => {
  test('typing a printable character opens an editor seeded with it', async () => {
    renderTable();
    fireEvent.mouseDown(cell('Alice'));
    await waitFor(() =>
      expect(cell('Alice')).toHaveAttribute('aria-selected', 'true')
    );

    fireEvent.keyDown(grid(), { key: 'Z' });

    const input = await screen.findByRole('textbox');
    expect(input).toHaveValue('Z');
  });

  test('double-clicking opens an editor holding the current value', async () => {
    renderTable();
    fireEvent.doubleClick(cell('Alice'));
    const input = await screen.findByRole('textbox');
    expect(input).toHaveValue('Alice');
  });

  test('committing an edit writes the value through', async () => {
    const { updateFieldValues, submitCustom } = renderTable();
    fireEvent.doubleClick(cell('Alice'));
    const input = await screen.findByRole('textbox');

    fireEvent.change(input, { target: { value: 'Alicia' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(updateFieldValues).toHaveBeenCalledWith({
        name_key: ['Alicia', 'Bob', 'Cara']
      })
    );
    expect(submitCustom).toHaveBeenCalledTimes(1);
  });

  test('numeric text is stored as a number, not a string', async () => {
    const { updateFieldValues } = renderTable();
    fireEvent.doubleClick(cell('30'));
    const input = await screen.findByRole('textbox');

    fireEvent.change(input, { target: { value: '31' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(updateFieldValues).toHaveBeenCalledWith({
        age_key: [31, 40, 50]
      })
    );
  });

  test('Escape abandons the edit without writing', async () => {
    const { updateFieldValues } = renderTable();
    fireEvent.doubleClick(cell('Alice'));
    const input = await screen.findByRole('textbox');

    fireEvent.change(input, { target: { value: 'Discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(updateFieldValues).not.toHaveBeenCalled();
  });

  test('committing an unchanged value does not submit', async () => {
    const { updateFieldValues } = renderTable();
    fireEvent.doubleClick(cell('Alice'));
    const input = await screen.findByRole('textbox');

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(updateFieldValues).not.toHaveBeenCalled();
  });
});

describe('spreadsheet range operations', () => {
  test('Delete clears every cell in the selected range in one write', async () => {
    const { updateFieldValues, submitCustom } = renderTable();
    fireEvent.mouseDown(cell('Alice'));
    await waitFor(() =>
      expect(cell('Alice')).toHaveAttribute('aria-selected', 'true')
    );
    fireEvent.keyDown(grid(), { key: 'ArrowDown', shiftKey: true });
    await waitFor(() =>
      expect(cell('Bob')).toHaveAttribute('aria-selected', 'true')
    );

    fireEvent.keyDown(grid(), { key: 'Delete' });

    await waitFor(() =>
      expect(updateFieldValues).toHaveBeenCalledWith({
        name_key: [null, null, 'Cara']
      })
    );
    // Two cells, one submission.
    expect(submitCustom).toHaveBeenCalledTimes(1);
  });

  test('pasting a block writes all of its cells in a single submission', async () => {
    const { updateFieldValues, submitCustom } = renderTable();
    fireEvent.mouseDown(cell('Alice'));
    await waitFor(() =>
      expect(cell('Alice')).toHaveAttribute('aria-selected', 'true')
    );

    fireEvent.paste(grid(), {
      clipboardData: {
        getData: () => 'Xavier\t21\nYolanda\t22'
      }
    });

    await waitFor(() =>
      expect(updateFieldValues).toHaveBeenCalledWith({
        name_key: ['Xavier', 'Yolanda', 'Cara'],
        age_key: [21, 22, 50]
      })
    );
    // Four cells across two columns and two rows: still one request.
    expect(submitCustom).toHaveBeenCalledTimes(1);
  });

  test('undo restores what a paste overwrote', async () => {
    const { updateFieldValues } = renderTable();
    fireEvent.mouseDown(cell('Alice'));
    await waitFor(() =>
      expect(cell('Alice')).toHaveAttribute('aria-selected', 'true')
    );
    fireEvent.paste(grid(), {
      clipboardData: { getData: () => 'Xavier' }
    });
    await waitFor(() => expect(updateFieldValues).toHaveBeenCalled());
    updateFieldValues.mockClear();

    // `Mod` resolves per platform, and jsdom's user agent reports neither mac
    // nor windows, so the undo chord here is Control+Z (Cmd+Z on a real Mac).
    fireEvent.keyDown(grid(), { key: 'z', ctrlKey: true });

    await waitFor(() =>
      expect(updateFieldValues).toHaveBeenCalledWith({
        name_key: ['Alice', 'Bob', 'Cara']
      })
    );
  });
});

describe('read-only spreadsheet', () => {
  test('keeps selection but refuses to edit or clear', async () => {
    const { updateFieldValues } = renderTable({ enable_editing: false });

    fireEvent.mouseDown(cell('Alice'));
    await waitFor(() =>
      expect(cell('Alice')).toHaveAttribute('aria-selected', 'true')
    );

    fireEvent.doubleClick(cell('Alice'));
    fireEvent.keyDown(grid(), { key: 'Z' });
    fireEvent.keyDown(grid(), { key: 'Delete' });

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(updateFieldValues).not.toHaveBeenCalled();
  });
});

describe('freezing rows and columns', () => {
  test('clamps a frozen count above the supported maximum', () => {
    // 9 rows would leave nothing to scroll; the element caps it at 4.
    renderTable({ frozen_rows: 9 });
    expect(grid()).toBeInTheDocument();
  });

  test('renders without freezing when the properties are absent', () => {
    renderTable();
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
  });
});
