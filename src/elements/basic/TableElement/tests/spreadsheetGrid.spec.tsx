import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react';
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
// Spreadsheet edits are buffered, so nothing reaches the data source until the
// user saves them.
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));

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

  test('spreadsheet style overrides a stored Flip Table setting', () => {
    // Flipping puts one field per row, which has no (row, column) coordinates
    // for selection, fill or the clipboard. Spreadsheet mode therefore ignores
    // it rather than silently falling back to the classic table.
    const { view } = renderTable({ transpose: true });
    expect(grid()).toBeInTheDocument();
    expect(view.container.querySelector('table')).toBeNull();
    expect(
      screen.getAllByRole('columnheader').map((h) => h.textContent)
    ).toEqual(['Name', 'Age', 'City']);
  });

  test('spreadsheet style overrides stored search and pagination', () => {
    renderTable({ search: true, sort: true, pagination: 2 });
    // No search box, and all three rows render rather than one page of two.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Cara')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select row 3' })).toBeInTheDocument();
  });

  test('the classic table still honours those settings', () => {
    const { view } = renderTable({ display_mode: 'classic', search: true });
    expect(view.container.querySelector('table')).not.toBeNull();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
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

    expect(updateFieldValues).not.toHaveBeenCalled();
    save();

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
    save();

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
    save();

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
    save();

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
    await waitFor(() => expect(cell('Xavier')).toBeInTheDocument());

    // `Mod` resolves per platform, and jsdom's user agent reports neither mac
    // nor windows, so the undo chord here is Control+Z (Cmd+Z on a real Mac).
    fireEvent.keyDown(grid(), { key: 'z', ctrlKey: true });
    await waitFor(() => expect(cell('Alice')).toBeInTheDocument());
    save();

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

describe('row insertion and deletion', () => {
  const openRowMenu = (rowNumber: number) => {
    const header = screen.getByRole('button', { name: `Select row ${rowNumber}` });
    fireEvent.contextMenu(header);
  };

  test('no row menu or add strip when adding and deleting are off', () => {
    renderTable({ add_delete_rows: false });
    openRowMenu(2);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Add row' })).toBeNull();
  });

  test('right-clicking a row header offers insert and delete', () => {
    renderTable({ add_delete_rows: true });
    openRowMenu(2);

    const menu = screen.getByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent)
    ).toEqual(['Insert row above', 'Insert row below', 'Delete row 2']);
  });

  test('insert above adds a blank row at that index', async () => {
    const { updateFieldValues } = renderTable({ add_delete_rows: true });
    openRowMenu(2);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Insert row above' }));

    await waitFor(() =>
      expect(updateFieldValues).toHaveBeenCalledWith({
        name_key: ['Alice', '', 'Bob', 'Cara'],
        age_key: [30, '', 40, 50],
        city_key: ['Denver', '', 'Austin', 'Reno']
      })
    );
  });

  test('insert below adds a blank row after that index', async () => {
    const { updateFieldValues } = renderTable({ add_delete_rows: true });
    openRowMenu(2);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Insert row below' }));

    await waitFor(() =>
      expect(updateFieldValues).toHaveBeenCalledWith({
        name_key: ['Alice', 'Bob', '', 'Cara'],
        age_key: [30, 40, '', 50],
        city_key: ['Denver', 'Austin', '', 'Reno']
      })
    );
  });

  test('delete removes that row', async () => {
    const { updateFieldValues } = renderTable({ add_delete_rows: true });
    openRowMenu(2);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete row 2' }));
    // The row leaves the grid immediately, but the source keeps it until save.
    await waitFor(() => expect(screen.queryByText('Bob')).toBeNull());
    expect(updateFieldValues).not.toHaveBeenCalled();
    save();

    await waitFor(() =>
      expect(updateFieldValues).toHaveBeenCalledWith({
        name_key: ['Alice', 'Cara'],
        age_key: [30, 50],
        city_key: ['Denver', 'Reno']
      })
    );
  });

  test('a new row is not submitted until a cell is edited', async () => {
    const { submitCustom } = renderTable({ add_delete_rows: true });
    openRowMenu(1);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Insert row below' }));

    // An empty row would just fail required fields on the backend.
    await waitFor(() => expect(submitCustom).not.toHaveBeenCalled());
  });

  test('Escape dismisses the menu', async () => {
    renderTable({ add_delete_rows: true });
    openRowMenu(2);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  test('the trailing add strip appends a row at the end', async () => {
    const { updateFieldValues } = renderTable({ add_delete_rows: true });
    fireEvent.click(screen.getByRole('button', { name: '+ Add row' }));

    await waitFor(() =>
      expect(updateFieldValues).toHaveBeenCalledWith({
        name_key: ['Alice', 'Bob', 'Cara', ''],
        age_key: [30, 40, 50, ''],
        city_key: ['Denver', 'Austin', 'Reno', '']
      })
    );
  });

  test('the toolbar add button gives way to the trailing strip', () => {
    renderTable({ add_delete_rows: true });
    // Two "add row" affordances would be one too many.
    expect(screen.queryByText('+ Add Row')).toBeNull();
    expect(screen.getByRole('button', { name: '+ Add row' })).toBeInTheDocument();
  });

  test('the classic table keeps its toolbar add button', () => {
    renderTable({ add_delete_rows: true, display_mode: 'classic' });
    expect(screen.getByText('+ Add Row')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Add row' })).toBeNull();
  });
});

describe('Tab and the grid boundary', () => {
  test('Tab moves the selection along the row', async () => {
    renderTable();
    fireEvent.mouseDown(cell('Alice'));
    await waitFor(() =>
      expect(cell('Alice')).toHaveAttribute('aria-selected', 'true')
    );
    // Focus must live on the grid, never a cell: a focusable cell that the
    // virtualizer unmounts while scrolling takes the keyboard with it.
    expect(cell('Alice')).not.toHaveAttribute('tabindex');
    expect(document.activeElement).toBe(grid());

    // fireEvent returns false once the default has been prevented, i.e. the
    // grid took the key rather than the browser.
    expect(fireEvent.keyDown(grid(), { key: 'Tab' })).toBe(false);
    await waitFor(() =>
      expect(cell('30')).toHaveAttribute('aria-selected', 'true')
    );
    expect(fireEvent.keyDown(grid(), { key: 'Tab', shiftKey: true })).toBe(false);
    await waitFor(() =>
      expect(cell('Alice')).toHaveAttribute('aria-selected', 'true')
    );
  });

  test('Tab at the last column and Shift+Tab at the first leave the grid to the browser', async () => {
    // Otherwise a keyboard user could never reach the rest of the form.
    renderTable();
    fireEvent.mouseDown(cell('Denver'));
    await waitFor(() =>
      expect(cell('Denver')).toHaveAttribute('aria-selected', 'true')
    );
    expect(fireEvent.keyDown(grid(), { key: 'Tab' })).toBe(true);
    expect(cell('Denver')).toHaveAttribute('aria-selected', 'true');

    fireEvent.mouseDown(cell('Alice'));
    await waitFor(() =>
      expect(cell('Alice')).toHaveAttribute('aria-selected', 'true')
    );
    expect(fireEvent.keyDown(grid(), { key: 'Tab', shiftKey: true })).toBe(true);
    expect(cell('Alice')).toHaveAttribute('aria-selected', 'true');
  });
});
