import { act, renderHook, waitFor } from '@testing-library/react';
import { fieldValues } from '../../utils/init';
import {
  dataDrivenContainers,
  fromHubValue,
  toHubValue,
  useHubEntrySync
} from '../hooks/useHubEntrySync';

const container = (overrides: Record<string, any> = {}) => ({
  id: 'details',
  properties: {
    hub_id: 'hub1',
    hub_entry_field_key: 'selected_entry',
    hub_bindings: [
      {
        hub_field_id: 'h1',
        hub_field_key: 'name',
        field_id: 'f1',
        field_type: 'servar',
        field_key: 'contact_name'
      },
      {
        hub_field_id: 'h2',
        hub_field_key: 'active',
        field_id: 'f2',
        field_type: 'servar',
        field_key: 'contact_active'
      }
    ],
    ...overrides
  }
});

const SERVAR_TYPES: Record<string, string> = {
  contact_name: 'text_field',
  contact_active: 'checkbox'
};

const makeClient = (entries: Record<string, any>) => ({
  dataHubAction: jest.fn(({ operation, where }: any): Promise<any> => {
    if (operation === 'get') {
      const entry = entries[where[0].entryId];
      return Promise.resolve(entry ? [entry] : []);
    }
    return Promise.resolve({ updated: 1 });
  }),
  submitCustom: jest.fn()
});

const renderSync = (step: any, client: any, onWriteError = jest.fn()) => {
  const updateFieldValues = jest.fn((values: Record<string, any>) =>
    Object.assign(fieldValues, values)
  );
  const hook = renderHook(() =>
    useHubEntrySync({
      step,
      client,
      updateFieldValues,
      servarTypeByKey: (key) => SERVAR_TYPES[key],
      onWriteError
    })
  );
  return { ...hook, updateFieldValues, onWriteError };
};

describe('useHubEntrySync', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    ['selected_entry', 'contact_name', 'contact_active'].forEach(
      (key) => delete (fieldValues as any)[key]
    );
  });

  test('dataDrivenContainers keeps only fully bound containers', () => {
    const step = {
      subgrids: [
        container(),
        container({ hub_id: '' }),
        container({ hub_entry_field_key: undefined }),
        container({ hub_bindings: [{ hub_field_key: 'x' }] }),
        { id: 'plain', properties: {} }
      ]
    };
    expect(dataDrivenContainers(step).map((c) => c.id)).toEqual(['details']);
  });

  test('loads the entry named by the entry field into the bound fields', async () => {
    (fieldValues as any).selected_entry = 'e1';
    const client = makeClient({
      e1: { id: 'e1', data: { name: 'Alice', active: true } }
    });
    const { updateFieldValues } = renderSync(
      { subgrids: [container()] },
      client
    );

    await waitFor(() =>
      expect(updateFieldValues).toHaveBeenCalledWith(
        { contact_name: 'Alice', contact_active: true },
        { clearErrors: false, triggerErrors: false }
      )
    );
    expect(client.dataHubAction).toHaveBeenCalledWith({
      hubId: 'hub1',
      operation: 'get',
      where: [{ entryId: 'e1' }]
    });
    expect(client.submitCustom).toHaveBeenCalledWith({
      contact_name: 'Alice',
      contact_active: true
    });
  });

  test('does nothing without an entry id, and reloads when it changes', async () => {
    const client = makeClient({
      e2: { id: 'e2', data: { name: 'Bob', active: false } }
    });
    const { rerender, updateFieldValues } = renderSync(
      { subgrids: [container()] },
      client
    );
    expect(client.dataHubAction).not.toHaveBeenCalled();

    (fieldValues as any).selected_entry = 'e2';
    rerender();
    await waitFor(() =>
      expect(updateFieldValues).toHaveBeenCalledWith(
        { contact_name: 'Bob', contact_active: false },
        expect.anything()
      )
    );
  });

  test('writes a bound field edit back to the entry, coalescing keystrokes', async () => {
    (fieldValues as any).selected_entry = 'e1';
    const client = makeClient({
      e1: { id: 'e1', data: { name: 'Alice', active: true } }
    });
    const { result } = renderSync({ subgrids: [container()] }, client);
    await waitFor(() => expect(client.dataHubAction).toHaveBeenCalledTimes(1));

    (fieldValues as any).contact_name = 'Ali';
    act(() => result.current.onFieldChange('contact_name'));
    (fieldValues as any).contact_name = 'Alicia';
    act(() => result.current.onFieldChange('contact_name'));
    // An unbound field is ignored.
    act(() => result.current.onFieldChange('something_else'));
    act(() => jest.advanceTimersByTime(300));

    await waitFor(() =>
      expect(client.dataHubAction).toHaveBeenCalledWith({
        hubId: 'hub1',
        operation: 'update',
        where: [{ entryId: 'e1' }],
        data: { name: 'Alicia' }
      })
    );
    expect(client.dataHubAction).toHaveBeenCalledTimes(2);
  });

  test('reports a rejected write against the field', async () => {
    (fieldValues as any).selected_entry = 'e1';
    const client = makeClient({ e1: { id: 'e1', data: { name: 'Alice' } } });
    client.dataHubAction.mockImplementation(({ operation }: any) =>
      operation === 'get'
        ? Promise.resolve([{ id: 'e1', data: { name: 'Alice' } }])
        : Promise.reject({ data: { error: 'Missing required fields' } })
    );
    const { result, onWriteError } = renderSync(
      { subgrids: [container()] },
      client
    );
    await waitFor(() => expect(client.dataHubAction).toHaveBeenCalledTimes(1));

    (fieldValues as any).contact_name = '';
    act(() => result.current.onFieldChange('contact_name'));
    act(() => jest.advanceTimersByTime(300));

    await waitFor(() =>
      expect(onWriteError).toHaveBeenCalledWith(
        'contact_name',
        'Missing required fields'
      )
    );
  });

  test('fields of an entry that did not load are never written', async () => {
    (fieldValues as any).selected_entry = 'missing';
    const client = makeClient({});
    const { result } = renderSync({ subgrids: [container()] }, client);
    await waitFor(() => expect(client.dataHubAction).toHaveBeenCalledTimes(1));

    (fieldValues as any).contact_name = 'x';
    act(() => result.current.onFieldChange('contact_name'));
    act(() => jest.advanceTimersByTime(300));
    await act(async () => {});
    expect(client.dataHubAction).toHaveBeenCalledTimes(1);
  });
});

describe('hub value conversions', () => {
  test('fromHubValue shapes values for the field type', () => {
    expect(fromHubValue(null, 'text_field')).toBe('');
    expect(fromHubValue('x', 'text_field')).toBe('x');
    expect(fromHubValue(1, 'checkbox')).toBe(true);
    expect(fromHubValue(undefined, 'checkbox')).toBe(false);
    expect(fromHubValue(3, 'integer_field')).toBe(3);
    expect(fromHubValue({ a: 1 }, 'text_field')).toBe('{"a":1}');
  });

  test('toHubValue shapes values for the hub column', () => {
    expect(toHubValue('', 'text_field')).toBeNull();
    expect(toHubValue('x', 'text_field')).toBe('x');
    expect(toHubValue('', 'checkbox')).toBe(false);
    expect(toHubValue(true, 'checkbox')).toBe(true);
    expect(toHubValue('12', 'integer_field')).toBe(12);
    expect(toHubValue('abc', 'integer_field')).toBeNull();
  });
});
