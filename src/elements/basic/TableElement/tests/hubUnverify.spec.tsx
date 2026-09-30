import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor
} from '@testing-library/react';
import { useHubTableSource } from '../useHubTableSource';
import { RowMenu } from '../spreadsheet/RowMenu';

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

const SCHEMA = {
  hubs: [
    {
      id: 'hub1',
      key: 'people',
      unverified_enabled: true,
      fields: [
        { id: 'hf1', key: 'name', type: 'text' },
        { id: 'hf2', key: 'email', type: 'text' }
      ]
    }
  ]
};

const key = (hubFieldKey: string) => `__hub_table1_${hubFieldKey}`;

const entries = () => [
  { id: 'entry1', data: { name: 'Alice', email: 'a@x.io' }, verified: true },
  { id: 'entry2', data: { name: 'Bob', email: 'b@x.io' }, verified: false }
];

type Props = Record<string, any>;

const setup = (
  dataHubAction: jest.Mock,
  properties: Props = {},
  schema: any = SCHEMA
) => {
  const client = {
    dataHubAction,
    getHubSchemas: jest.fn(() => Promise.resolve(schema))
  } as any;
  const element = {
    id: 'table1',
    properties: {
      columns: HUB_COLUMNS,
      hub_id: 'hub1',
      hub_verification: 'all' as const,
      ...properties
    }
  };
  return renderHook(() =>
    useHubTableSource({ element, client, enabled: true })
  );
};

const mockHub = (
  writes: (options: any) => Promise<any> = () => Promise.resolve({})
) =>
  jest.fn((options: any) =>
    options.operation === 'get' ? Promise.resolve(entries()) : writes(options)
  );

describe('marking Data Hub rows unvalidated', () => {
  test('is offered only when the builder allowed it and the hub stages rows', async () => {
    const { result: off } = setup(mockHub());
    await waitFor(() => expect(off.current.entryIds).toHaveLength(2));
    expect(off.current.canUnverify).toBe(false);

    const { result: on } = setup(mockHub(), { hub_allow_unverify: true });
    await waitFor(() => expect(on.current.canUnverify).toBe(true));

    const plainHub = {
      hubs: [{ ...SCHEMA.hubs[0], unverified_enabled: false }]
    };
    const { result: noStaging } = setup(
      mockHub(),
      { hub_allow_unverify: true },
      plainHub
    );
    await waitFor(() => expect(noStaging.current.entryIds).toHaveLength(2));
    expect(noStaging.current.canUnverify).toBe(false);
  });

  test('sends each validated row back and flips its status at once', async () => {
    const dataHubAction = mockHub(() =>
      Promise.resolve({ unverified_count: 1 })
    );
    const { result } = setup(dataHubAction, { hub_allow_unverify: true });
    await waitFor(() => expect(result.current.entryIds).toHaveLength(2));
    dataHubAction.mockClear();

    // Row 1 is already staged and is skipped rather than re-sent.
    act(() => result.current.handleUnverifyRows([0, 1]));

    expect(result.current.rowVerified).toEqual([false, false]);
    await waitFor(() => expect(dataHubAction).toHaveBeenCalledTimes(1));
    expect(dataHubAction).toHaveBeenCalledWith({
      hubId: 'hub1',
      operation: 'unverify',
      where: [{ entryId: 'entry1' }]
    });
    await waitFor(() => expect(result.current.saving).toBe(false));
    expect(result.current.errors).toEqual([]);
    expect(result.current.hubFieldValues[key('__status__')]).toEqual([
      'Unvalidated',
      'Unvalidated'
    ]);
  });

  test('a rejected flip is undone and reported', async () => {
    const dataHubAction = mockHub(() =>
      Promise.reject(new Error('Unverified data is not enabled for this hub'))
    );
    const { result } = setup(dataHubAction, { hub_allow_unverify: true });
    await waitFor(() => expect(result.current.entryIds).toHaveLength(2));

    act(() => result.current.handleUnverifyRows([0]));
    await waitFor(() => expect(result.current.saving).toBe(false));

    expect(result.current.rowVerified).toEqual([true, false]);
    expect(result.current.errors).toEqual([
      'Unverified data is not enabled for this hub'
    ]);
  });

  test('a row the Hub no longer holds as validated is put back with a refresh hint', async () => {
    const dataHubAction = mockHub(() =>
      Promise.resolve({ unverified_count: 0 })
    );
    const { result } = setup(dataHubAction, { hub_allow_unverify: true });
    await waitFor(() => expect(result.current.entryIds).toHaveLength(2));

    act(() => result.current.handleUnverifyRows([0]));
    await waitFor(() => expect(result.current.saving).toBe(false));

    expect(result.current.rowVerified).toEqual([true, false]);
    expect(result.current.errors[0]).toMatch(/Refresh/);
  });

  test('a bulk flip reports each distinct failure', async () => {
    const failures = ['first', 'second'];
    const dataHubAction = jest.fn((options: any) =>
      options.operation === 'get'
        ? Promise.resolve(entries().map((e) => ({ ...e, verified: true })))
        : Promise.reject(new Error(failures.shift()))
    );
    const { result } = setup(dataHubAction, { hub_allow_unverify: true });
    await waitFor(() => expect(result.current.entryIds).toHaveLength(2));

    act(() => result.current.handleUnverifyRows([0, 1]));
    await waitFor(() => expect(result.current.saving).toBe(false));

    expect(result.current.rowVerified).toEqual([true, true]);
    expect(result.current.errors).toEqual(['first', 'second']);
  });
});

describe('auto-validating Data Hub rows on save', () => {
  const edit = (result: any, rowIndex: number, value: string) =>
    act(() =>
      result.current.handleCellsEdit([
        { fieldKey: key('email'), rowIndex, value }
      ])
    );

  test('is off unless the builder turned it on', async () => {
    const dataHubAction = mockHub(() => Promise.resolve({ updated: 1 }));
    const { result } = setup(dataHubAction);
    await waitFor(() => expect(result.current.entryIds).toHaveLength(2));
    dataHubAction.mockClear();

    edit(result, 1, 'bob@x.io');
    await waitFor(() => expect(result.current.saving).toBe(false));

    expect(dataHubAction).toHaveBeenCalledTimes(1);
    expect(dataHubAction.mock.calls[0][0].operation).toBe('update');
    expect(result.current.rowVerified).toEqual([true, false]);
  });

  test('a staged row saved clean is verified and shows as validated', async () => {
    const dataHubAction = mockHub(({ operation }) =>
      Promise.resolve(
        operation === 'verify' ? { verified_count: 1 } : { updated: 1 }
      )
    );
    const { result } = setup(dataHubAction, { hub_auto_verify: true });
    await waitFor(() => expect(result.current.entryIds).toHaveLength(2));
    dataHubAction.mockClear();

    edit(result, 1, 'bob@x.io');
    await waitFor(() => expect(result.current.saving).toBe(false));

    expect(dataHubAction.mock.calls.map((c) => c[0].operation)).toEqual([
      'update',
      'verify'
    ]);
    expect(dataHubAction).toHaveBeenLastCalledWith({
      hubId: 'hub1',
      operation: 'verify',
      where: [{ entryId: 'entry2' }]
    });
    expect(result.current.rowVerified).toEqual([true, true]);
    expect(result.current.hubFieldValues[key('__status__')][1]).toBe(
      'Validated'
    );
  });

  test('a validated row is saved without a verify round trip', async () => {
    const dataHubAction = mockHub(() => Promise.resolve({ updated: 1 }));
    const { result } = setup(dataHubAction, { hub_auto_verify: true });
    await waitFor(() => expect(result.current.entryIds).toHaveLength(2));
    dataHubAction.mockClear();

    edit(result, 0, 'alice@x.io');
    await waitFor(() => expect(result.current.saving).toBe(false));

    expect(dataHubAction).toHaveBeenCalledTimes(1);
  });

  test('a save the Hub flagged is not verified', async () => {
    const dataHubAction = mockHub(() =>
      Promise.resolve({ updated: 1, error: 'Invalid email' })
    );
    const { result } = setup(dataHubAction, { hub_auto_verify: true });
    await waitFor(() => expect(result.current.entryIds).toHaveLength(2));
    dataHubAction.mockClear();

    edit(result, 1, 'not-an-email');
    await waitFor(() => expect(result.current.saving).toBe(false));

    expect(dataHubAction).toHaveBeenCalledTimes(1);
    expect(result.current.rowVerified).toEqual([true, false]);
    expect(result.current.cellErrors[`1:${key('email')}`]).toBe(
      'Invalid email'
    );
  });

  test('a verify that fails for another reason stays staged and says why', async () => {
    const dataHubAction = mockHub(({ operation }) =>
      operation === 'verify'
        ? Promise.reject(new Error('Network error'))
        : Promise.resolve({ updated: 1 })
    );
    const { result } = setup(dataHubAction, { hub_auto_verify: true });
    await waitFor(() => expect(result.current.entryIds).toHaveLength(2));

    edit(result, 1, 'bob@x.io');
    await waitFor(() => expect(result.current.saving).toBe(false));

    expect(result.current.rowVerified).toEqual([true, false]);
    expect(result.current.errors).toEqual(['Network error']);
  });

  test('a row the full gate rejects stays staged with the blocking cells flagged', async () => {
    const dataHubAction = mockHub(({ operation }) =>
      operation === 'verify'
        ? Promise.reject(
            Object.assign(new Error('Verification failed'), {
              payload: {
                errors: [
                  {
                    entry_id: 'entry2',
                    message: 'This field is required',
                    field_errors: { hf1: 'This field is required' }
                  }
                ]
              }
            })
          )
        : Promise.resolve({ updated: 1 })
    );
    const { result } = setup(dataHubAction, { hub_auto_verify: true });
    await waitFor(() => expect(result.current.entryIds).toHaveLength(2));

    edit(result, 1, 'bob@x.io');
    await waitFor(() => expect(result.current.saving).toBe(false));

    expect(result.current.rowVerified).toEqual([true, false]);
    // Quiet: the row simply stays unvalidated, no banner.
    expect(result.current.errors).toEqual([]);
    expect(result.current.cellErrors[`1:${key('name')}`]).toBe(
      'This field is required'
    );
    expect(result.current.cellErrors[`1:${key('email')}`]).toBeUndefined();
  });

  test('a new staged row is verified once its first save creates it clean', async () => {
    const dataHubAction = mockHub(({ operation, data }) =>
      Promise.resolve(
        operation === 'verify'
          ? { verified_count: 1 }
          : { id: 'entry3', data, verified: false }
      )
    );
    const { result } = setup(dataHubAction, {
      hub_auto_verify: true,
      hub_verification: 'unverified'
    });
    await waitFor(() => expect(result.current.entryIds).toHaveLength(2));
    dataHubAction.mockClear();

    act(() => result.current.handleAddRow());
    expect(result.current.rowVerified[0]).toBe(false);
    edit(result, 0, 'new@x.io');
    await waitFor(() => expect(result.current.saving).toBe(false));

    expect(dataHubAction.mock.calls.map((c) => c[0].operation)).toEqual([
      'create',
      'verify'
    ]);
    expect(result.current.entryIds[0]).toBe('entry3');
    expect(result.current.rowVerified[0]).toBe(true);
  });
});

describe('deleting a row right after its save auto-verified it', () => {
  test('scopes the delete to the set the row ended up in', async () => {
    let finishUpdate: () => void = () => {};
    const dataHubAction = mockHub(({ operation }) => {
      if (operation === 'update') {
        return new Promise((resolve) => {
          finishUpdate = () => resolve({ updated: 1 });
        });
      }
      return Promise.resolve(
        operation === 'verify' ? { verified_count: 1 } : { deleted: 1 }
      );
    });
    const { result } = setup(dataHubAction, { hub_auto_verify: true });
    await waitFor(() => expect(result.current.entryIds).toHaveLength(2));
    dataHubAction.mockClear();

    // The delete is clicked while the save is still in flight, so its
    // snapshot of row 1 still says staged.
    act(() => {
      result.current.handleCellsEdit([
        { fieldKey: key('email'), rowIndex: 1, value: 'bob@x.io' }
      ]);
    });
    await waitFor(() => expect(dataHubAction).toHaveBeenCalledTimes(1));
    act(() => result.current.handleDeleteRow(1));
    act(() => finishUpdate());
    await waitFor(() => expect(result.current.saving).toBe(false));

    const calls = dataHubAction.mock.calls.map((c) => c[0]);
    expect(calls.map((c) => c.operation)).toEqual([
      'update',
      'verify',
      'delete'
    ]);
    expect(calls[2].verification).toBeUndefined();
    expect(result.current.entryIds).toEqual(['entry1']);
  });
});

describe('writes queued around a flip name the set the Hub holds the row in', () => {
  const deferred = () => {
    let settle: (fail?: boolean) => void = () => {};
    const promise = new Promise<any>((resolve, reject) => {
      settle = (fail) =>
        fail ? reject(new Error('flip failed')) : resolve({ updated: 1 });
    });
    return { promise, settle };
  };

  test('an edit queued ahead of an unverify still targets the verified set', async () => {
    const held = deferred();
    const dataHubAction = mockHub(({ operation, where }) => {
      if (operation === 'update' && where[0].entryId === 'entry2') {
        return held.promise;
      }
      return Promise.resolve(
        operation === 'unverify' ? { unverified_count: 1 } : { updated: 1 }
      );
    });
    const { result } = setup(dataHubAction, { hub_allow_unverify: true });
    await waitFor(() => expect(result.current.entryIds).toHaveLength(2));
    dataHubAction.mockClear();

    // Row 1's save holds the queue, row 0's edit waits behind it, and the
    // flip of row 0 is clicked before either has run.
    act(() => {
      result.current.handleCellsEdit([
        { fieldKey: key('email'), rowIndex: 1, value: 'bob@x.io' }
      ]);
      result.current.handleCellsEdit([
        { fieldKey: key('email'), rowIndex: 0, value: 'alice@x.io' }
      ]);
    });
    act(() => result.current.handleUnverifyRows([0]));
    act(() => held.settle());
    await waitFor(() => expect(result.current.saving).toBe(false));

    const calls = dataHubAction.mock.calls.map((c) => c[0]);
    expect(calls.map((c) => [c.operation, c.where[0].entryId])).toEqual([
      ['update', 'entry2'],
      ['update', 'entry1'],
      ['unverify', 'entry1']
    ]);
    expect(calls[1].verification).toBeUndefined();
    expect(result.current.errors).toEqual([]);
    expect(result.current.rowVerified).toEqual([false, false]);
  });

  test('a delete queued behind a failed unverify targets the verified set', async () => {
    const held = deferred();
    const dataHubAction = mockHub(({ operation }) =>
      operation === 'unverify' ? held.promise : Promise.resolve({ deleted: 1 })
    );
    const { result } = setup(dataHubAction, { hub_allow_unverify: true });
    await waitFor(() => expect(result.current.entryIds).toHaveLength(2));
    dataHubAction.mockClear();

    act(() => result.current.handleUnverifyRows([0]));
    act(() => result.current.handleDeleteRow(0));
    act(() => held.settle(true));
    await waitFor(() => expect(result.current.saving).toBe(false));

    const calls = dataHubAction.mock.calls.map((c) => c[0]);
    expect(calls.map((c) => c.operation)).toEqual(['unverify', 'delete']);
    expect(calls[1].verification).toBeUndefined();
    expect(result.current.entryIds).toEqual(['entry2']);
  });
});

describe('spreadsheet row menu unvalidate item', () => {
  const target = { rowIndex: 2, displayNumber: 3, rowIndexes: [2], x: 0, y: 0 };
  const renderMenu = (props: Partial<Parameters<typeof RowMenu>[0]>) =>
    render(
      <RowMenu
        target={target}
        canInsert={false}
        canDelete
        onInsertAbove={jest.fn()}
        onInsertBelow={jest.fn()}
        onDelete={jest.fn()}
        onClose={jest.fn()}
        {...props}
      />
    );

  test('names the row it acts on, not the one it was opened on', () => {
    const onUnverify = jest.fn();
    renderMenu({ unverifyNumbers: [2], onUnverify });
    fireEvent.click(screen.getByText('Mark as unvalidated (row 2)'));
    expect(onUnverify).toHaveBeenCalled();
  });

  test('counts the rows for a selection-wide action', () => {
    renderMenu({ unverifyNumbers: [1, 2, 4, 5], onUnverify: jest.fn() });
    expect(screen.getByText('Mark as unvalidated (4 rows)')).toBeTruthy();
  });

  test('renders nothing when there is no action to offer', () => {
    const { container } = renderMenu({
      canDelete: false,
      unverifyNumbers: [],
      onUnverify: jest.fn()
    });
    expect(container.firstChild).toBeNull();
  });

  test('is absent when no target row can be unvalidated', () => {
    renderMenu({ unverifyNumbers: [], onUnverify: jest.fn() });
    expect(screen.queryByText(/unvalidated/)).toBeNull();
    expect(screen.getByText('Delete row 3')).toBeTruthy();
  });
});
