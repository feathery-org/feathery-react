import { act, renderHook, waitFor } from '@testing-library/react';
import { fieldValues } from '../../../../utils/init';
import { useHubTableSource } from '../useHubTableSource';
import type { HubVerification } from '../useHubTableSource';
import { useTableMutations } from '../useTableMutations';
import { useSpreadsheetHistory } from '../spreadsheet/useSpreadsheetHistory';
import type { CellWrite } from '../types';

const COLUMNS = [
  { name: 'Name', field_id: 'f1', field_type: 'text', field_key: 'name_key' },
  { name: 'Age', field_id: 'f2', field_type: 'text', field_key: 'age_key' }
];

describe('field-source batched writes', () => {
  const setup = () => {
    Object.assign(fieldValues, {
      name_key: ['Alice', 'Bob', 'Cara'],
      age_key: ['30', '40', '50']
    });
    const updateFieldValues = jest.fn();
    const submitCustom = jest.fn();
    const result = renderHook(() =>
      useTableMutations({
        columns: COLUMNS,
        updateFieldValues,
        submitCustom,
        editMode: false,
        editModeFieldValues: {},
        enablePagination: false,
        setCurrentPage: jest.fn(),
        setSearchQuery: jest.fn(),
        searchQuery: '',
        onMutate: jest.fn()
      })
    );
    return { result, updateFieldValues, submitCustom };
  };

  afterEach(() => {
    delete (fieldValues as any).name_key;
    delete (fieldValues as any).age_key;
  });

  test('a multi-cell edit submits ONCE, not once per cell', () => {
    const { result, updateFieldValues, submitCustom } = setup();

    act(() =>
      result.result.current.handleCellsEdit([
        { fieldKey: 'name_key', rowIndex: 0, value: 'X' },
        { fieldKey: 'name_key', rowIndex: 2, value: 'Z' },
        { fieldKey: 'age_key', rowIndex: 1, value: 99 }
      ])
    );

    expect(updateFieldValues).toHaveBeenCalledTimes(1);
    expect(submitCustom).toHaveBeenCalledTimes(1);
  });

  test('several cells in one column land in the same array', () => {
    const { result, updateFieldValues } = setup();

    act(() =>
      result.result.current.handleCellsEdit([
        { fieldKey: 'name_key', rowIndex: 0, value: 'X' },
        { fieldKey: 'name_key', rowIndex: 2, value: 'Z' }
      ])
    );

    // Writing each cell separately would rebuild the column from fieldValues
    // twice, and the second write would drop the first.
    expect(updateFieldValues).toHaveBeenCalledWith({
      name_key: ['X', 'Bob', 'Z']
    });
  });

  test('untouched columns are left out of the submission', () => {
    const { result, updateFieldValues } = setup();

    act(() =>
      result.result.current.handleCellsEdit([
        { fieldKey: 'age_key', rowIndex: 1, value: 99 }
      ])
    );

    expect(updateFieldValues).toHaveBeenCalledWith({
      age_key: ['30', 99, '50']
    });
  });

  test('an empty batch does nothing', () => {
    const { result, updateFieldValues, submitCustom } = setup();
    act(() => result.result.current.handleCellsEdit([]));
    expect(updateFieldValues).not.toHaveBeenCalled();
    expect(submitCustom).not.toHaveBeenCalled();
  });
});

describe('Data Hub batched writes', () => {
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

  const element = {
    id: 'table1',
    properties: { columns: HUB_COLUMNS, hub_id: 'hub1' }
  };

  const twoEntries = [
    { id: 'entry1', data: { name: 'Alice', email: 'alice@test.com' } },
    { id: 'entry2', data: { name: 'Bob', email: 'bob@test.com' } }
  ];

  // `client` and `element` must keep their identity across re-renders: the
  // hook's loader is memoized on them, and a fresh object each render would
  // re-fetch forever. TableElement passes stable props for the same reason.
  const setup = (dataHubAction: jest.Mock) => {
    const client = { dataHubAction } as any;
    return renderHook(() =>
      useHubTableSource({ element, client, enabled: true })
    );
  };

  // Synthetic field keys are namespaced per table, so build them the same way
  // the hook does rather than hard-coding the format.
  const key = (hubFieldKey: string) => `__hub_table1_${hubFieldKey}`;

  test('a block edit costs one request per ROW, not per cell', async () => {
    const dataHubAction = jest.fn(({ operation }) =>
      operation === 'get'
        ? Promise.resolve(twoEntries)
        : Promise.resolve({ updated: 1 })
    );
    const { result } = setup(dataHubAction);
    await waitFor(() => expect(result.current.entryIds).toHaveLength(2));
    dataHubAction.mockClear();

    // Four cells spanning two rows and two columns.
    const writes: CellWrite[] = [
      { fieldKey: key('name'), rowIndex: 0, value: 'A1' },
      { fieldKey: key('email'), rowIndex: 0, value: 'a1@test.com' },
      { fieldKey: key('name'), rowIndex: 1, value: 'B1' },
      { fieldKey: key('email'), rowIndex: 1, value: 'b1@test.com' }
    ];
    act(() => result.current.handleCellsEdit(writes));

    await waitFor(() => expect(dataHubAction).toHaveBeenCalledTimes(2));
    expect(dataHubAction).toHaveBeenCalledWith({
      hubId: 'hub1',
      operation: 'update',
      where: [{ entryId: 'entry1' }],
      data: { name: 'A1', email: 'a1@test.com' }
    });
    expect(dataHubAction).toHaveBeenCalledWith({
      hubId: 'hub1',
      operation: 'update',
      where: [{ entryId: 'entry2' }],
      data: { name: 'B1', email: 'b1@test.com' }
    });
  });

  test('only the changed fields of a row are sent', async () => {
    const dataHubAction = jest.fn(({ operation }) =>
      operation === 'get'
        ? Promise.resolve(twoEntries)
        : Promise.resolve({ updated: 1 })
    );
    const { result } = setup(dataHubAction);
    await waitFor(() => expect(result.current.entryIds).toHaveLength(2));
    dataHubAction.mockClear();

    act(() =>
      result.current.handleCellsEdit([
        { fieldKey: key('email'), rowIndex: 0, value: 'new@test.com' }
      ])
    );

    await waitFor(() => expect(dataHubAction).toHaveBeenCalledTimes(1));
    expect(dataHubAction).toHaveBeenCalledWith({
      hubId: 'hub1',
      operation: 'update',
      where: [{ entryId: 'entry1' }],
      data: { email: 'new@test.com' }
    });
  });

  test('a rejected batch rolls the row back and shades its cells', async () => {
    const dataHubAction = jest.fn(({ operation }) =>
      operation === 'get'
        ? Promise.resolve(twoEntries)
        : Promise.reject(new Error('Email must be unique'))
    );
    const { result } = setup(dataHubAction);
    await waitFor(() => expect(result.current.entryIds).toHaveLength(2));

    act(() =>
      result.current.handleCellsEdit([
        { fieldKey: key('name'), rowIndex: 0, value: 'Alicia' },
        { fieldKey: key('email'), rowIndex: 0, value: 'taken@test.com' }
      ])
    );

    await waitFor(() =>
      expect(result.current.cellErrors).toEqual({
        [`0:${key('name')}`]: 'Email must be unique',
        [`0:${key('email')}`]: 'Email must be unique'
      })
    );
    // The stored values come back, so the grid keeps matching the Hub.
    expect(result.current.hubFieldValues[key('name')][0]).toBe('Alice');
    expect(result.current.hubFieldValues[key('email')][0]).toBe(
      'alice@test.com'
    );
  });

  test('a later successful write clears the shading it replaces', async () => {
    let failing = true;
    const dataHubAction = jest.fn(({ operation }) => {
      if (operation === 'get') return Promise.resolve(twoEntries);
      return failing
        ? Promise.reject(new Error('nope'))
        : Promise.resolve({ updated: 1 });
    });
    const { result } = setup(dataHubAction);
    await waitFor(() => expect(result.current.entryIds).toHaveLength(2));

    act(() =>
      result.current.handleCellsEdit([
        { fieldKey: key('name'), rowIndex: 0, value: 'Bad' }
      ])
    );
    await waitFor(() =>
      expect(Object.keys(result.current.cellErrors)).toHaveLength(1)
    );

    failing = false;
    act(() =>
      result.current.handleCellsEdit([
        { fieldKey: key('name'), rowIndex: 0, value: 'Good' }
      ])
    );

    await waitFor(() => expect(result.current.cellErrors).toEqual({}));
  });

  test('the first edit of an added row creates it once for the whole batch', async () => {
    const dataHubAction = jest.fn(({ operation }) => {
      if (operation === 'get') return Promise.resolve(twoEntries);
      if (operation === 'create') {
        return Promise.resolve({ id: 'entry3', data: {} });
      }
      return Promise.resolve({ updated: 1 });
    });
    const { result } = setup(dataHubAction);
    await waitFor(() => expect(result.current.entryIds).toHaveLength(2));
    act(() => result.current.handleAddRow());
    dataHubAction.mockClear();

    // The new row is prepended, so it is row 0.
    act(() =>
      result.current.handleCellsEdit([
        { fieldKey: key('name'), rowIndex: 0, value: 'Cara' },
        { fieldKey: key('email'), rowIndex: 0, value: 'cara@test.com' }
      ])
    );

    await waitFor(() => expect(dataHubAction).toHaveBeenCalledTimes(1));
    expect(dataHubAction).toHaveBeenCalledWith({
      hubId: 'hub1',
      operation: 'create',
      data: { name: 'Cara', email: 'cara@test.com' }
    });
  });
});

describe('useSpreadsheetHistory', () => {
  const setup = () => {
    const applied: CellWrite[][] = [];
    const view = renderHook(() =>
      useSpreadsheetHistory((writes) => applied.push(writes))
    );
    return { view, applied };
  };

  const patch = (rowIndex: number, before: any, after: any) => ({
    rowIndex,
    fieldKey: 'name_key',
    before,
    after
  });

  test('executing applies the new values and enables undo', () => {
    const { view, applied } = setup();

    act(() => view.result.current.execute('Edit', [patch(0, 'Alice', 'X')]));

    expect(applied).toEqual([[{ fieldKey: 'name_key', rowIndex: 0, value: 'X' }]]);
    expect(view.result.current.canUndo).toBe(true);
    expect(view.result.current.canRedo).toBe(false);
  });

  test('undo replays the previous values back through the write path', () => {
    const { view, applied } = setup();

    act(() => view.result.current.execute('Edit', [patch(0, 'Alice', 'X')]));
    act(() => view.result.current.undo());

    // Undo is a real write, not a local rewind, so it persists like any edit.
    expect(applied[1]).toEqual([
      { fieldKey: 'name_key', rowIndex: 0, value: 'Alice' }
    ]);
    expect(view.result.current.canUndo).toBe(false);
    expect(view.result.current.canRedo).toBe(true);
  });

  test('redo re-applies the undone values', () => {
    const { view, applied } = setup();

    act(() => view.result.current.execute('Edit', [patch(0, 'Alice', 'X')]));
    act(() => view.result.current.undo());
    act(() => view.result.current.redo());

    expect(applied[2]).toEqual([
      { fieldKey: 'name_key', rowIndex: 0, value: 'X' }
    ]);
    expect(view.result.current.canRedo).toBe(false);
  });

  test('a new edit after an undo drops the redo branch', () => {
    const { view } = setup();

    act(() => view.result.current.execute('Edit', [patch(0, 'Alice', 'X')]));
    act(() => view.result.current.undo());
    act(() => view.result.current.execute('Edit', [patch(1, 'Bob', 'Y')]));

    expect(view.result.current.canRedo).toBe(false);
  });

  test('reset clears the stack, since row indices have shifted', () => {
    const { view, applied } = setup();

    act(() => view.result.current.execute('Edit', [patch(0, 'Alice', 'X')]));
    act(() => view.result.current.reset());

    expect(view.result.current.canUndo).toBe(false);
    expect(view.result.current.canRedo).toBe(false);
    act(() => view.result.current.undo());
    // Nothing more was written: a stale patch would have hit the wrong row.
    expect(applied).toHaveLength(1);
  });

  test('an empty patch list is not recorded', () => {
    const { view, applied } = setup();
    act(() => view.result.current.execute('Edit', []));
    expect(applied).toHaveLength(0);
    expect(view.result.current.canUndo).toBe(false);
  });
});

describe('Data Hub verification filter', () => {
  const HUB_COLUMNS = [
    {
      name: 'Name',
      field_id: '',
      field_type: '',
      field_key: '',
      hub_field_id: 'hf1',
      hub_field_key: 'name'
    }
  ];

  const makeElement = (hubVerification?: HubVerification) => ({
    id: 'table1',
    properties: {
      columns: HUB_COLUMNS,
      hub_id: 'hub1',
      ...(hubVerification ? { hub_verification: hubVerification } : {})
    }
  });

  const key = (hubFieldKey: string) => `__hub_table1_${hubFieldKey}`;

  const mixedEntries = [
    { id: 'entry1', data: { name: 'Alice' }, verified: true },
    { id: 'entry2', data: { name: 'Bob' }, verified: false }
  ];

  const setup = (
    dataHubAction: jest.Mock,
    hubVerification?: HubVerification
  ) => {
    const client = { dataHubAction } as any;
    const element = makeElement(hubVerification);
    return renderHook(() =>
      useHubTableSource({ element, client, enabled: true })
    );
  };

  test('defaults to verified, matching the Hub API default', async () => {
    const dataHubAction = jest.fn(() => Promise.resolve([]));
    const { result } = setup(dataHubAction);
    await waitFor(() => expect(dataHubAction).toHaveBeenCalled());

    expect(dataHubAction).toHaveBeenCalledWith({
      hubId: 'hub1',
      operation: 'get',
      verification: 'verified'
    });
    expect(result.current.canAddRows).toBe(true);
  });

  test.each(['all', 'unverified'] as const)(
    'sends the configured %s filter through to the Hub',
    async (verification) => {
      const dataHubAction = jest.fn(() => Promise.resolve([]));
      setup(dataHubAction, verification);
      await waitFor(() => expect(dataHubAction).toHaveBeenCalled());

      expect(dataHubAction).toHaveBeenCalledWith({
        hubId: 'hub1',
        operation: 'get',
        verification
      });
    }
  );

  test('adding rows is off while viewing the staged set', async () => {
    // `create` with verification:unverified is a batch REPLACE of the staged
    // rows, so adding one row would drop every other one.
    const dataHubAction = jest.fn(() => Promise.resolve([]));
    const { result } = setup(dataHubAction, 'unverified');
    await waitFor(() => expect(dataHubAction).toHaveBeenCalled());
    expect(result.current.canAddRows).toBe(false);
  });

  test('correcting an unverified row names that set on the update', async () => {
    // Update defaults to the verified set server-side, so a staged row has to
    // be targeted explicitly or the write would match nothing.
    const dataHubAction = jest.fn(({ operation }) =>
      operation === 'get' ? Promise.resolve(mixedEntries) : Promise.resolve({})
    );
    const { result } = setup(dataHubAction, 'all');
    await waitFor(() => expect(result.current.entryIds).toHaveLength(2));
    dataHubAction.mockClear();

    act(() =>
      result.current.handleCellsEdit([
        { fieldKey: key('name'), rowIndex: 1, value: 'Robert' }
      ])
    );

    await waitFor(() => expect(dataHubAction).toHaveBeenCalledTimes(1));
    expect(dataHubAction).toHaveBeenCalledWith({
      hubId: 'hub1',
      operation: 'update',
      verification: 'unverified',
      where: [{ entryId: 'entry2' }],
      data: { name: 'Robert' }
    });
    expect(result.current.hubFieldValues[key('name')][1]).toBe('Robert');
  });

  test('a verified row is updated without a verification filter', async () => {
    const dataHubAction = jest.fn(({ operation }) =>
      operation === 'get' ? Promise.resolve(mixedEntries) : Promise.resolve({})
    );
    const { result } = setup(dataHubAction, 'all');
    await waitFor(() => expect(result.current.entryIds).toHaveLength(2));
    dataHubAction.mockClear();

    act(() =>
      result.current.handleCellsEdit([
        { fieldKey: key('name'), rowIndex: 0, value: 'Alicia' }
      ])
    );

    await waitFor(() => expect(dataHubAction).toHaveBeenCalledTimes(1));
    expect(dataHubAction).toHaveBeenCalledWith({
      hubId: 'hub1',
      operation: 'update',
      where: [{ entryId: 'entry1' }],
      data: { name: 'Alicia' }
    });
  });

  test('a mixed batch writes each row against its own set', async () => {
    const dataHubAction = jest.fn(({ operation }) =>
      operation === 'get' ? Promise.resolve(mixedEntries) : Promise.resolve({})
    );
    const { result } = setup(dataHubAction, 'all');
    await waitFor(() => expect(result.current.entryIds).toHaveLength(2));
    dataHubAction.mockClear();

    act(() =>
      result.current.handleCellsEdit([
        { fieldKey: key('name'), rowIndex: 0, value: 'Alicia' },
        { fieldKey: key('name'), rowIndex: 1, value: 'Robert' }
      ])
    );

    await waitFor(() => expect(dataHubAction).toHaveBeenCalledTimes(2));
    const calls = dataHubAction.mock.calls.map(([options]: any[]) => options);
    expect(calls.find((c) => c.where[0].entryId === 'entry1').verification).toBe(
      undefined
    );
    expect(calls.find((c) => c.where[0].entryId === 'entry2').verification).toBe(
      'unverified'
    );
  });

  test('deleting an unverified row targets that set too', async () => {
    const dataHubAction = jest.fn(({ operation }) =>
      operation === 'get' ? Promise.resolve(mixedEntries) : Promise.resolve({})
    );
    const { result } = setup(dataHubAction, 'all');
    await waitFor(() => expect(result.current.entryIds).toHaveLength(2));
    dataHubAction.mockClear();

    act(() => result.current.handleDeleteRow(1));

    await waitFor(() => expect(dataHubAction).toHaveBeenCalledTimes(1));
    expect(dataHubAction).toHaveBeenCalledWith({
      hubId: 'hub1',
      operation: 'delete',
      verification: 'unverified',
      where: [{ entryId: 'entry2' }]
    });
    expect(result.current.entryIds).toEqual(['entry1']);
  });
});
