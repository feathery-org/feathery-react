import { act, renderHook, waitFor } from '@testing-library/react';
import { fieldValues } from '../../../../utils/init';
import { useHubTableSource } from '../useHubTableSource';

const HUBS = [
  { id: 'hub-people', key: 'people', fields: [] },
  { id: 'hub-orgs', key: 'orgs', fields: [] }
];

const element = {
  id: 'table1',
  properties: {
    columns: [],
    hub_id: '',
    hub_dynamic: true,
    hub_id_field_key: 'which_hub'
  }
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

const schemaFor = (ref: string) => ({
  hubs: HUBS.filter((h) => h.id === ref || h.key === ref)
});

const entriesFor = (hubId: string) => [
  { id: hubId === 'hub-people' ? 'e-people' : 'e-orgs', data: {} }
];

describe('useHubTableSource - hub chosen by hidden field', () => {
  afterEach(() => {
    delete (fieldValues as any).which_hub;
  });

  test('a slower load for the previous hub does not replace the current one', async () => {
    (fieldValues as any).which_hub = 'orgs';
    const pending: Record<string, ReturnType<typeof deferred<any>>> = {};
    const getHubSchemas = jest.fn((ids: string[]) => {
      pending[ids[0]] = deferred<any>();
      return pending[ids[0]].promise;
    });
    const dataHubAction = jest.fn(({ hubId }: any) =>
      Promise.resolve(entriesFor(hubId))
    );
    const client = { dataHubAction, getHubSchemas };
    const { result, rerender } = renderHook(() =>
      useHubTableSource({ element, client, enabled: true })
    );
    await waitFor(() => expect(pending.orgs).toBeDefined());

    // The field changes while the first lookup is still in flight.
    (fieldValues as any).which_hub = 'people';
    rerender();
    await waitFor(() => expect(pending.people).toBeDefined());

    await act(async () => pending.people.resolve(schemaFor('people')));
    await waitFor(() => expect(result.current.entryIds).toEqual(['e-people']));

    // The old lookup answers last; it must be dropped.
    await act(async () => pending.orgs.resolve(schemaFor('orgs')));
    expect(result.current.entryIds).toEqual(['e-people']);
    expect(result.current.loading).toBe(false);
    expect(dataHubAction).not.toHaveBeenCalledWith(
      expect.objectContaining({ hubId: 'hub-orgs' })
    );
  });

  test('a hub change held back by pending edits is applied once they clear', async () => {
    (fieldValues as any).which_hub = 'orgs';
    const getHubSchemas = jest.fn((ids: string[]) =>
      Promise.resolve(schemaFor(ids[0]))
    );
    const dataHubAction = jest.fn(({ hubId }: any) =>
      Promise.resolve(entriesFor(hubId))
    );
    const client = { dataHubAction, getHubSchemas };
    const { result, rerender } = renderHook(
      ({ blockRefetch }: { blockRefetch: boolean }) =>
        useHubTableSource({ element, client, enabled: true, blockRefetch }),
      { initialProps: { blockRefetch: false } }
    );
    await waitFor(() => expect(result.current.entryIds).toEqual(['e-orgs']));

    // Edits are buffered: the new hub must not replace the rows yet.
    rerender({ blockRefetch: true });
    (fieldValues as any).which_hub = 'people';
    rerender({ blockRefetch: true });
    await act(async () => {});
    expect(result.current.entryIds).toEqual(['e-orgs']);

    // Saved: catch up with the hub the field now names.
    rerender({ blockRefetch: false });
    await waitFor(() => expect(result.current.entryIds).toEqual(['e-people']));
  });
});
