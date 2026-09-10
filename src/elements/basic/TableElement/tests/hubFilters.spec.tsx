import { act, renderHook, waitFor } from '@testing-library/react';
import { fieldValues } from '../../../../utils/init';
import {
  hubFilterList,
  hubFilterWhere,
  useHubTableSource
} from '../useHubTableSource';
import type { HubFilter } from '../useHubTableSource';

const HUB_COLUMNS = [
  {
    name: 'Account',
    field_id: '',
    field_type: '',
    field_key: '',
    hub_field_id: 'hf1',
    hub_field_key: 'account'
  }
];

const equalsFilter: HubFilter = {
  hub_field_id: 'hf1',
  hub_field_key: 'account',
  operator: 'equals',
  field_id: 'hidden-1',
  field_type: 'hidden',
  field_key: 'account_id'
};

const inFilter: HubFilter = {
  ...equalsFilter,
  operator: 'in',
  field_id: 'hidden-2',
  field_key: 'account_ids'
};

const element = (filters: HubFilter[]) => ({
  id: 'table1',
  properties: { columns: HUB_COLUMNS, hub_id: 'hub1', hub_filters: filters }
});

describe('hubFilterWhere', () => {
  test('resolves each filter to a hub API condition on the form field value', () => {
    expect(
      hubFilterWhere([equalsFilter, inFilter], null, {
        account_id: 'acme',
        account_ids: 'acme, globex,,'
      })
    ).toEqual([
      { fieldId: 'account', value: 'acme' },
      { fieldId: 'account', operator: 'in', value: ['acme', 'globex'] }
    ]);
  });

  test('prefers the live schema key for the hub column, so a rename keeps filtering', () => {
    const schema = [{ id: 'hf1', key: 'customer' }] as any;
    expect(hubFilterWhere([equalsFilter], schema, { account_id: 'x' })).toEqual(
      [{ fieldId: 'customer', value: 'x' }]
    );
  });

  test('an unset field compares as empty and a filter without a field is skipped', () => {
    expect(hubFilterWhere([equalsFilter], null, {})).toEqual([
      { fieldId: 'account', value: '' }
    ]);
    const orphan = { ...equalsFilter, field_key: undefined };
    expect(hubFilterWhere([orphan], null, {})).toEqual([]);
    expect(hubFilterWhere(undefined, null, {})).toEqual([]);
  });

  test('hubFilterList reads lists as-is and single values as comma-separated', () => {
    expect(hubFilterList(['a', '', null, 'b'])).toEqual(['a', 'b']);
    expect(hubFilterList('a,b , c')).toEqual(['a', 'b', 'c']);
    expect(hubFilterList(7)).toEqual([7]);
    expect(hubFilterList('')).toEqual([]);
    expect(hubFilterList(undefined)).toEqual([]);
  });
});

describe('useHubTableSource row filters', () => {
  const client = (dataHubAction: jest.Mock) => ({ dataHubAction } as any);

  afterEach(() => {
    delete (fieldValues as any).account_id;
    delete (fieldValues as any).account_ids;
  });

  test('sends the resolved where clause with the read and omits it when unfiltered', async () => {
    Object.assign(fieldValues, { account_id: 'acme' });
    const dataHubAction = jest.fn(() => Promise.resolve([]));
    const filtered = element([equalsFilter]);
    const filteredClient = client(dataHubAction);
    renderHook(() =>
      useHubTableSource({
        element: filtered,
        client: filteredClient,
        enabled: true
      })
    );
    await waitFor(() =>
      expect(dataHubAction).toHaveBeenCalledWith({
        hubId: 'hub1',
        operation: 'get',
        verification: 'verified',
        where: [{ fieldId: 'account', value: 'acme' }]
      })
    );

    const plainAction = jest.fn(() => Promise.resolve([]));
    const plain = element([]);
    const plainClient = client(plainAction);
    renderHook(() =>
      useHubTableSource({ element: plain, client: plainClient, enabled: true })
    );
    await waitFor(() =>
      expect(plainAction).toHaveBeenCalledWith({
        hubId: 'hub1',
        operation: 'get',
        verification: 'verified'
      })
    );
  });

  test('reloads the rows when a compared field changes, and only then', async () => {
    Object.assign(fieldValues, { account_id: 'acme' });
    const dataHubAction = jest.fn(({ where }: any) =>
      Promise.resolve(
        where[0].value === 'acme'
          ? [{ id: 'e1', data: { account: 'acme' } }]
          : [{ id: 'e2', data: { account: 'globex' } }]
      )
    );
    const el = element([equalsFilter]);
    const c = client(dataHubAction);
    const { result, rerender } = renderHook(() =>
      useHubTableSource({ element: el, client: c, enabled: true })
    );
    await waitFor(() => expect(result.current.entryIds).toEqual(['e1']));
    expect(dataHubAction).toHaveBeenCalledTimes(1);

    // A render with the same field value must not refetch.
    rerender();
    await act(async () => {});
    expect(dataHubAction).toHaveBeenCalledTimes(1);

    Object.assign(fieldValues, { account_id: 'globex' });
    rerender();
    await waitFor(() => expect(result.current.entryIds).toEqual(['e2']));
    expect(dataHubAction).toHaveBeenCalledTimes(2);
    expect(dataHubAction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: [{ fieldId: 'account', value: 'globex' }]
      })
    );
  });
});
