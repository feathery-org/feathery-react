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
import { SpreadsheetTable } from '../spreadsheet/SpreadsheetTable';

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

  test('Enter on the last row appends a row and selects the same column', async () => {
    const { updateFieldValues, submitCustom } = renderTable({ add_delete_rows: true });
    updateFieldValues.mockImplementation((updates) => Object.assign(fieldValues, updates));
    fireEvent.mouseDown(cell('Reno'));
    fireEvent.keyDown(grid(), { key: 'Enter' });

    await waitFor(() => expect(grid()).toHaveAttribute('aria-rowcount', '5'));
    const newCell = screen.getAllByRole('gridcell').at(-1)!;
    expect(newCell).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(grid());
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(submitCustom).not.toHaveBeenCalled();

    fireEvent.keyDown(grid(), { key: 'N' });
    expect(await screen.findByRole('textbox')).toHaveValue('N');
    expect(newCell).toContainElement(screen.getByRole('textbox'));
  });

  test('Enter commits the last-row edit before appending and keeps both rows editable', async () => {
    const { updateFieldValues } = renderTable({ add_delete_rows: true });
    updateFieldValues.mockImplementation((updates) => Object.assign(fieldValues, updates));
    fireEvent.doubleClick(cell('Cara'));
    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: 'Caroline' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(grid()).toHaveAttribute('aria-rowcount', '5'));
    expect(cell('Caroline')).toBeInTheDocument();
    expect(screen.getAllByRole('gridcell')[9]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(grid(), { key: 'D' });
    const newInput = await screen.findByRole('textbox');
    fireEvent.change(newInput, { target: { value: 'Dana' } });
    fireEvent.keyDown(newInput, { key: 'Tab' });
    save();

    await waitFor(() => expect(updateFieldValues).toHaveBeenLastCalledWith({
      name_key: ['Alice', 'Bob', 'Caroline', 'Dana']
    }));
  });

  test('Enter append preserves undo and redo for the committed edit and earlier edits', async () => {
    const { updateFieldValues } = renderTable({ add_delete_rows: true });
    updateFieldValues.mockImplementation((updates) => Object.assign(fieldValues, updates));
    fireEvent.doubleClick(cell('Alice'));
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'Alicia' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Tab' });
    fireEvent.doubleClick(cell('Cara'));
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'Caroline' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await waitFor(() => expect(grid()).toHaveAttribute('aria-rowcount', '5'));

    fireEvent.keyDown(grid(), { key: 'z', ctrlKey: true });
    expect(cell('Cara')).toBeInTheDocument();
    expect(cell('Alicia')).toBeInTheDocument();
    fireEvent.keyDown(grid(), { key: 'z', ctrlKey: true });
    expect(cell('Alice')).toBeInTheDocument();
    fireEvent.keyDown(grid(), { key: 'z', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(grid(), { key: 'z', ctrlKey: true, shiftKey: true });
    expect(cell('Alicia')).toBeInTheDocument();
    expect(cell('Caroline')).toBeInTheDocument();
    expect(grid()).toHaveAttribute('aria-rowcount', '5');
  });

  test('inserting before existing rows still clears index-keyed undo history', async () => {
    const { updateFieldValues } = renderTable({ add_delete_rows: true });
    updateFieldValues.mockImplementation((updates) => Object.assign(fieldValues, updates));
    fireEvent.doubleClick(cell('Cara'));
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'Caroline' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Tab' });
    openRowMenu(2);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Insert row above' }));
    await waitFor(() => expect(grid()).toHaveAttribute('aria-rowcount', '5'));

    fireEvent.keyDown(grid(), { key: 'z', ctrlKey: true });
    expect(cell('Caroline')).toBeInTheDocument();
    expect(cell('Bob')).toBeInTheDocument();
    expect(screen.queryByText('Cara')).toBeNull();
  });

  test.each([
    ['Shift+Enter', { key: 'Enter', shiftKey: true }],
    ['ArrowDown', { key: 'ArrowDown', shiftKey: false }]
  ])('%s on the last row does not append', (_name, key) => {
    const { updateFieldValues } = renderTable({ add_delete_rows: true });
    fireEvent.mouseDown(cell('Cara'));
    fireEvent.keyDown(grid(), key);
    expect(updateFieldValues).not.toHaveBeenCalled();
    expect(cell(key.shiftKey ? 'Bob' : 'Cara')).toHaveAttribute('aria-selected', 'true');
  });

  test.each([
    { add_delete_rows: false },
    { add_delete_rows: true, enable_editing: false }
  ])('Enter does not append when row editing is disabled: %j', (props) => {
    const { updateFieldValues } = renderTable(props);
    fireEvent.mouseDown(cell('Cara'));
    fireEvent.keyDown(grid(), { key: 'Enter' });
    const input = screen.queryByRole('textbox');
    if (input) fireEvent.keyDown(input, { key: 'Enter' });
    expect(updateFieldValues).not.toHaveBeenCalled();
    expect(grid()).toHaveAttribute('aria-rowcount', '4');
  });

  test('Shift+Enter from the last-row editor commits and moves up without appending', async () => {
    const { updateFieldValues } = renderTable({ add_delete_rows: true });
    fireEvent.doubleClick(cell('Cara'));
    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: 'Caroline' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(cell('Bob')).toHaveAttribute('aria-selected', 'true');
    expect(cell('Caroline')).toBeInTheDocument();
    expect(updateFieldValues).not.toHaveBeenCalled();
  });

  test.each([false, true])('native dropdown Enter release honors row navigation (shift: %s)', async (shiftKey) => {
    const onInsertRow = jest.fn();
    render(
      <SpreadsheetTable
        columns={COLUMNS}
        rowIndices={[0, 1, 2]}
        fieldValues={fieldValues}
        canEdit
        onCellsEdit={jest.fn()}
        onInsertRow={onInsertRow}
        cellRules={{ city_key: { label: 'City', type: 'text', options: ['Denver', 'Austin', 'Reno'] } }}
      />
    );
    fireEvent.doubleClick(cell('Reno'));
    const select = await screen.findByRole('combobox');
    const later = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 5000);
    fireEvent.keyUp(select, { key: 'Enter', shiftKey });
    later.mockRestore();

    expect(screen.queryByRole('combobox')).toBeNull();
    if (shiftKey) {
      expect(onInsertRow).not.toHaveBeenCalled();
      expect(cell('Austin')).toHaveAttribute('aria-selected', 'true');
    } else {
      expect(onInsertRow).toHaveBeenCalledWith(3);
    }
  });

  test.each(['Enter', 'mouse'])('changing a native dropdown with %s commits immediately and only Enter appends', async (gesture) => {
    const onInsertRow = jest.fn();
    const onCellsEdit = jest.fn();
    render(
      <SpreadsheetTable
        columns={COLUMNS}
        rowIndices={[0, 1, 2]}
        fieldValues={fieldValues}
        canEdit
        onCellsEdit={onCellsEdit}
        onInsertRow={onInsertRow}
        cellRules={{ city_key: { label: 'City', type: 'text', options: ['Denver', 'Austin', 'Reno'] } }}
      />
    );
    fireEvent.doubleClick(cell('Reno'));
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'Denver' } });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(onCellsEdit).toHaveBeenCalledWith([{ rowIndex: 2, fieldKey: 'city_key', value: 'Denver' }]);
    expect(onInsertRow).not.toHaveBeenCalled();

    if (gesture === 'mouse') {
      // A mouse choice has no Enter release. A subsequent keyboard gesture
      // must clear the choice before an unrelated Enter can be released.
      fireEvent.keyDown(grid(), { key: 'ArrowUp' });
    }
    fireEvent.keyUp(document, { key: 'Enter' });
    if (gesture === 'Enter') {
      expect(onInsertRow).toHaveBeenCalledWith(3);
    } else {
      expect(onInsertRow).not.toHaveBeenCalled();
      expect(cell('Austin')).toHaveAttribute('aria-selected', 'true');
    }
  });

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

describe('fill handle', () => {
  const handle = () => document.querySelector('.feathery-table-grid-fill-handle');

  test('is hidden while a cell is being edited', async () => {
    renderTable();
    fireEvent.mouseDown(cell('Alice'));
    await waitFor(() => expect(handle()).not.toBeNull());

    fireEvent.doubleClick(cell('Alice'));
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());
    expect(handle()).toBeNull();

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    await waitFor(() => expect(handle()).not.toBeNull());
  });
});

describe('designer preview', () => {
  const rowCount = () => Number(grid().getAttribute('aria-rowcount')) - 1;

  test('a sized spreadsheet preview fills its height with sample rows', () => {
    render(
      <TableElement
        element={{ ...makeElement(), styles: { height: 400, height_unit: 'px' } }}
        responsiveStyles={mockStyles()}
        updateFieldValues={jest.fn()}
        submitCustom={jest.fn()}
        editMode
      />
    );
    expect(rowCount()).toBe(10);
  });

  test('a fit-height preview keeps the short sample', () => {
    render(
      <TableElement
        element={{ ...makeElement(), styles: { height: '', height_unit: 'fit' } }}
        responsiveStyles={mockStyles()}
        updateFieldValues={jest.fn()}
        submitCustom={jest.fn()}
        editMode
      />
    );
    expect(rowCount()).toBe(2);
  });
});
