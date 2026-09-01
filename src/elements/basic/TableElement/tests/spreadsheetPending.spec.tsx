import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TableElement from '../index';
import { fieldValues } from '../../../../utils/init';
import { featheryWindow } from '../../../../utils/browser';
import {
  hasUnsavedWork,
  unsavedWorkMessage,
  _clearUnsavedWorkRegistry
} from '../../../../utils/unsavedWork';

const COLUMNS = [
  { name: 'Name', field_id: 'f1', field_type: 'text', field_key: 'name_key' },
  { name: 'Email', field_id: 'f2', field_type: 'email', field_key: 'email_key' }
];

const HUB_FIELDS = [
  { id: 'hf1', key: 'name', type: 'text', required: false, unique: false },
  { id: 'hf2', key: 'email', type: 'email', required: false, unique: false }
];

const mockStyles = () => ({
  addTargets: jest.fn(),
  apply: jest.fn(),
  getTarget: jest.fn(() => ({}))
});

// jsdom lays nothing out, so the virtualizers would see a 0x0 viewport and
// render no cells. Give every element a viewport big enough for the fixture.
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

const renderTable = (
  props: Record<string, any> = {},
  extra: Record<string, any> = {}
) => {
  const updateFieldValues = jest.fn();
  const submitCustom = jest.fn();
  const view = render(
    <TableElement
      element={{
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
          add_delete_rows: true,
          ...props
        }
      }}
      responsiveStyles={mockStyles()}
      updateFieldValues={updateFieldValues}
      submitCustom={submitCustom}
      {...extra}
    />
  );
  return { updateFieldValues, submitCustom, unmount: view.unmount };
};

const grid = () => screen.getByRole('grid');
const cell = (text: string) =>
  screen.getByText(text).closest('[role="gridcell"]')!;
const saveButton = () => screen.getByRole('button', { name: 'Save' });
const discardButton = () => screen.getByRole('button', { name: 'Discard' });
// Discarding cannot be undone, so it asks first.
const discard = (accept = true) => {
  const confirmSpy = jest
    .spyOn(featheryWindow(), 'confirm')
    .mockReturnValue(accept);
  fireEvent.click(discardButton());
  const asked = confirmSpy.mock.calls.map((call) => call[0]);
  confirmSpy.mockRestore();
  return asked;
};
const status = () => screen.getByRole('status');

const editCell = (from: string, to: string) => {
  fireEvent.doubleClick(cell(from));
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: to } });
  fireEvent.keyDown(input, { key: 'Enter' });
};

beforeEach(() => {
  stubLayout();
  Object.assign(fieldValues, {
    name_key: ['Alice', 'Bob'],
    email_key: ['alice@test.com', 'bob@test.com']
  });
});

afterEach(() => {
  _clearUnsavedWorkRegistry();
  sizeSpies.forEach((restore) => restore());
  sizeSpies = [];
  ['name_key', 'email_key'].forEach((key) => {
    delete (fieldValues as any)[key];
  });
});

describe('unsaved changes bar', () => {
  test('stays hidden until there is something to save', () => {
    renderTable();
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('counts the buffered edits instead of writing them', () => {
    const { updateFieldValues, submitCustom } = renderTable();
    editCell('Alice', 'Alicia');

    expect(status()).toHaveTextContent('1 unsaved change');
    expect(updateFieldValues).not.toHaveBeenCalled();
    expect(submitCustom).not.toHaveBeenCalled();
  });

  test('a second edit to the same cell is still one change', () => {
    renderTable();
    editCell('Alice', 'Alicia');
    editCell('Alicia', 'Alexa');
    expect(status()).toHaveTextContent('1 unsaved change');
  });

  test('a removed row counts as a change and leaves the grid', () => {
    renderTable();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Select row 2' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete row 2' }));

    expect(screen.queryByText('Bob')).toBeNull();
    expect(status()).toHaveTextContent('1 unsaved change');
  });

  test('Save writes the whole buffer at once, then clears the bar', async () => {
    const { updateFieldValues, submitCustom } = renderTable();
    editCell('Alice', 'Alicia');
    editCell('bob@test.com', 'robert@test.com');
    expect(status()).toHaveTextContent('2 unsaved changes');

    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(updateFieldValues).toHaveBeenCalledWith({
        name_key: ['Alicia', 'Bob'],
        email_key: ['alice@test.com', 'robert@test.com']
      })
    );
    expect(submitCustom).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('Discard restores the stored values and writes nothing', async () => {
    const { updateFieldValues } = renderTable();
    editCell('Alice', 'Alicia');

    const asked = discard();

    expect(asked).toEqual(['Discard your unsaved change?']);
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(updateFieldValues).not.toHaveBeenCalled();
  });

  test('a discarded row deletion comes back', async () => {
    renderTable();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Select row 2' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete row 2' }));
    discard();

    await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument());
  });

  test('declining the discard prompt keeps the edits', () => {
    renderTable();
    editCell('Alice', 'Alicia');

    const asked = discard(false);

    expect(asked).toEqual(['Discard your unsaved change?']);
    expect(status()).toHaveTextContent('1 unsaved change');
    expect(screen.getByText('Alicia')).toBeInTheDocument();
  });

  test('the prompt counts what is about to be thrown away', () => {
    renderTable();
    editCell('Alice', 'Alicia');
    editCell('bob@test.com', 'robert@test.com');

    expect(discard(false)).toEqual(['Discard your 2 unsaved changes?']);
  });

  test('the classic table keeps writing through, with no bar', async () => {
    const { updateFieldValues } = renderTable({ display_mode: 'classic' });
    fireEvent.click(screen.getByText('Alice'));
    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: 'Alicia' } });
    fireEvent.blur(input);

    await waitFor(() => expect(updateFieldValues).toHaveBeenCalled());
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('validation errors', () => {
  test('a bad value is counted and blocks the save', () => {
    renderTable();
    editCell('alice@test.com', 'not-an-email');

    expect(status()).toHaveTextContent('1 error');
    expect(saveButton()).toBeDisabled();
  });

  test('fixing the value re-enables the save', () => {
    renderTable();
    editCell('alice@test.com', 'not-an-email');
    editCell('not-an-email', 'alice@example.com');

    expect(saveButton()).toBeEnabled();
    expect(status()).not.toHaveTextContent('error');
  });

  test('the failing cell is shaded and carries its message', () => {
    renderTable();
    editCell('alice@test.com', 'not-an-email');

    expect(cell('not-an-email')).toHaveAttribute(
      'title',
      expect.stringContaining('invalid email address')
    );
  });

  test('the stepper walks the failing cells and shows the message', async () => {
    Object.assign(fieldValues, {
      name_key: ['Alice', 'Bob'],
      email_key: ['bad-one', 'bad-two']
    });
    renderTable();
    // Two stored values that were never valid, so both are flagged on render.
    expect(status()).toHaveTextContent('2 errors');

    fireEvent.click(screen.getByRole('button', { name: 'Go to next issue' }));
    await waitFor(() =>
      expect(cell('bad-one')).toHaveAttribute('aria-selected', 'true')
    );
    // The focused cell explains itself rather than waiting for a hover.
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'invalid email address'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Go to next issue' }));
    await waitFor(() =>
      expect(cell('bad-two')).toHaveAttribute('aria-selected', 'true')
    );

    // Stepping past the end wraps back to the first.
    fireEvent.click(screen.getByRole('button', { name: 'Go to next issue' }));
    await waitFor(() =>
      expect(cell('bad-one')).toHaveAttribute('aria-selected', 'true')
    );
  });

  test('stepping backwards from the start lands on the last issue', async () => {
    Object.assign(fieldValues, {
      name_key: ['Alice', 'Bob'],
      email_key: ['bad-one', 'bad-two']
    });
    renderTable();

    fireEvent.click(
      screen.getByRole('button', { name: 'Go to previous issue' })
    );
    await waitFor(() =>
      expect(cell('bad-two')).toHaveAttribute('aria-selected', 'true')
    );
  });

  test('the grid keeps the keyboard after the stepper moves the selection', async () => {
    Object.assign(fieldValues, {
      name_key: ['Alice', 'Bob'],
      email_key: ['bad-one', 'bob@test.com']
    });
    renderTable();

    fireEvent.click(screen.getByRole('button', { name: 'Go to next issue' }));
    await waitFor(() => expect(grid()).toHaveFocus());
  });
});

describe('cell editors follow the column', () => {
  // The hub fixture gives Status a fixed option list; a field-backed column
  // has none, so it stays a free-text box.
  const HUB_COLUMNS = [
    {
      name: 'Name',
      field_id: '',
      field_type: '',
      field_key: '',
      hub_field_id: 'hf1',
      hub_field_key: 'name'
    },
    {
      name: 'Status',
      field_id: '',
      field_type: '',
      field_key: '',
      hub_field_id: 'hf3',
      hub_field_key: 'status'
    }
  ];
  const FIELDS_WITH_OPTIONS = [
    { id: 'hf1', key: 'name', type: 'text', required: false, unique: false },
    {
      id: 'hf3',
      key: 'status',
      type: 'text',
      required: false,
      unique: false,
      metadata: { options: ['Ready', 'Sent'] }
    }
  ];
  const hubProps = {
    columns: HUB_COLUMNS,
    data_source: 'hub',
    hub_id: 'hub1',
    hub_verification: 'all'
  };
  const client = () => ({
    getHubSchemas: jest.fn(() =>
      Promise.resolve({
        hubs: [{ id: 'hub1', key: 'h', fields: FIELDS_WITH_OPTIONS }]
      })
    ),
    dataHubAction: jest.fn(({ operation }: any) =>
      operation === 'get'
        ? Promise.resolve([
            { id: 'e1', verified: true, data: { name: 'Alice', status: 'Ready' } }
          ])
        : Promise.resolve({})
    )
  });

  test('a column with options edits through a dropdown', async () => {
    renderTable(hubProps, { client: client() });
    await waitFor(() => expect(screen.getByText('Ready')).toBeInTheDocument());

    fireEvent.doubleClick(cell('Ready'));

    const select = await screen.findByRole('combobox');
    expect(select).toHaveValue('Ready');
    expect(
      [...select.querySelectorAll('option')].map((o) => o.textContent)
    ).toEqual(['(empty)', 'Ready', 'Sent']);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  test('picking an option commits it straight away', async () => {
    renderTable(hubProps, { client: client() });
    await waitFor(() => expect(screen.getByText('Ready')).toBeInTheDocument());

    fireEvent.doubleClick(cell('Ready'));
    fireEvent.change(await screen.findByRole('combobox'), {
      target: { value: 'Sent' }
    });

    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
    expect(status()).toHaveTextContent('1 unsaved change');
    expect(screen.getByText('Sent')).toBeInTheDocument();
  });

  test('typing a letter on a dropdown cell jumps to that option', async () => {
    renderTable(hubProps, { client: client() });
    await waitFor(() => expect(screen.getByText('Ready')).toBeInTheDocument());

    fireEvent.mouseDown(cell('Ready'));
    await waitFor(() =>
      expect(cell('Ready')).toHaveAttribute('aria-selected', 'true')
    );
    fireEvent.keyDown(grid(), { key: 's' });

    // The seeded character is a jump-to, not a value the column would accept.
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('Sent'));
  });

  test('a column with no options keeps a text box', () => {
    renderTable();
    fireEvent.doubleClick(cell('Alice'));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

describe('editors for other field types', () => {
  const TYPED_COLUMNS = [
    { name: 'Age', field_id: '', field_type: '', field_key: '', hub_field_id: 'n1', hub_field_key: 'age' },
    { name: 'Born', field_id: '', field_type: '', field_key: '', hub_field_id: 'd1', hub_field_key: 'born' },
    { name: 'SSN', field_id: '', field_type: '', field_key: '', hub_field_id: 't1', hub_field_key: 'ssn' },
    { name: 'Docs', field_id: '', field_type: '', field_key: '', hub_field_id: 'f1', hub_field_key: 'docs' }
  ];
  const TYPED_FIELDS = [
    { id: 'n1', key: 'age', type: 'number', required: false, unique: false },
    { id: 'd1', key: 'born', type: 'date', required: false, unique: false },
    { id: 't1', key: 'ssn', type: 'tax_id', required: false, unique: false },
    { id: 'f1', key: 'docs', type: 'file', required: false, unique: false }
  ];
  const ENTRY = {
    id: 'e1',
    verified: true,
    data: {
      age: 42,
      born: '1982-07-19T00:00:00Z',
      ssn: '123456789',
      docs: [{ url: 'https://x/y', path: 'uploads/deed.pdf' }]
    }
  };
  const typedClient = () => ({
    getHubSchemas: jest.fn(() =>
      Promise.resolve({ hubs: [{ id: 'hub1', key: 'h', fields: TYPED_FIELDS }] })
    ),
    dataHubAction: jest.fn(({ operation }: any) =>
      operation === 'get' ? Promise.resolve([ENTRY]) : Promise.resolve({})
    )
  });
  const typedProps = {
    columns: TYPED_COLUMNS,
    data_source: 'hub',
    hub_id: 'hub1',
    hub_verification: 'all'
  };
  const renderTyped = async () => {
    renderTable(typedProps, { client: typedClient() });
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());
  };

  test('a tax ID is masked until the cell is edited', async () => {
    await renderTyped();
    // At rest only the last four digits are readable.
    expect(screen.getByText('•••••6789')).toBeInTheDocument();
    expect(screen.queryByText('123456789')).toBeNull();

    fireEvent.doubleClick(cell('•••••6789'));

    // Editing reveals the real value — the mask is display only.
    expect(await screen.findByRole('textbox')).toHaveValue('123456789');
  });

  test('a date column opens the native date picker on the date part', async () => {
    await renderTyped();
    fireEvent.doubleClick(cell('1982-07-19T00:00:00Z'));

    const input = await screen.findByLabelText(/Edit born/);
    expect(input).toHaveAttribute('type', 'date');
    expect(input).toHaveValue('1982-07-19');
  });

  // `setSelectionRange` throws InvalidStateError on a date input, and the throw
  // was inside a layout effect — which unmounted the entire table, not just
  // the cell.
  test('typing at a date cell opens the picker instead of crashing', async () => {
    await renderTyped();
    fireEvent.mouseDown(cell('1982-07-19T00:00:00Z'));
    await waitFor(() =>
      expect(cell('1982-07-19T00:00:00Z')).toHaveAttribute(
        'aria-selected',
        'true'
      )
    );

    fireEvent.keyDown(grid(), { key: '2' });

    const input = await screen.findByLabelText(/Edit born/);
    expect(input).toHaveAttribute('type', 'date');
    // Opened on the stored value, not on the character that opened it.
    expect(input).toHaveValue('1982-07-19');
    // And the grid is still standing.
    expect(grid()).toBeInTheDocument();
  });

  test('a number column refuses letters outright', async () => {
    await renderTyped();
    fireEvent.doubleClick(cell('42'));
    const input = await screen.findByLabelText(/Edit age/);

    fireEvent.change(input, { target: { value: '12x' } });
    expect(input).toHaveValue('42');

    fireEvent.change(input, { target: { value: '12.5' } });
    expect(input).toHaveValue('12.5');
  });

  // The character that opens an editor is chosen before the editor exists, so
  // it has to be filtered by the column rather than by the input.
  test('typing a letter on a number cell opens nothing', async () => {
    await renderTyped();
    fireEvent.mouseDown(cell('42'));
    await waitFor(() =>
      expect(cell('42')).toHaveAttribute('aria-selected', 'true')
    );

    fireEvent.keyDown(grid(), { key: 'a' });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByLabelText(/Edit age/)).toBeNull();
  });

  test('typing a digit on a number cell still starts the edit', async () => {
    await renderTyped();
    fireEvent.mouseDown(cell('42'));
    await waitFor(() =>
      expect(cell('42')).toHaveAttribute('aria-selected', 'true')
    );

    fireEvent.keyDown(grid(), { key: '7' });

    expect(await screen.findByLabelText(/Edit age/)).toHaveValue('7');
  });

  test('a file column shows its file names and cannot be typed into', async () => {
    await renderTyped();
    expect(screen.getByText('deed.pdf')).toBeInTheDocument();

    fireEvent.doubleClick(cell('deed.pdf'));
    const input = await screen.findByLabelText(/Edit docs/);
    expect(input).toHaveAttribute('readonly');

    fireEvent.change(input, { target: { value: 'nope' } });
    // A read-only editor records nothing, so there is still nothing to save.
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('keyboard stays on the grid', () => {
  // The grid binds its keys to the grid element itself. Closing an editor
  // unmounts the focused control, dropping focus to <body> — after which
  // arrows and Enter reached nothing at all.
  test('committing an edit hands the keyboard back', async () => {
    renderTable();
    fireEvent.mouseDown(cell('Alice'));
    await waitFor(() =>
      expect(cell('Alice')).toHaveAttribute('aria-selected', 'true')
    );

    fireEvent.keyDown(grid(), { key: 'Enter' });
    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: 'Alicia' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(grid()).toHaveFocus());
    // Enter-commit moved down to Bob; the arrows still reach the grid, so it
    // can move back.
    await waitFor(() =>
      expect(cell('Bob')).toHaveAttribute('aria-selected', 'true')
    );
    fireEvent.keyDown(grid(), { key: 'ArrowUp' });
    await waitFor(() =>
      expect(cell('Alicia')).toHaveAttribute('aria-selected', 'true')
    );
  });

  test('abandoning an edit hands it back too', async () => {
    renderTable();
    fireEvent.doubleClick(cell('Alice'));
    const input = await screen.findByRole('textbox');
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(grid()).toHaveFocus());
  });

  // Clicking Save blurs the editor, which commits. Grabbing focus back
  // unconditionally would take it off the button the user just pressed.
  test('it does not steal focus from a button that was clicked', async () => {
    renderTable();
    editCell('Alice', 'Alicia');
    const save = saveButton();
    save.focus();

    fireEvent.doubleClick(cell('bob@test.com'));
    const input = await screen.findByRole('textbox');
    fireEvent.blur(input);
    save.focus();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(save).toHaveFocus();
  });
});

describe('pasting invalid data', () => {
  const OPTION_COLUMNS = [
    { name: 'Name', field_id: '', field_type: '', field_key: '', hub_field_id: 'hf1', hub_field_key: 'name' },
    { name: 'Status', field_id: '', field_type: '', field_key: '', hub_field_id: 'hf3', hub_field_key: 'status' }
  ];
  const OPTION_FIELDS = [
    { id: 'hf1', key: 'name', type: 'text', required: false, unique: false },
    {
      id: 'hf3',
      key: 'status',
      type: 'text',
      required: false,
      unique: false,
      metadata: { options: ['Ready', 'Sent'] }
    }
  ];
  const setup = async () => {
    renderTable(
      {
        columns: OPTION_COLUMNS,
        data_source: 'hub',
        hub_id: 'hub1',
        hub_verification: 'all'
      },
      {
        client: {
          getHubSchemas: jest.fn(() =>
            Promise.resolve({
              hubs: [{ id: 'hub1', key: 'h', fields: OPTION_FIELDS }]
            })
          ),
          dataHubAction: jest.fn(({ operation }: any) =>
            operation === 'get'
              ? Promise.resolve([
                  { id: 'e1', verified: true, data: { name: 'Alice', status: 'Ready' } }
                ])
              : Promise.resolve({})
          )
        }
      }
    );
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
  };

  const pasteInto = (text: string) =>
    fireEvent.paste(grid(), { clipboardData: { getData: () => text } });

  test('a value the column rejects never lands', async () => {
    await setup();
    fireEvent.mouseDown(cell('Alice'));
    await waitFor(() =>
      expect(cell('Alice')).toHaveAttribute('aria-selected', 'true')
    );

    // Status only accepts Ready or Sent.
    pasteInto('Bob\tNonsense');

    await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument());
    // The good half landed; the bad half did not.
    expect(screen.queryByText('Nonsense')).toBeNull();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(status()).toHaveTextContent('1 value skipped');
    expect(status()).toHaveTextContent('1 unsaved change');
  });

  test('a wholly valid paste says nothing', async () => {
    await setup();
    fireEvent.mouseDown(cell('Alice'));
    await waitFor(() =>
      expect(cell('Alice')).toHaveAttribute('aria-selected', 'true')
    );

    pasteInto('Bob\tSent');

    await waitFor(() => expect(screen.getByText('Sent')).toBeInTheDocument());
    expect(status()).not.toHaveTextContent('skipped');
  });

  test('the notice goes when the buffer it described does', async () => {
    await setup();
    fireEvent.mouseDown(cell('Alice'));
    await waitFor(() =>
      expect(cell('Alice')).toHaveAttribute('aria-selected', 'true')
    );
    pasteInto('Bob\tNonsense');
    await waitFor(() => expect(status()).toHaveTextContent('skipped'));

    const confirmSpy = jest
      .spyOn(featheryWindow(), 'confirm')
      .mockReturnValue(true);
    fireEvent.click(discardButton());
    confirmSpy.mockRestore();

    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });
});

describe('keyboard editing', () => {
  test('Enter opens the editor instead of moving down', async () => {
    renderTable();
    fireEvent.mouseDown(cell('Alice'));
    await waitFor(() =>
      expect(cell('Alice')).toHaveAttribute('aria-selected', 'true')
    );

    fireEvent.keyDown(grid(), { key: 'Enter' });

    expect(await screen.findByRole('textbox')).toHaveValue('Alice');
  });

  test('Enter from inside the editor commits and moves down', async () => {
    renderTable();
    fireEvent.mouseDown(cell('Alice'));
    await waitFor(() =>
      expect(cell('Alice')).toHaveAttribute('aria-selected', 'true')
    );
    fireEvent.keyDown(grid(), { key: 'Enter' });

    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: 'Alicia' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(cell('Bob')).toHaveAttribute('aria-selected', 'true')
    );
    expect(screen.getByText('Alicia')).toBeInTheDocument();
  });

  // The seeded character used to be selected, so the next keystroke replaced
  // it and the first letter looked like it had been swallowed.
  test('type-to-edit keeps the first character', async () => {
    renderTable();
    fireEvent.mouseDown(cell('Alice'));
    await waitFor(() =>
      expect(cell('Alice')).toHaveAttribute('aria-selected', 'true')
    );

    fireEvent.keyDown(grid(), { key: 'Z' });

    const input = (await screen.findByRole('textbox')) as HTMLInputElement;
    expect(input).toHaveValue('Z');
    // Caret parked after it, with nothing selected for the next key to eat.
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(1);
  });

  test('F2 still opens on the stored value, selected for replacement', async () => {
    renderTable();
    fireEvent.mouseDown(cell('Alice'));
    await waitFor(() =>
      expect(cell('Alice')).toHaveAttribute('aria-selected', 'true')
    );

    fireEvent.keyDown(grid(), { key: 'F2' });

    const input = (await screen.findByRole('textbox')) as HTMLInputElement;
    expect(input).toHaveValue('Alice');
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(5);
  });
});

describe('leaving with unsaved work', () => {
  const beforeUnload = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event;
  };

  // The table registers with the form-wide registry the document editor uses,
  // so one prompt covers Next/Back, browser history and a full page exit.
  test('nothing is registered while everything is saved', () => {
    renderTable({}, { formId: 'form-1' });
    expect(hasUnsavedWork('form-1')).toBe(false);
    expect(beforeUnload().defaultPrevented).toBe(false);
  });

  test('an unsaved edit registers a message and arms the browser', () => {
    renderTable({}, { formId: 'form-1' });
    editCell('Alice', 'Alicia');

    expect(unsavedWorkMessage('form-1')).toContain('unsaved changes in a table');
    expect(beforeUnload().defaultPrevented).toBe(true);
  });

  test('the registration is scoped to this table\'s form', () => {
    renderTable({}, { formId: 'form-1' });
    editCell('Alice', 'Alicia');
    expect(hasUnsavedWork('form-2')).toBe(false);
  });

  test('saving releases it', async () => {
    renderTable({}, { formId: 'form-1' });
    editCell('Alice', 'Alicia');
    fireEvent.click(saveButton());

    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(hasUnsavedWork('form-1')).toBe(false);
    expect(beforeUnload().defaultPrevented).toBe(false);
  });

  test('discarding releases it', async () => {
    renderTable({}, { formId: 'form-1' });
    editCell('Alice', 'Alicia');
    discard();

    await waitFor(() => expect(hasUnsavedWork('form-1')).toBe(false));
  });

  // A table on a step the user navigates away from, or inside a repeat that is
  // removed, must stop blocking the form it is no longer part of.
  test('unmounting mid-edit releases it', () => {
    const { unmount } = renderTable({}, { formId: 'form-1' });
    editCell('Alice', 'Alicia');
    expect(hasUnsavedWork('form-1')).toBe(true);

    unmount();
    expect(hasUnsavedWork('form-1')).toBe(false);
  });
});

describe('staged Data Hub rows', () => {
  const HUB_COLUMNS = [
    {
      name: 'Name',
      field_id: '',
      field_type: '',
      field_key: '',
      hub_field_id: 'hf1',
      hub_field_key: 'name'
    },
    {
      name: 'Email',
      field_id: '',
      field_type: '',
      field_key: '',
      hub_field_id: 'hf2',
      hub_field_key: 'email'
    }
  ];

  const hubClient = (entries: any[]) => ({
    getHubSchemas: jest.fn(() =>
      Promise.resolve({ hubs: [{ id: 'hub1', key: 'h', fields: HUB_FIELDS }] })
    ),
    dataHubAction: jest.fn(({ operation }: any) =>
      operation === 'get' ? Promise.resolve(entries) : Promise.resolve({})
    )
  });

  const hubProps = {
    columns: HUB_COLUMNS,
    data_source: 'hub',
    hub_id: 'hub1',
    hub_verification: 'all'
  };

  test('a bad value on a verified row blocks the save', async () => {
    const client = hubClient([
      { id: 'e1', verified: true, data: { name: 'Alice', email: 'bad' } }
    ]);
    renderTable(hubProps, { client });

    await waitFor(() => expect(screen.getByText('bad')).toBeInTheDocument());
    expect(status()).toHaveTextContent('1 error');
    expect(saveButton()).toBeDisabled();
  });

  test('the same value on a staged row is a warning that still saves', async () => {
    const client = hubClient([
      { id: 'e1', verified: false, data: { name: 'Alice', email: 'bad' } }
    ]);
    renderTable(hubProps, { client });

    await waitFor(() => expect(screen.getByText('bad')).toBeInTheDocument());
    expect(status()).toHaveTextContent('1 warning');
    expect(status()).not.toHaveTextContent('error');

    // A staged row is not held to the hub's field rules until it is verified,
    // so the user can still write a correction that is not finished yet.
    fireEvent.doubleClick(cell('Alice'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Alicia' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(saveButton()).toBeEnabled());
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(client.dataHubAction).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'update',
          verification: 'unverified',
          data: { name: 'Alicia' }
        })
      )
    );
  });
});
