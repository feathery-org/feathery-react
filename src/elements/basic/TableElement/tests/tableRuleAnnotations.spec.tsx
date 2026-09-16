import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import TableElement from '../index';
import AssistantClient from '../../../../assistant/AssistantClient';
import { fieldValues } from '../../../../utils/init';
import internalState, {
  setFormInternalState
} from '../../../../utils/internalState';
import { getFormContext } from '../../../../utils/formContext';

const FORM_ID = 'form-annotations';

const COLUMNS = [
  { name: 'Name', field_id: 'f1', field_type: 'text', field_key: 'name_key' },
  { name: 'Email', field_id: 'f2', field_type: 'email', field_key: 'email_key' }
];

const mockStyles = () => ({
  addTargets: jest.fn(),
  apply: jest.fn(),
  getTarget: jest.fn(() => ({}))
});

// jsdom lays nothing out, so the grid virtualizer would see a 0x0 viewport.
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
    if (original.offsetWidth)
      Object.defineProperty(
        HTMLElement.prototype,
        'offsetWidth',
        original.offsetWidth
      );
    if (original.offsetHeight)
      Object.defineProperty(
        HTMLElement.prototype,
        'offsetHeight',
        original.offsetHeight
      );
  });
};

const renderTable = (props: Record<string, any> = {}) => {
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
      formId={FORM_ID}
      responsiveStyles={mockStyles()}
      updateFieldValues={(values: Record<string, any>) =>
        Object.assign(fieldValues, values)
      }
      submitCustom={jest.fn()}
    />
  );
  return { unmount: view.unmount };
};

/** The table as a logic rule reaches it: `feathery.tables[elementId]`. */
const ruleTable = () => (getFormContext(FORM_ID) as any).tables.table1;

const cell = (text: string) =>
  screen.getByText(text).closest('[role="gridcell"]')!;

const ERROR_SURFACE = '#fef3f2';
const WARNING_SURFACE = '#fffaeb';

beforeEach(() => {
  stubLayout();
  setFormInternalState(FORM_ID, { fields: {}, tables: {} });
  Object.assign(fieldValues, {
    name_key: ['Alice', 'Bob'],
    email_key: ['alice@x.co', 'bob@x.co']
  });
});

afterEach(() => {
  sizeSpies.forEach((restore) => restore());
  sizeSpies = [];
  delete (internalState as any)[FORM_ID];
  delete (fieldValues as any).name_key;
  delete (fieldValues as any).email_key;
});

describe('logic rule annotations', () => {
  test('a rule marks a cell by row number and column name, and it shows as an error', async () => {
    renderTable();
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    act(() => {
      expect(
        ruleTable().setAnnotations([
          {
            target: { kind: 'cell', row: { rowIndex: 1 }, field: 'Email' },
            message: 'Not a work address'
          }
        ])
      ).toEqual([]);
    });

    expect(cell('bob@x.co')).toHaveStyle({ backgroundColor: ERROR_SURFACE });
    expect(cell('bob@x.co')).toHaveAttribute('title', 'Not a work address');
    expect(cell('alice@x.co')).not.toHaveAttribute('title');
  });

  test('a rule can mark a whole row, and choose a warning instead', async () => {
    renderTable();
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    act(() => {
      ruleTable().setAnnotations([
        {
          target: { kind: 'row', row: { rowIndex: 0 } },
          message: 'Looks like a duplicate',
          severity: 'warning'
        }
      ]);
    });

    expect(cell('Alice')).toHaveStyle({ backgroundColor: WARNING_SURFACE });
    expect(cell('alice@x.co')).toHaveStyle({
      backgroundColor: WARNING_SURFACE
    });
    expect(cell('Bob')).not.toHaveAttribute('title');
  });

  test('a mark made by row number follows the row when one is inserted above it', async () => {
    renderTable();
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    act(() => {
      ruleTable().setAnnotations([
        {
          target: { kind: 'cell', row: { rowIndex: 1 }, field: 'Name' },
          message: 'Unknown name'
        }
      ]);
    });
    expect(cell('Bob')).toHaveAttribute('title', 'Unknown name');

    // Adding a row prepends it, so Bob is now row 2 — the mark goes with him.
    act(() => {
      screen.getByRole('button', { name: /add row/i }).click();
    });

    await waitFor(() =>
      expect(cell('Bob')).toHaveAttribute('title', 'Unknown name')
    );
    expect(cell('Alice')).not.toHaveAttribute('title');
  });

  test("a rule replacing its own marks leaves the assistant's standing", async () => {
    const assistantClient = new AssistantClient({
      buttonOnClick: jest.fn(),
      runElementActions: jest.fn(),
      tableOnClick: jest.fn(),
      changeValue: jest.fn()
    });
    render(
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
            add_delete_rows: true
          }
        }}
        formId={FORM_ID}
        responsiveStyles={mockStyles()}
        updateFieldValues={jest.fn()}
        submitCustom={jest.fn()}
        assistantClient={assistantClient}
      />
    );
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    act(() => {
      assistantClient.setTableAnnotations('table1', [
        {
          target: { kind: 'cell', row: { rowIndex: 0 }, field: 'Name' },
          message: 'Does not match the document'
        }
      ]);
      ruleTable().setAnnotations([
        {
          target: { kind: 'cell', row: { rowIndex: 1 }, field: 'Name' },
          message: 'Required'
        }
      ]);
    });
    expect(cell('Alice')).toHaveStyle({ backgroundColor: WARNING_SURFACE });
    expect(cell('Bob')).toHaveStyle({ backgroundColor: ERROR_SURFACE });

    act(() => {
      ruleTable().clearAnnotations();
    });
    expect(cell('Bob')).not.toHaveAttribute('title');
    expect(cell('Alice')).toHaveAttribute(
      'title',
      'Does not match the document'
    );
  });

  test('a mark on a column the table does not have comes back unplaced', async () => {
    renderTable();
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    let unresolved: any[] = [];
    act(() => {
      unresolved = ruleTable().setAnnotations([
        {
          target: { kind: 'cell', row: { rowIndex: 0 }, field: 'Nope' },
          message: 'No such column'
        }
      ]);
    });
    expect(unresolved).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('a rule can read the rows, each carrying the key to point marks at', async () => {
    renderTable();
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    const rows = ruleTable().rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ Name: 'Alice', Email: 'alice@x.co' });
    expect(typeof rows[0]._key).toBe('string');
    expect(rows[0]._key).not.toEqual(rows[1]._key);

    act(() => {
      ruleTable().setAnnotations([
        {
          target: { kind: 'cell', row: { rowKey: rows[1]._key }, field: 'Name' },
          message: 'By key'
        }
      ]);
    });
    expect(cell('Bob')).toHaveAttribute('title', 'By key');
  });

  test('a table that unmounts is no longer reachable', async () => {
    const { unmount } = renderTable();
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    expect(ruleTable()).toBeDefined();

    unmount();
    expect((getFormContext(FORM_ID) as any).tables.table1).toBeUndefined();
  });
});
