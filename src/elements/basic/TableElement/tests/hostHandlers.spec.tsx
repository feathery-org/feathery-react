import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react';
import TableElement from '../index';
import internalState from '../../../../utils/internalState';
import { fieldValues } from '../../../../utils/init';
import type { TableHandlers } from '../../../../utils/formActions/tables';
import {
  SpreadsheetTable,
  SpreadsheetTableHandle
} from '../spreadsheet/SpreadsheetTable';

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

const cell = (text: string) =>
  screen.getByText(text).closest('[role="gridcell"]')!;

beforeEach(() => {
  (internalState as any)[FORM] = {};
});

afterEach(() => {
  delete (internalState as any)[FORM];
  ['name_key', 'age_key', 'active_key', 'status_key', 'doc_key'].forEach(
    (key) => delete (fieldValues as any)[key]
  );
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
      buffersEdits: false,
      showsGrid: false
    });
    expect(handlers().getRows({ offset: 0, limit: 10, search: 'bob' })).toEqual(
      {
        rowCount: 1,
        rows: [{ rowIndex: 1, values: { name_key: 'Bob', age_key: 40 } }]
      }
    );
  });

  it('reads rows in the order the person sorted them, keeping each source index', () => {
    renderTable({ sort: true });
    fireEvent.click(screen.getByText('Name'));
    fireEvent.click(screen.getByText('Name'));

    expect(handlers().getRows({ offset: 0, limit: 10 })).toEqual({
      rowCount: 2,
      rows: [
        { rowIndex: 1, values: { name_key: 'Bob', age_key: 40 } },
        { rowIndex: 0, values: { name_key: 'Alice', age_key: 30 } }
      ]
    });
  });

  it('keeps rows the person searched away readable by their source index', () => {
    renderTable({ search: true });
    fireEvent.change(screen.getByPlaceholderText('Search'), {
      target: { value: 'Alice' }
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

  it('marks a cell by its row, replaces the set on the next call, and clears a finding when its cell is edited', async () => {
    await renderHubTable();

    let outcomes: any;
    act(() => {
      outcomes = handlers().setFindings([
        { rowIndex: 1, fieldKey: 'email', message: 'Check this email' }
      ]);
    });
    expect(outcomes).toEqual([]);
    await waitFor(() =>
      expect(cell('bob@test.com')).toHaveAttribute('title', 'Check this email')
    );
    expect(cell('Bob')).not.toHaveAttribute('title');
    expect(handlers().getLiveState()).toMatchObject({
      showsGrid: true,
      findings: 1
    });

    act(() => {
      handlers().setFindings([{ rowIndex: 0, message: 'Row looks wrong' }]);
    });
    await waitFor(() =>
      expect(cell('Alice')).toHaveAttribute('title', 'Row looks wrong')
    );
    expect(cell('alice@test.com')).toHaveAttribute('title', 'Row looks wrong');
    expect(cell('bob@test.com')).not.toHaveAttribute('title');

    act(() => {
      handlers().setFindings([
        { rowIndex: 1, fieldKey: 'email', message: 'Check this email' },
        { rowIndex: 0, fieldKey: 'name', message: 'Check this name' }
      ]);
    });
    act(() => {
      handlers().editCells([
        { rowIndex: 1, fieldKey: 'email', value: 'bob@new.com' }
      ]);
    });
    await waitFor(() =>
      expect(cell('bob@new.com')).not.toHaveAttribute('title')
    );
    expect(cell('Alice')).toHaveAttribute('title', 'Check this name');
    expect(handlers().getLiveState()).toMatchObject({
      findings: 1,
      pending: { edits: 1, deletions: 0 }
    });
  });

  it('clears a row finding when any cell in its row is edited, and keeps findings elsewhere', async () => {
    await renderHubTable();

    act(() => {
      handlers().setFindings([
        { rowIndex: 1, message: 'Duplicate of row 1' },
        { rowIndex: 0, fieldKey: 'email', message: 'Check this email' }
      ]);
    });
    await waitFor(() =>
      expect(cell('Bob')).toHaveAttribute('title', 'Duplicate of row 1')
    );

    act(() => {
      handlers().editCells([
        { rowIndex: 1, fieldKey: 'name', value: 'Robert' }
      ]);
    });
    await waitFor(() =>
      expect(cell('bob@test.com')).not.toHaveAttribute('title')
    );
    expect(cell('Robert')).not.toHaveAttribute('title');
    expect(cell('alice@test.com')).toHaveAttribute('title', 'Check this email');
    expect(handlers().getLiveState()).toMatchObject({ findings: 1 });
  });

  it('rejects a finding on a row the grid is not showing or an unknown column, and keeps the rest', async () => {
    await renderHubTable();
    act(() => {
      handlers().deleteRow(1);
    });
    await waitFor(() => expect(screen.queryByText('Bob')).toBeNull());

    let outcomes: any;
    act(() => {
      outcomes = handlers().setFindings([
        { rowIndex: 1, message: 'Gone' },
        { rowIndex: 0, fieldKey: 'phone', message: 'No column' },
        { rowIndex: 0, message: 'Kept' }
      ]);
    });

    expect(outcomes).toEqual([
      { index: 0, reason: 'row_hidden', message: expect.stringContaining('1') },
      {
        index: 1,
        reason: 'unknown_column',
        message: expect.stringContaining('phone')
      }
    ]);
    await waitFor(() => expect(cell('Alice')).toHaveAttribute('title', 'Kept'));
    expect(handlers().getLiveState()).toMatchObject({ findings: 1 });
  });

  it('drops a finding on an unsaved row once rows shift, and keeps one on a saved row', async () => {
    await renderHubTable();
    act(() => {
      handlers().addRow();
    });
    await waitFor(() =>
      expect(handlers().getLiveState()).toMatchObject({ rowCount: 3 })
    );
    act(() => {
      handlers().setFindings([
        { rowIndex: 2, fieldKey: 'name', message: 'Fill in' },
        { rowIndex: 0, fieldKey: 'name', message: 'Saved' }
      ]);
    });
    await waitFor(() =>
      expect(handlers().getLiveState()).toMatchObject({ findings: 2 })
    );

    act(() => {
      handlers().deleteRow(1);
    });

    await waitFor(() =>
      expect(handlers().getLiveState()).toMatchObject({ findings: 1 })
    );
    expect(cell('Alice')).toHaveAttribute('title', 'Saved');
  });

  it('focuses a cell after committing an open draft, shows the selection and viewport, and refuses what it cannot show', async () => {
    await renderHubTable();
    fireEvent.doubleClick(cell('bob@test.com'));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'bob@new.com' }
    });

    let outcome: any;
    act(() => {
      outcome = handlers().focusCell(0, 'name');
    });

    expect(outcome).toEqual({ ok: true });
    await waitFor(() =>
      expect(cell('Alice')).toHaveAttribute('aria-selected', 'true')
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(handlers().getLiveState()).toMatchObject({
      pending: { edits: 1, deletions: 0 },
      selection: {
        rowIndex: 0,
        entryId: 'entry1',
        fieldKey: 'name',
        columnName: 'Name',
        value: 'Alice',
        row: { name: 'Alice', email: 'alice@test.com' }
      },
      viewport: { visibleRowIndexes: [0, 1] }
    });
    expect(handlers().focusCell(0, 'phone')).toMatchObject({
      ok: false,
      reason: 'unknown_column'
    });

    act(() => {
      handlers().deleteRow(1);
    });
    await waitFor(() => expect(screen.queryByText('Bob')).toBeNull());
    expect(handlers().focusCell(1, 'name')).toMatchObject({
      ok: false,
      reason: 'row_hidden'
    });
  });

  it('reads a row’s rule errors and findings, a row-level finding answered once', async () => {
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
      expect(handlers().getLiveState()).toMatchObject({
        ruleErrors: { total: 2 }
      })
    );
    act(() => {
      handlers().setFindings([{ rowIndex: 1, message: 'Row looks wrong' }]);
    });

    const issues = handlers().getIssues(1);
    expect(issues).toEqual(
      expect.arrayContaining([
        {
          rowIndex: 1,
          entryId: 'entry2',
          message: 'Row looks wrong',
          severity: 'warning',
          source: 'assistant'
        },
        expect.objectContaining({
          rowIndex: 1,
          entryId: 'entry2',
          fieldKey: 'email',
          columnName: 'email',
          severity: 'error',
          source: 'rule'
        })
      ])
    );
    expect(issues).toHaveLength(2);
    expect(handlers().getIssues()).toHaveLength(3);

    act(() => {
      handlers().focusCell(0, 'email');
    });
    await waitFor(() =>
      expect(handlers().getLiveState()).toMatchObject({
        selection: { fieldKey: 'email', error: expect.any(String) }
      })
    );
  });

  it('shows no grid on a classic display, so nothing to select or scroll', async () => {
    await renderHubTable({ display_mode: undefined });

    await waitFor(() =>
      expect(handlers().getLiveState()).toMatchObject({
        rowCount: 2,
        showsGrid: false
      })
    );
    const live = handlers().getLiveState();
    expect(live).not.toHaveProperty('viewport');
    expect(live).not.toHaveProperty('selection');
  });
});

describe('the spreadsheet handle', () => {
  const gridColumns = [
    { name: 'Name', field_id: 'f1', field_type: 'text', field_key: 'name' },
    { name: 'Age', field_id: 'f2', field_type: 'text', field_key: 'age' }
  ];

  beforeEach(() => {
    stubLayout();
  });

  afterEach(() => {
    restoreLayout?.();
  });

  it('refuses a row the grid is not showing and reports the rows it is', async () => {
    const ref = React.createRef<SpreadsheetTableHandle>();
    render(
      <SpreadsheetTable
        ref={ref}
        columns={gridColumns.slice(0, 1)}
        rowIndices={[0, 2]}
        fieldValues={{ name: ['Alice', 'Bob', 'Cara'] }}
        canEdit
        onCellsEdit={jest.fn()}
      />
    );
    await screen.findByText('Cara');

    expect(ref.current!.getSelection()).toBeNull();
    let focused: boolean | undefined;
    act(() => {
      focused = ref.current!.focusCell(1, 'name');
    });
    expect(focused).toBe(false);
    act(() => {
      focused = ref.current!.focusCell(2, 'name');
    });
    expect(focused).toBe(true);
    await waitFor(() =>
      expect(ref.current!.getSelection()).toEqual({
        rowIndex: 2,
        fieldKey: 'name'
      })
    );
    expect(ref.current!.getVisibleRowIndexes()).toEqual([0, 2]);
  });

  it('selects the whole row when no column is named', async () => {
    const ref = React.createRef<SpreadsheetTableHandle>();
    render(
      <SpreadsheetTable
        ref={ref}
        columns={gridColumns}
        rowIndices={[0, 1]}
        fieldValues={{ name: ['Alice', 'Bob'], age: ['30', '40'] }}
        canEdit
        onCellsEdit={jest.fn()}
      />
    );
    await screen.findByText('Bob');

    act(() => {
      ref.current!.focusCell(1);
    });
    await waitFor(() =>
      expect(ref.current!.getSelection()).toEqual({
        rowIndex: 1,
        fieldKey: 'name',
        extended: true
      })
    );
    expect(
      screen.getByText('Bob').closest('[aria-selected="true"]')
    ).not.toBeNull();
    expect(
      screen.getByText('40').closest('[aria-selected="true"]')
    ).not.toBeNull();
  });

  it('refuses a row a column filter hides and keeps the filter', async () => {
    const ref = React.createRef<SpreadsheetTableHandle>();
    render(
      <SpreadsheetTable
        ref={ref}
        columns={gridColumns.slice(0, 1)}
        rowIndices={[0, 1]}
        fieldValues={{ name: ['Alice', 'Bob'] }}
        canEdit
        onCellsEdit={jest.fn()}
      />
    );
    await screen.findByText('Bob');
    fireEvent.contextMenu(screen.getByRole('columnheader', { name: /^Name/ }), {
      clientX: 10,
      clientY: 10
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Filter…' }));
    const dialog = screen.getByRole('dialog', { name: 'Filter column Name' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Bob' }));
    const cellTexts = () =>
      screen.getAllByRole('gridcell').map((gridCell) => gridCell.textContent);
    expect(cellTexts()).not.toContain('Bob');

    let focused: boolean | undefined;
    act(() => {
      focused = ref.current!.focusCell(1, 'name');
    });
    expect(focused).toBe(false);
    expect(cellTexts()).not.toContain('Bob');
    expect(ref.current!.getSelection()).toBeNull();
  });
});

describe('a field-backed table with the form’s own column rules', () => {
  // A column names only its field; the field's type comes from the form.
  const RULED_COLUMNS = [
    { name: 'Age', field_id: 'f2', field_type: 'servar', field_key: 'age_key' },
    {
      name: 'Active',
      field_id: 'f3',
      field_type: 'servar',
      field_key: 'active_key'
    },
    {
      name: 'Status',
      field_id: 'f4',
      field_type: 'servar',
      field_key: 'status_key'
    },
    { name: 'Doc', field_id: 'f5', field_type: 'servar', field_key: 'doc_key' }
  ];
  const servar = (key: string, type: string, metadata = {}) => ({
    servar: { key, type, metadata }
  });
  const renderTable = (propsOverride: Record<string, any> = {}) => {
    const updateFieldValues = jest.fn((updates: Record<string, unknown>) =>
      Object.assign(fieldValues, updates)
    );
    render(
      <TableElement
        element={makeElement(propsOverride)}
        formId={FORM}
        responsiveStyles={mockStyles()}
        updateFieldValues={updateFieldValues}
        submitCustom={jest.fn()}
      />
    );
    return { updateFieldValues };
  };

  beforeEach(() => {
    (internalState as any)[FORM] = {
      steps: {
        step1: {
          servar_fields: [
            servar('age_key', 'integer_field'),
            servar('active_key', 'checkbox'),
            servar('status_key', 'dropdown', { options: ['open', 'closed'] }),
            servar('doc_key', 'file_upload')
          ]
        }
      }
    };
    Object.assign(fieldValues, {
      age_key: [30],
      active_key: [false],
      status_key: ['open'],
      doc_key: [[]]
    });
  });

  it('types each write by its column and refuses what the rule refuses', () => {
    const { updateFieldValues } = renderTable({ columns: RULED_COLUMNS });

    let outcomes: any;
    act(() => {
      outcomes = handlers().editCells([
        { rowIndex: 0, fieldKey: 'age_key', value: '35' },
        { rowIndex: 0, fieldKey: 'active_key', value: 'true' },
        { rowIndex: 0, fieldKey: 'status_key', value: 'closed' },
        { rowIndex: 0, fieldKey: 'age_key', value: 'abc' },
        { rowIndex: 0, fieldKey: 'active_key', value: 'yes' },
        { rowIndex: 0, fieldKey: 'status_key', value: 'Closed' },
        { rowIndex: 0, fieldKey: 'doc_key', value: 'x' }
      ]);
    });

    expect(outcomes).toEqual([
      { ok: true, value: 35 },
      { ok: true, value: true },
      { ok: true, value: 'closed' },
      {
        ok: false,
        reason: 'invalid_value',
        message: expect.stringContaining('Must be a number')
      },
      {
        ok: false,
        reason: 'invalid_value',
        message: expect.stringContaining('Must be true or false')
      },
      {
        ok: false,
        reason: 'invalid_value',
        message: expect.stringContaining('Must be open or closed')
      },
      { ok: false, reason: 'read_only', message: expect.any(String) }
    ]);
    // Only the accepted cells reach the field values.
    expect(updateFieldValues).toHaveBeenCalledWith({
      age_key: [35],
      active_key: [true],
      status_key: ['closed']
    });
  });

  it('a blank is a clear on any column, and the file column reads as read-only', () => {
    renderTable({ columns: RULED_COLUMNS });

    let outcomes: any;
    act(() => {
      outcomes = handlers().editCells([
        { rowIndex: 0, fieldKey: 'age_key', value: '' }
      ]);
    });
    expect(outcomes).toEqual([{ ok: true, value: null }]);

    expect(handlers().getLiveState().columns).toEqual([
      { name: 'Age', fieldKey: 'age_key' },
      { name: 'Active', fieldKey: 'active_key' },
      { name: 'Status', fieldKey: 'status_key' },
      { name: 'Doc', fieldKey: 'doc_key', readOnly: true }
    ]);
  });
});
