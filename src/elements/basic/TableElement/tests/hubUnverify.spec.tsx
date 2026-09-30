import { act, renderHook, waitFor } from '@testing-library/react';
import { fireEvent, render, screen } from '@testing-library/react';
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
      hub_verification: 'all',
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

describe('spreadsheet row menu unvalidate item', () => {
  const target = { rowIndex: 2, displayNumber: 3, rowIndexes: [2], x: 0, y: 0 };
  const renderMenu = (props: Partial<Parameters<typeof RowMenu>[0]>) =>
    render(
      <RowMenu
        target={target}
        canInsert={false}
        canDelete={true}
        onInsertAbove={jest.fn()}
        onInsertBelow={jest.fn()}
        onDelete={jest.fn()}
        onClose={jest.fn()}
        {...props}
      />
    );

  test('names the row when it is the only target', () => {
    const onUnverify = jest.fn();
    renderMenu({ unverifyCount: 1, onUnverify });
    fireEvent.click(screen.getByText('Mark row 3 as unvalidated'));
    expect(onUnverify).toHaveBeenCalled();
  });

  test('counts the rows for a selection-wide action', () => {
    renderMenu({ unverifyCount: 4, onUnverify: jest.fn() });
    expect(screen.getByText('Mark 4 rows as unvalidated')).toBeTruthy();
  });

  test('is absent when no target row can be unvalidated', () => {
    renderMenu({ unverifyCount: 0, onUnverify: jest.fn() });
    expect(screen.queryByText(/unvalidated/)).toBeNull();
    expect(screen.getByText('Delete row 3')).toBeTruthy();
  });
});
