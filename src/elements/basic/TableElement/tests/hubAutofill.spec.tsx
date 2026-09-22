import { act, renderHook, waitFor } from '@testing-library/react';
import { fieldValues } from '../../../../utils/init';
import { hubAutofillData, useHubTableSource } from '../useHubTableSource';
import type { HubAutofill } from '../useHubTableSource';

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

const staticOwner: HubAutofill = {
  hub_field_id: 'hf3',
  hub_field_key: 'owner',
  source: 'static',
  value: 'acme'
};

const fieldAccount: HubAutofill = {
  hub_field_id: 'hf2',
  hub_field_key: 'account',
  source: 'field',
  field_id: 'hidden-1',
  field_type: 'hidden',
  field_key: 'account_id'
};

describe('hubAutofillData', () => {
  test('static entries copy their value; field entries copy the live field value', () => {
    expect(
      hubAutofillData([staticOwner, fieldAccount], null, { account_id: 'a1' })
    ).toEqual({ owner: 'acme', account: 'a1' });
  });

  test('an empty or missing form field leaves its column alone', () => {
    expect(hubAutofillData([fieldAccount], null, { account_id: '' })).toEqual(
      {}
    );
    expect(hubAutofillData([fieldAccount], null, {})).toEqual({});
    // Not yet hydrated (field deleted server-side): nothing to read.
    expect(
      hubAutofillData([{ ...fieldAccount, field_key: undefined }], null, {
        account_id: 'a1'
      })
    ).toEqual({});
  });

  test('a static value may be empty, and a list value is kept as a list', () => {
    expect(hubAutofillData([{ ...staticOwner, value: '' }], null, {})).toEqual({
      owner: ''
    });
    expect(
      hubAutofillData([fieldAccount], null, { account_id: ['a1', 'a2'] })
    ).toEqual({ account: ['a1', 'a2'] });
  });

  test('uses the live schema key: a renamed column keeps filling, a deleted one stops', () => {
    const renamed = [{ id: 'hf3', key: 'holder' }] as any;
    expect(hubAutofillData([staticOwner], renamed, {})).toEqual({
      holder: 'acme'
    });
    const without = [{ id: 'other', key: 'other' }] as any;
    expect(hubAutofillData([staticOwner], without, {})).toEqual({});
    expect(hubAutofillData(undefined, null, {})).toEqual({});
  });
});

describe('useHubTableSource autofill', () => {
  afterEach(() => {
    delete (fieldValues as any).account_id;
  });

  const setup = (autofill: HubAutofill[]) => {
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
        hub_autofill: autofill
      }
    };
    const client = { dataHubAction } as any;
    const hook = renderHook(() =>
      useHubTableSource({ element, client, enabled: true })
    );
    return { dataHubAction, hook };
  };

  test('a new row starts with the autofill values and they go out with its first edit', async () => {
    Object.assign(fieldValues, { account_id: 'a1' });
    const { dataHubAction, hook } = setup([staticOwner, fieldAccount]);
    await waitFor(() => expect(dataHubAction).toHaveBeenCalled());
    // Let the initial read land, or its (empty) rows would replace the new one.
    await act(async () => {});

    act(() => hook.result.current.handleAddRow());
    expect(hook.result.current.hubFieldValues['__hub_table1_account']).toEqual([
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

  test('without autofill a new row is blank, as before', async () => {
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
