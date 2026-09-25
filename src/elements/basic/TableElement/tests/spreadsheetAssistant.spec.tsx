import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TableElement from '../index';
import AssistantClient from '../../../../assistant/AssistantClient';
import {
  SpreadsheetTable,
  SpreadsheetTableHandle
} from '../spreadsheet/SpreadsheetTable';

const TABLE = 'table1';
const NAME_KEY = 'name';
const EMAIL_KEY = 'email';

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

const makeHubElement = (propsOverride: Record<string, any> = {}) => ({
  id: TABLE,
  styles: {},
  properties: {
    columns: HUB_COLUMNS,
    data_source: 'hub',
    hub_id: 'hub1',
    actions: [],
    search: false,
    sort: false,
    pagination: 0,
    transpose: false,
    enable_editing: true,
    add_delete_rows: true,
    display_mode: 'spreadsheet',
    ...propsOverride
  }
});

const GRID_ALLOWS_ALL = {
  canEditCells: true,
  canAddRows: true,
  canDeleteRows: true
};

const mockStyles = () => ({
  addTargets: jest.fn(),
  apply: jest.fn(),
  getTarget: jest.fn(() => ({}))
});

const dataHubAction = ({ operation }: any) =>
  operation === 'get'
    ? Promise.resolve([
        { id: 'entry1', data: { name: 'Alice', email: 'alice@test.com' } },
        { id: 'entry2', data: { name: 'Bob', email: 'bob@test.com' } }
      ])
    : Promise.resolve({ updated: 1 });

// jsdom lays nothing out, so the virtualizers need a viewport to render cells
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
    if (width) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', width);
    if (height)
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', height);
  };
};

const newAssistantClient = () =>
  new AssistantClient({
    buttonOnClick: jest.fn(),
    runElementActions: jest.fn(),
    tableOnClick: jest.fn(),
    changeValue: jest.fn()
  });

const renderHubTable = async (
  propsOverride: Record<string, any> = {},
  clientOverride: Record<string, any> = {}
) => {
  const assistantClient = newAssistantClient();
  render(
    <TableElement
      element={makeHubElement(propsOverride)}
      responsiveStyles={mockStyles()}
      client={{ dataHubAction, ...clientOverride }}
      assistantClient={assistantClient}
    />
  );
  await screen.findByText('Alice');
  return assistantClient;
};

const cell = (text: string) =>
  screen.getByText(text).closest('[role="gridcell"]')!;

beforeEach(() => {
  stubLayout();
});

afterEach(() => {
  restoreLayout?.();
  sessionStorage.clear();
});

describe('assistant findings on a hub spreadsheet', () => {
  test('an entryId finding shades its cell, and the next run replaces it with a row-level one on every column', async () => {
    const assistantClient = await renderHubTable();

    let unresolved: any;
    act(() => {
      unresolved = assistantClient.setTableIssues(TABLE, [
        {
          target: {
            kind: 'cell',
            row: { entryId: 'entry2' },
            field: EMAIL_KEY
          },
          message: 'Check this email'
        }
      ]);
    });
    expect(unresolved).toEqual([]);
    await waitFor(() =>
      expect(cell('bob@test.com')).toHaveAttribute('title', 'Check this email')
    );
    expect(cell('Bob')).not.toHaveAttribute('title');
    expect(assistantClient.getTableLiveState(TABLE)).toMatchObject({
      rowCount: 2,
      findings: 1
    });

    act(() => {
      unresolved = assistantClient.setTableIssues(TABLE, [
        {
          target: { kind: 'row', row: { rowIndex: 0 } },
          message: 'Row looks wrong'
        }
      ]);
    });
    expect(unresolved).toEqual([]);
    await waitFor(() =>
      expect(cell('Alice')).toHaveAttribute('title', 'Row looks wrong')
    );
    expect(cell('alice@test.com')).toHaveAttribute('title', 'Row looks wrong');
    expect(cell('bob@test.com')).not.toHaveAttribute('title');
  });

  test('editing a marked cell clears its finding and the unsaved value shows in the live state', async () => {
    const assistantClient = await renderHubTable();
    act(() => {
      assistantClient.setTableIssues(TABLE, [
        {
          target: { kind: 'cell', row: { entryId: 'entry2' }, field: EMAIL_KEY },
          message: 'Check this email'
        },
        {
          target: { kind: 'cell', row: { entryId: 'entry1' }, field: NAME_KEY },
          message: 'Check this name'
        }
      ]);
    });
    await waitFor(() =>
      expect(cell('bob@test.com')).toHaveAttribute('title', 'Check this email')
    );

    fireEvent.doubleClick(cell('bob@test.com'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'bob@new.com' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(cell('bob@new.com')).not.toHaveAttribute('title')
    );
    expect(cell('Alice')).toHaveAttribute('title', 'Check this name');
    expect(assistantClient.getTableLiveState(TABLE)).toMatchObject({
      findings: 1,
      pendingEdits: [
        {
          rowIndex: 1,
          entryId: 'entry2',
          fieldKey: EMAIL_KEY,
          value: 'bob@new.com'
        }
      ]
    });
  });

  test('an assistant edit is parsed like typing and a read-only column is refused', async () => {
    const getHubSchemas = () =>
      Promise.resolve({
        hubs: [
          {
            id: 'hub1',
            fields: [
              { id: 'hf1', key: 'name', type: 'file' },
              { id: 'hf2', key: 'email', type: 'number' }
            ]
          }
        ]
      });
    const assistantClient = await renderHubTable({}, { getHubSchemas });
    await waitFor(() =>
      expect(assistantClient.getTableLiveState(TABLE)).toMatchObject({
        ruleErrors: { total: 2 }
      })
    );

    let outcome: any;
    act(() => {
      outcome = assistantClient.editTableCell(TABLE, 1, EMAIL_KEY, '42');
    });
    expect(outcome).toEqual({ ok: true, value: 42 });
    await waitFor(() =>
      expect(assistantClient.getTableLiveState(TABLE)).toMatchObject({
        pendingEdits: [{ rowIndex: 1, fieldKey: EMAIL_KEY, value: 42 }]
      })
    );

    expect(assistantClient.editTableCell(TABLE, 0, NAME_KEY, 'x')).toMatchObject({
      ok: false,
      errorType: 'read_only'
    });
    expect(assistantClient.editTableCell(TABLE, 0, 'nope', 'x')).toMatchObject({
      ok: false,
      errorType: 'unknown_field'
    });
  });

  test('a mounted row reads by hub field key, unsaved edits included', async () => {
    const assistantClient = await renderHubTable();
    expect(assistantClient.getTableRow(TABLE, 1)).toEqual({
      [NAME_KEY]: 'Bob',
      [EMAIL_KEY]: 'bob@test.com'
    });
    act(() => {
      assistantClient.editTableCell(TABLE, 1, EMAIL_KEY, 'bob@new.com');
    });
    await waitFor(() =>
      expect(assistantClient.getTableRow(TABLE, 1)).toEqual({
        [NAME_KEY]: 'Bob',
        [EMAIL_KEY]: 'bob@new.com'
      })
    );
    expect(assistantClient.getTableRow(TABLE, 5)).toBeNull();
  });

  test('a row waiting to be deleted is named in the live state and refuses reads and writes', async () => {
    const assistantClient = await renderHubTable();
    act(() => {
      assistantClient.deleteTableRow(TABLE, 1);
    });
    await waitFor(() => expect(screen.queryByText('Bob')).toBeNull());

    expect(assistantClient.getTableLiveState(TABLE)).toMatchObject({
      rowCount: 2,
      pendingDeletions: [{ rowIndex: 1, entryId: 'entry2' }]
    });
    expect(assistantClient.getTableRow(TABLE, 1)).toBeNull();
    expect(
      assistantClient.editTableCell(TABLE, 1, EMAIL_KEY, 'bob@new.com')
    ).toMatchObject({ ok: false, errorType: 'row_deleted' });
    expect(assistantClient.getTableRow(TABLE, 0)).toEqual({
      [NAME_KEY]: 'Alice',
      [EMAIL_KEY]: 'alice@test.com'
    });
  });

  test('an assistant row add shifts unsaved edits and a saved row keeps its finding', async () => {
    const assistantClient = await renderHubTable();
    act(() => {
      assistantClient.editTableCell(TABLE, 1, EMAIL_KEY, 'bob@new.com');
      assistantClient.setTableIssues(TABLE, [
        {
          target: { kind: 'cell', row: { rowIndex: 1 }, field: NAME_KEY },
          message: 'Check this name'
        }
      ]);
    });
    await waitFor(() =>
      expect(cell('Bob')).toHaveAttribute('title', 'Check this name')
    );

    act(() => {
      assistantClient.addTableRow(TABLE);
    });

    await waitFor(() =>
      expect(assistantClient.getTableLiveState(TABLE)).toMatchObject({
        rowCount: 3,
        findings: 1,
        pendingEdits: [
          {
            rowIndex: 2,
            entryId: 'entry2',
            fieldKey: EMAIL_KEY,
            value: 'bob@new.com'
          }
        ]
      })
    );
    expect(cell('Bob')).toHaveAttribute('title', 'Check this name');
  });

  test('a finding on a row not yet saved is dropped once rows shift', async () => {
    const assistantClient = await renderHubTable();
    act(() => {
      assistantClient.addTableRow(TABLE);
    });
    await waitFor(() =>
      expect(assistantClient.getTableLiveState(TABLE)).toMatchObject({
        rowCount: 3
      })
    );
    act(() => {
      assistantClient.setTableIssues(TABLE, [
        { target: { kind: 'row', row: { rowIndex: 0 } }, message: 'Fill me' }
      ]);
    });
    expect(assistantClient.getTableLiveState(TABLE)).toMatchObject({
      findings: 1
    });

    act(() => {
      assistantClient.addTableRow(TABLE);
    });
    await waitFor(() =>
      expect(assistantClient.getTableLiveState(TABLE)).toMatchObject({
        rowCount: 4
      })
    );
    expect(assistantClient.getTableLiveState(TABLE)).not.toHaveProperty(
      'findings'
    );
  });

  test('the grid withholds assistant writes while the hub reloads its rows', async () => {
    let reads = 0;
    let finishReload: () => void = () => {};
    const heldReload = (args: any) => {
      if (args.operation !== 'get' || reads++ === 0) return dataHubAction(args);
      return new Promise((resolve) => {
        finishReload = () => resolve(dataHubAction(args));
      });
    };
    const assistantClient = await renderHubTable(
      {},
      { dataHubAction: heldReload }
    );

    expect(assistantClient.getTableLiveState(TABLE)).toMatchObject(
      GRID_ALLOWS_ALL
    );

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    const reloading = assistantClient.getTableLiveState(TABLE);
    Object.keys(GRID_ALLOWS_ALL).forEach((capability) =>
      expect(reloading).not.toHaveProperty(capability)
    );

    await act(async () => finishReload());
    expect(assistantClient.getTableLiveState(TABLE)).toMatchObject(
      GRID_ALLOWS_ALL
    );
  });

  test('an unknown entryId is reported back and clears nothing else in the run', async () => {
    const assistantClient = await renderHubTable();

    let unresolved: any;
    act(() => {
      unresolved = assistantClient.setTableIssues(TABLE, [
        { target: { kind: 'row', row: { entryId: 'entry9' } }, message: 'Gone' },
        { target: { kind: 'row', row: { entryId: 'entry1' } }, message: 'Kept' }
      ]);
    });

    expect(unresolved).toEqual([{ index: 0, reason: 'row_not_shown' }]);
    await waitFor(() =>
      expect(cell('Alice')).toHaveAttribute('title', 'Kept')
    );
    expect(assistantClient.getTableLiveState(TABLE)).toMatchObject({
      findings: 1
    });
  });

  test('focusing a cell keeps what the user was typing in another', async () => {
    const assistantClient = await renderHubTable();
    fireEvent.doubleClick(cell('bob@test.com'));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'bob@new.com' }
    });

    act(() => {
      assistantClient.focusTableCell(TABLE, {
        entryId: 'entry1',
        fieldKey: NAME_KEY
      });
    });

    await waitFor(() =>
      expect(assistantClient.getTableLiveState(TABLE)).toMatchObject({
        pendingEdits: [
          { rowIndex: 1, fieldKey: EMAIL_KEY, value: 'bob@new.com' }
        ]
      })
    );
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  test('focusing by entryId selects the cell and the selection shows in the live state', async () => {
    const assistantClient = await renderHubTable();

    let outcome: any;
    act(() => {
      outcome = assistantClient.focusTableCell(TABLE, {
        entryId: 'entry2',
        fieldKey: NAME_KEY
      });
    });

    expect(outcome).toEqual({ ok: true, rowIndex: 1 });
    await waitFor(() =>
      expect(cell('Bob')).toHaveAttribute('aria-selected', 'true')
    );
    expect(assistantClient.getTableLiveState(TABLE)).toEqual({
      rowCount: 2,
      selection: {
        rowIndex: 1,
        entryId: 'entry2',
        fieldKey: NAME_KEY,
        columnName: 'Name',
        value: 'Bob',
        row: { [NAME_KEY]: 'Bob', [EMAIL_KEY]: 'bob@test.com' }
      },
      viewport: { visibleRowIndexes: [0, 1] },
      ...GRID_ALLOWS_ALL
    });
    expect(
      assistantClient.focusTableCell(TABLE, {
        entryId: 'entry9',
        fieldKey: NAME_KEY
      })
    ).toMatchObject({ ok: false, errorType: 'unknown_entry' });
  });

  test('a row read gives its rule errors and findings, and a row the table lacks is not a clean row', async () => {
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
    const assistantClient = await renderHubTable({}, { getHubSchemas });
    await waitFor(() =>
      expect(assistantClient.getTableLiveState(TABLE)).toMatchObject({
        ruleErrors: { total: 2 }
      })
    );
    act(() => {
      assistantClient.setTableIssues(TABLE, [
        { target: { kind: 'row', row: { entryId: 'entry2' } }, message: 'Row looks wrong' }
      ]);
    });

    const read = assistantClient.getTableIssues(TABLE, { entryId: 'entry2' });
    expect(read).toMatchObject({ ok: true, rowIndex: 1 });
    expect((read as any).cells).toEqual(
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
          fieldKey: EMAIL_KEY,
          columnName: 'email',
          severity: 'error',
          source: 'rule'
        })
      ])
    );
    // The row-level finding answers once although the rule error took one of its cells
    expect((read as any).cells).toHaveLength(2);
    expect(assistantClient.getTableIssues(TABLE, { entryId: 'entry9' })).toEqual({
      ok: false,
      reason: 'unknown_row'
    });

    act(() => {
      assistantClient.focusTableCell(TABLE, {
        entryId: 'entry1',
        fieldKey: EMAIL_KEY
      });
    });
    await waitFor(() =>
      expect(assistantClient.getTableLiveState(TABLE)).toMatchObject({
        selection: { fieldKey: EMAIL_KEY, error: expect.any(String) }
      })
    );
  });

  test('the classic table reports its row count and permissions only and has no grid to mark or focus', async () => {
    const assistantClient = await renderHubTable({ display_mode: undefined });

    await waitFor(() =>
      expect(assistantClient.getTableLiveState(TABLE)).toEqual({
        rowCount: 2,
        ...GRID_ALLOWS_ALL
      })
    );
    expect(
      assistantClient.setTableIssues(TABLE, [
        { target: { kind: 'row', row: { rowIndex: 0 } }, message: 'x' }
      ])
    ).toBeNull();
    expect(assistantClient.getTableIssues(TABLE)).toEqual({
      ok: false,
      reason: 'not_mounted'
    });
    expect(
      assistantClient.focusTableCell(TABLE, { rowIndex: 0, fieldKey: NAME_KEY })
    ).toBeNull();
  });
});

describe('what the assistant may do on a table', () => {
  test('a spreadsheet that kept a transpose setting still allows everything the grid does', async () => {
    const assistantClient = await renderHubTable({ transpose: true });

    expect(assistantClient.getTableLiveState(TABLE)).toMatchObject(
      GRID_ALLOWS_ALL
    );
  });
});

describe('assistant reads of a transposed classic table', () => {
  test('records are counted and read as rows although they render as columns', async () => {
    const threeEntries = ({ operation }: any) =>
      operation === 'get'
        ? Promise.resolve([
            { id: 'entry1', data: { name: 'Alice', email: 'alice@test.com' } },
            { id: 'entry2', data: { name: 'Bob', email: 'bob@test.com' } },
            { id: 'entry3', data: { name: 'Cara', email: 'cara@test.com' } }
          ])
        : Promise.resolve({ updated: 1 });
    const assistantClient = await renderHubTable(
      { display_mode: undefined, transpose: true },
      { dataHubAction: threeEntries }
    );

    await waitFor(() =>
      expect(assistantClient.getTableLiveState(TABLE)).toEqual({ rowCount: 3 })
    );
    expect(assistantClient.getTableRow(TABLE, 2)).toEqual({
      [NAME_KEY]: 'Cara',
      [EMAIL_KEY]: 'cara@test.com'
    });
  });
});

describe('SpreadsheetTable handle', () => {
  test('focusCell refuses a row the grid is not showing', async () => {
    const ref = React.createRef<SpreadsheetTableHandle>();
    render(
      <SpreadsheetTable
        ref={ref}
        columns={[
          { name: 'Name', field_id: 'f1', field_type: 'text', field_key: 'name' }
        ]}
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

  test('focusCell without a fieldKey selects the whole row', async () => {
    const ref = React.createRef<SpreadsheetTableHandle>();
    render(
      <SpreadsheetTable
        ref={ref}
        columns={[
          { name: 'Name', field_id: 'f1', field_type: 'text', field_key: 'name' },
          { name: 'Age', field_id: 'f2', field_type: 'text', field_key: 'age' }
        ]}
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
      expect(ref.current!.getSelection()).toEqual({ rowIndex: 1, fieldKey: 'age' })
    );
    expect(screen.getByText('Bob').closest('[aria-selected="true"]')).not.toBeNull();
    expect(screen.getByText('40').closest('[aria-selected="true"]')).not.toBeNull();
  });
});
