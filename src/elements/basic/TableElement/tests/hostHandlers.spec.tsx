import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import TableElement from '../index';
import internalState from '../../../../utils/internalState';
import { fieldValues } from '../../../../utils/init';
import type { TableHandlers } from '../../../../utils/formActions/tables';

const FORM = 'host-handlers-form';
const TABLE = 'table1';

const FIELD_COLUMNS = [
  { name: 'Name', field_id: 'f1', field_type: 'text', field_key: 'name_key' },
  {
    name: 'Age',
    field_id: 'f2',
    field_type: 'integer_field',
    field_key: 'age_key'
  }
];

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

const mockStyles = () => ({
  addTargets: jest.fn(),
  apply: jest.fn(),
  getTarget: jest.fn(() => ({}))
});

const makeElement = (propsOverride: Record<string, any> = {}) => ({
  id: TABLE,
  styles: {},
  properties: {
    columns: FIELD_COLUMNS,
    actions: [],
    search: false,
    sort: false,
    pagination: 0,
    transpose: false,
    enable_editing: true,
    add_delete_rows: true,
    ...propsOverride
  }
});

const dataHubAction = ({ operation }: any) =>
  operation === 'get'
    ? Promise.resolve([
        { id: 'entry1', data: { name: 'Alice', email: 'alice@test.com' } },
        { id: 'entry2', data: { name: 'Bob', email: 'bob@test.com' } }
      ])
    : Promise.resolve({ updated: 1 });

// jsdom lays nothing out, so the spreadsheet's virtualizers need a viewport to render cells
let restoreLayout: (() => void) | undefined;
const stubLayout = () => {
  const width = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'offsetWidth'
  );
  const height = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'offsetHeight'
  );
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 900
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 600
  });
  restoreLayout = () => {
    if (width)
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', width);
    if (height)
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', height);
  };
};

const handlers = (): TableHandlers =>
  (internalState as any)[FORM].tables.get(TABLE);

beforeEach(() => {
  (internalState as any)[FORM] = {};
});

afterEach(() => {
  delete (internalState as any)[FORM];
  delete (fieldValues as any).name_key;
  delete (fieldValues as any).age_key;
  sessionStorage.clear();
});

describe('a field-backed classic table', () => {
  const renderTable = (propsOverride: Record<string, any> = {}) => {
    Object.assign(fieldValues, {
      name_key: ['Alice', 'Bob'],
      age_key: [30, 40]
    });
    const updateFieldValues = jest.fn((updates: Record<string, unknown>) =>
      Object.assign(fieldValues, updates)
    );
    const onClick = jest.fn();
    render(
      <TableElement
        element={makeElement(propsOverride)}
        formId={FORM}
        responsiveStyles={mockStyles()}
        updateFieldValues={updateFieldValues}
        submitCustom={jest.fn()}
        onClick={onClick}
      />
    );
    return { updateFieldValues, onClick };
  };

  it('publishes what the grid allows and the rows the person sees', () => {
    renderTable({ actions: [{ label: 'Send' }] });

    expect(handlers().getLiveState()).toEqual({
      columns: [
        { name: 'Name', fieldKey: 'name_key' },
        { name: 'Age', fieldKey: 'age_key' }
      ],
      rowCount: 2,
      canEditCells: true,
      canAddRows: true,
      canDeleteRows: true,
      showsActions: true,
      allowsRowClick: false,
      buffersEdits: false
    });
    expect(handlers().getRows({ offset: 0, limit: 10, search: 'bob' })).toEqual(
      {
        rowCount: 1,
        rows: [{ rowIndex: 1, values: { name_key: 'Bob', age_key: 40 } }]
      }
    );
  });

  it('writes a batch through the person’s edit path, parsing each cell like typing', () => {
    const { updateFieldValues } = renderTable();

    let outcomes: any;
    act(() => {
      outcomes = handlers().editCells([
        { rowIndex: 0, fieldKey: 'age_key', value: '35' },
        { rowIndex: 1, fieldKey: 'name_key', value: null },
        { rowIndex: 1, fieldKey: 'nope', value: 'x' }
      ]);
    });

    expect(outcomes).toEqual([
      { ok: true, value: 35 },
      { ok: true, value: null },
      {
        ok: false,
        reason: 'unknown_column',
        message: expect.stringContaining('nope')
      }
    ]);
    expect(updateFieldValues).toHaveBeenCalledTimes(1);
    expect(updateFieldValues).toHaveBeenCalledWith({
      age_key: [35, 40],
      name_key: ['Alice', null]
    });
  });

  it('adds a row at the top, where the classic add-row button puts one', () => {
    const { updateFieldValues } = renderTable();

    let addedAt: number | undefined;
    act(() => {
      addedAt = handlers().addRow();
    });

    expect(addedAt).toBe(0);
    expect(updateFieldValues).toHaveBeenCalledWith({
      name_key: ['', 'Alice', 'Bob'],
      age_key: ['', 30, 40]
    });
  });

  it('allows a bare row click only on a table the person cannot edit', () => {
    const { onClick } = renderTable({ enable_editing: false });

    expect(handlers().getLiveState()).toMatchObject({
      canEditCells: false,
      allowsRowClick: true
    });
    return handlers()
      .runAction(1)
      .then(() =>
        expect(onClick).toHaveBeenCalledWith({
          rowIndex: 1,
          rowData: { Name: 'Bob', Age: 40 }
        })
      );
  });

  it('sends a named action with the row keyed by column name', async () => {
    const { onClick } = renderTable({ actions: [{ label: 'Send' }] });

    await handlers().runAction(0, 'Send');

    expect(onClick).toHaveBeenCalledWith({
      action: 'Send',
      rowIndex: 0,
      rowData: { Name: 'Alice', Age: 30 }
    });
  });

  it('registers nothing in the builder and unregisters on unmount', () => {
    const { unmount } = render(
      <TableElement
        element={makeElement()}
        formId={FORM}
        responsiveStyles={mockStyles()}
        editMode
      />
    );
    expect((internalState as any)[FORM].tables).toBeUndefined();
    unmount();

    const live = render(
      <TableElement
        element={makeElement()}
        formId={FORM}
        responsiveStyles={mockStyles()}
      />
    );
    expect(handlers()).toBeDefined();
    live.unmount();
    expect((internalState as any)[FORM].tables.get(TABLE)).toBeUndefined();
  });
});

describe('a hub spreadsheet table', () => {
  const renderHubTable = async (
    propsOverride: Record<string, any> = {},
    clientOverride: Record<string, any> = {}
  ) => {
    render(
      <TableElement
        element={makeElement({
          columns: HUB_COLUMNS,
          data_source: 'hub',
          hub_id: 'hub1',
          display_mode: 'spreadsheet',
          ...propsOverride
        })}
        formId={FORM}
        responsiveStyles={mockStyles()}
        client={{ dataHubAction, ...clientOverride }}
      />
    );
    await screen.findByText('Alice');
  };

  beforeEach(() => {
    stubLayout();
  });

  afterEach(() => {
    restoreLayout?.();
  });

  it('names rows by entry id and columns by hub field key, with the hub in the live state', async () => {
    await renderHubTable();

    expect(handlers().getLiveState()).toMatchObject({
      hubId: 'hub1',
      columns: [
        { name: 'Name', fieldKey: 'name' },
        { name: 'Email', fieldKey: 'email' }
      ],
      rowCount: 2,
      canEditCells: true,
      showsActions: false,
      allowsRowClick: false,
      buffersEdits: true,
      entryIds: ['entry1', 'entry2']
    });
    expect(handlers().getRow(1)).toEqual({
      name: 'Bob',
      email: 'bob@test.com'
    });
  });

  it('holds a write in the save bar, overlays it on reads, and refuses a read-only column', async () => {
    await renderHubTable({ readonly_hub_fields: ['hf1'] });

    let outcomes: any;
    act(() => {
      outcomes = handlers().editCells([
        { rowIndex: 1, fieldKey: 'email', value: 'bob@new.com' },
        { rowIndex: 0, fieldKey: 'name', value: 'Al' }
      ]);
    });

    expect(outcomes).toEqual([
      { ok: true, value: 'bob@new.com' },
      {
        ok: false,
        reason: 'read_only',
        message: expect.stringContaining('name')
      }
    ]);
    await waitFor(() =>
      expect(handlers().getLiveState()).toMatchObject({
        columns: [
          { name: 'Name', fieldKey: 'name', readOnly: true },
          { name: 'Email', fieldKey: 'email' }
        ],
        pending: { edits: 1, deletions: 0 }
      })
    );
    expect(handlers().getRows({ offset: 0, limit: 10 })).toEqual({
      rowCount: 2,
      rows: [
        {
          rowIndex: 0,
          entryId: 'entry1',
          values: { name: 'Alice', email: 'alice@test.com' }
        },
        {
          rowIndex: 1,
          entryId: 'entry2',
          values: { name: 'Bob', email: 'bob@new.com' },
          pending: true
        }
      ]
    });
  });

  it('parses a typed hub column the way the grid does', async () => {
    const getHubSchemas = () =>
      Promise.resolve({
        hubs: [
          {
            id: 'hub1',
            fields: [
              { id: 'hf1', key: 'name', type: 'text' },
              { id: 'hf2', key: 'email', type: 'number' }
            ]
          }
        ]
      });
    await renderHubTable({}, { getHubSchemas });
    await waitFor(() =>
      expect(handlers().getLiveState().columns[1]).not.toHaveProperty(
        'readOnly'
      )
    );

    let outcomes: any;
    act(() => {
      outcomes = handlers().editCells([
        { rowIndex: 1, fieldKey: 'email', value: '42' }
      ]);
    });

    expect(outcomes).toEqual([{ ok: true, value: 42 }]);
  });

  it('keeps a deleted row out of reads and writes until the save, and appends a fresh row', async () => {
    await renderHubTable();

    act(() => {
      handlers().deleteRow(1);
    });
    await waitFor(() => expect(screen.queryByText('Bob')).toBeNull());

    expect(handlers().getLiveState()).toMatchObject({
      rowCount: 2,
      pending: { edits: 0, deletions: 1 }
    });
    expect(handlers().getRow(1)).toBeNull();
    expect(
      handlers().editCells([{ rowIndex: 1, fieldKey: 'email', value: 'x' }])
    ).toEqual([
      { ok: false, reason: 'row_deleted', message: expect.any(String) }
    ]);
    expect(handlers().getRows({ offset: 0, limit: 10 }).rows).toHaveLength(1);

    let addedAt: number | undefined;
    act(() => {
      addedAt = handlers().addRow();
    });
    expect(addedAt).toBe(2);
    await waitFor(() =>
      expect(handlers().getLiveState()).toMatchObject({
        rowCount: 3,
        entryIds: ['entry1', 'entry2', null]
      })
    );
  });
});
