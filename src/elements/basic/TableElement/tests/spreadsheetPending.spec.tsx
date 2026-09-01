import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TableElement from '../index';
import { fieldValues } from '../../../../utils/init';
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

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(updateFieldValues).not.toHaveBeenCalled();
  });

  test('a discarded row deletion comes back', async () => {
    renderTable();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Select row 2' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete row 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument());
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
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

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
