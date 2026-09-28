import { act, renderHook, waitFor } from '@testing-library/react';
import { fieldValues } from '../../../../utils/init';
import { useHubTableSource } from '../useHubTableSource';
import { useTableMutations } from '../useTableMutations';
import { fieldRowDefaults, hubRowDefaults } from '../rowDefaults';
import type { TableRowDefault } from '../types';

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
    name: 'Account',
    field_id: '',
    field_type: '',
    field_key: '',
    hub_field_id: 'hf2',
    hub_field_key: 'account'
  }
];

const staticOwner: TableRowDefault = {
  hub_field_id: 'hf3',
  hub_field_key: 'owner',
  source: 'static',
  value: 'acme'
};

const fieldAccount: TableRowDefault = {
  hub_field_id: 'hf2',
  hub_field_key: 'account',
  source: 'field',
  field_id: 'hidden-1',
  field_type: 'hidden',
  field_key: 'account_id'
};

describe('hubRowDefaults', () => {
  test('static entries copy their value; field entries copy the live field value', () => {
    expect(
      hubRowDefaults([staticOwner, fieldAccount], null, { account_id: 'a1' })
    ).toEqual({ owner: 'acme', account: 'a1' });
  });

  test('an empty or missing form field leaves its column alone', () => {
    expect(hubRowDefaults([fieldAccount], null, { account_id: '' })).toEqual(
      {}
    );
    expect(hubRowDefaults([fieldAccount], null, {})).toEqual({});
    // Not yet hydrated (field deleted server-side): nothing to read.
    expect(
      hubRowDefaults([{ ...fieldAccount, field_key: undefined }], null, {
        account_id: 'a1'
      })
    ).toEqual({});
  });

  test('a static value may be empty, and a list value is kept as a list', () => {
    expect(hubRowDefaults([{ ...staticOwner, value: '' }], null, {})).toEqual({
      owner: ''
    });
    expect(
      hubRowDefaults([fieldAccount], null, { account_id: ['a1', 'a2'] })
    ).toEqual({ account: ['a1', 'a2'] });
  });

  test('uses the live schema key: a renamed column keeps filling, a deleted one stops', () => {
    const renamed = [{ id: 'hf3', key: 'holder' }] as any;
    expect(hubRowDefaults([staticOwner], renamed, {})).toEqual({
      holder: 'acme'
    });
    const without = [{ id: 'other', key: 'other' }] as any;
    expect(hubRowDefaults([staticOwner], without, {})).toEqual({});
    expect(hubRowDefaults(undefined, null, {})).toEqual({});
  });
});

describe('useHubTableSource row defaults', () => {
  afterEach(() => {
    delete (fieldValues as any).account_id;
  });

  const setup = (rowDefaults: TableRowDefault[]) => {
    const dataHubAction = jest.fn((options: any) => {
      if (options.operation === 'create') {
        return Promise.resolve({ id: 'e1', data: options.data });
      }
      return Promise.resolve([]);
    });
    const element = {
      id: 'table1',
      properties: {
        columns: HUB_COLUMNS,
        hub_id: 'hub1',
        // The owner column is hidden: it has no grid column, only a value.
        hidden_hub_fields: ['hf3'],
        row_defaults: rowDefaults
      }
    };
    const client = { dataHubAction } as any;
    const hook = renderHook(() =>
      useHubTableSource({ element, client, enabled: true })
    );
    return { dataHubAction, hook };
  };

  test('a new row starts with the default values and they go out with its first edit', async () => {
    Object.assign(fieldValues, { account_id: 'a1' });
    const { dataHubAction, hook } = setup([staticOwner, fieldAccount]);
    await waitFor(() => expect(dataHubAction).toHaveBeenCalled());
    // Let the initial read land, or its (empty) rows would replace the new one.
    await act(async () => {});

    act(() => hook.result.current.handleAddRow());
    expect(hook.result.current.hubFieldValues.__hub_table1_account).toEqual([
      'a1'
    ]);

    // The form field changing afterwards does not touch the row already added.
    Object.assign(fieldValues, { account_id: 'a2' });
    act(() =>
      hook.result.current.handleCellEdit('__hub_table1_name', 0, 'Jane')
    );
    await waitFor(() =>
      expect(dataHubAction).toHaveBeenCalledWith({
        hubId: 'hub1',
        operation: 'create',
        data: { name: 'Jane', account: 'a1', owner: 'acme' }
      })
    );
    await waitFor(() => expect(hook.result.current.entryIds).toEqual(['e1']));
  });

  test('without defaults a new row is blank, as before', async () => {
    const { dataHubAction, hook } = setup([]);
    await waitFor(() => expect(dataHubAction).toHaveBeenCalled());
    await act(async () => {});
    act(() => hook.result.current.handleAddRow());
    act(() =>
      hook.result.current.handleCellEdit('__hub_table1_name', 0, 'Jane')
    );
    await waitFor(() =>
      expect(dataHubAction).toHaveBeenCalledWith({
        hubId: 'hub1',
        operation: 'create',
        data: { name: 'Jane', account: '' }
      })
    );
  });
});

// The same form field feeding a field-backed table's column.
const columnAccount = (columnFieldId: string): TableRowDefault => ({
  column_field_id: columnFieldId,
  source: 'field',
  field_id: 'hidden-1',
  field_type: 'hidden',
  field_key: 'account_id'
});

describe('fieldRowDefaults', () => {
  const staticAge: TableRowDefault = {
    column_field_id: 'f2',
    source: 'static',
    value: '18'
  };

  test('keys by target column; hub-targeted and unresolved entries are skipped', () => {
    expect(
      fieldRowDefaults(
        [
          staticAge,
          columnAccount('f1'),
          staticOwner,
          { ...columnAccount('f3'), field_key: 'missing' }
        ],
        { account_id: 'a1' }
      )
    ).toEqual({ f2: '18', f1: 'a1' });
    expect(fieldRowDefaults(undefined, {})).toEqual({});
  });
});

describe('useTableMutations row defaults', () => {
  const COLUMNS = [
    { name: 'Name', field_id: 'f1', field_type: 'text', field_key: 'name_key' },
    {
      name: 'Account',
      field_id: 'f2',
      field_type: 'text',
      field_key: 'acct_key'
    },
    { name: 'Age', field_id: 'f3', field_type: 'text', field_key: 'age_key' }
  ];

  afterEach(() => {
    ['account_id', 'name_key', 'acct_key', 'age_key'].forEach(
      (key) => delete (fieldValues as any)[key]
    );
  });

  const setup = (rowDefaults: TableRowDefault[]) => {
    Object.assign(fieldValues, {
      name_key: ['Alice'],
      acct_key: ['x'],
      age_key: ['30']
    });
    const updateFieldValues = jest.fn((values: Record<string, any>) =>
      Object.assign(fieldValues, values)
    );
    const submitCustom = jest.fn();
    const hook = renderHook(() =>
      useTableMutations({
        columns: COLUMNS,
        rowDefaults,
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
    return { hook, updateFieldValues, submitCustom };
  };

  test('added and inserted rows take their defaults; other columns stay blank', () => {
    Object.assign(fieldValues, { account_id: 'a1' });
    const { hook, updateFieldValues, submitCustom } = setup([
      { column_field_id: 'f3', source: 'static', value: '18' },
      columnAccount('f2'),
      // Its column was removed from the table: ignored.
      { column_field_id: 'gone', source: 'static', value: 'zzz' }
    ]);

    act(() => hook.result.current.handleAddRow());
    expect(updateFieldValues).toHaveBeenLastCalledWith({
      name_key: ['', 'Alice'],
      acct_key: ['a1', 'x'],
      age_key: ['18', '30']
    });

    // Read at insert time: the next row sees the form field's new value.
    Object.assign(fieldValues, { account_id: 'a2' });
    act(() => hook.result.current.handleInsertRow(2));
    expect(updateFieldValues).toHaveBeenLastCalledWith({
      name_key: ['', 'Alice', ''],
      acct_key: ['a1', 'x', 'a2'],
      age_key: ['18', '30', '18']
    });
    // Still provisional until a cell is edited.
    expect(submitCustom).not.toHaveBeenCalled();
  });

  test('an empty source field still inserts a blank slot', () => {
    const { hook, updateFieldValues } = setup([columnAccount('f2')]);
    act(() => hook.result.current.handleAddRow());
    expect(updateFieldValues).toHaveBeenLastCalledWith({
      name_key: ['', 'Alice'],
      acct_key: ['', 'x'],
      age_key: ['', '30']
    });
  });
});
