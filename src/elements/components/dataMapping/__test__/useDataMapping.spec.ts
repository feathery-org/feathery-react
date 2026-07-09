import { act, renderHook, waitFor } from '@testing-library/react';
import useDataMapping, {
  DataMappingClient,
  DataMappingModalConfig
} from '../useDataMapping';

const baseConfig: DataMappingModalConfig = {
  hubs: [{ hub_id: 'hub-1', excluded_field_ids: [] }]
};

const baseSchema = {
  id: 'hub-1',
  key: 'Clients',
  fields: [
    {
      id: 'f1',
      key: 'name',
      type: 'text',
      required: true,
      unique: false,
      metadata: {},
      constraint_rules: [],
      order: 0
    },
    {
      id: 'f2',
      key: 'email',
      type: 'email',
      required: false,
      unique: false,
      metadata: {},
      constraint_rules: [],
      order: 1
    },
    {
      id: 'f3',
      key: 'internal_id',
      type: 'text',
      required: false,
      unique: false,
      metadata: {},
      constraint_rules: [],
      order: 2
    }
  ]
};

const makeClient = (overrides: Partial<DataMappingClient> = {}) =>
  ({
    fetchHubSchemas: jest.fn().mockResolvedValue([baseSchema]),
    stagedHubAction: jest.fn().mockResolvedValue({ entries: [], errors: [] }),
    ...overrides
  } as DataMappingClient);

const makeCsvFile = (content: string, name = 'data.csv') =>
  new File([content], name, { type: 'text/csv' });

describe('useDataMapping', () => {
  it('mounts with no staged rows -> mode import', async () => {
    const client = makeClient();
    const { result } = renderHook(() => useDataMapping(baseConfig, client));

    expect(result.current.mode).toBe('loading');
    await waitFor(() => expect(result.current.mode).toBe('import'));

    expect(client.fetchHubSchemas).toHaveBeenCalledWith(['hub-1']);
    expect(client.stagedHubAction).toHaveBeenCalledWith({
      hubId: 'hub-1',
      operation: 'get_staged'
    });
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].hubKey).toBe('Clients');
  });

  it('mounts with staged rows -> mode review', async () => {
    const client = makeClient({
      stagedHubAction: jest.fn().mockResolvedValue({
        entries: [{ entry_id: 'e1', data: { name: 'Ann' } }],
        errors: []
      })
    });
    const { result } = renderHook(() => useDataMapping(baseConfig, client));

    await waitFor(() => expect(result.current.mode).toBe('review'));
    expect(result.current.tabs[0].staged).toEqual([
      { entryId: 'e1', data: { name: 'Ann' } }
    ]);
  });

  it('excludes excluded_field_ids from tabs[0].fields', async () => {
    const config: DataMappingModalConfig = {
      hubs: [{ hub_id: 'hub-1', excluded_field_ids: ['f3'] }]
    };
    const client = makeClient();
    const { result } = renderHook(() => useDataMapping(config, client));

    await waitFor(() => expect(result.current.mode).toBe('import'));
    const keys = result.current.tabs[0].fields.map((f) => f.key);
    expect(keys).toEqual(['name', 'email']);
    expect(keys).not.toContain('internal_id');
  });

  it('loadFile auto-maps name/email headers case-insensitively', async () => {
    const client = makeClient();
    const { result } = renderHook(() => useDataMapping(baseConfig, client));
    await waitFor(() => expect(result.current.mode).toBe('import'));

    const file = makeCsvFile('NAME,Email\nAnn,ann@example.com\n');
    await act(async () => {
      await result.current.loadFile(file);
    });

    expect(result.current.parseError).toBeNull();
    expect(result.current.sheets).toHaveLength(1);
    expect(result.current.mapping.name).toEqual({
      sheetIndex: 0,
      header: 'NAME'
    });
    expect(result.current.mapping.email).toEqual({
      sheetIndex: 0,
      header: 'Email'
    });
  });

  it('sets parseError on unreadable file without throwing', async () => {
    const client = makeClient();
    const { result } = renderHook(() => useDataMapping(baseConfig, client));
    await waitFor(() => expect(result.current.mode).toBe('import'));

    // An empty file normalizes to zero sheets with headers -> treated as unreadable.
    const file = makeCsvFile('');
    await act(async () => {
      await result.current.loadFile(file);
    });

    expect(result.current.parseError).toBe(
      "Couldn't read this file. Please upload a valid CSV or Excel file."
    );
  });

  it('requiredUnmapped contains name until mapped; stageAll no-ops while non-empty', async () => {
    const client = makeClient();
    const { result } = renderHook(() => useDataMapping(baseConfig, client));
    await waitFor(() => expect(result.current.mode).toBe('import'));

    expect(result.current.requiredUnmapped).toEqual(['name']);

    await act(async () => {
      await result.current.stageAll();
    });

    // Only the mount-time get_staged call should have happened; stageAll made no calls.
    expect(client.stagedHubAction).toHaveBeenCalledTimes(1);
    expect(result.current.mode).toBe('import');

    act(() => {
      result.current.setFieldColumn('name', { sheetIndex: 0, header: 'Name' });
    });
    expect(result.current.requiredUnmapped).toEqual([]);
  });

  it('stageAll sends coerced rows and flips to review', async () => {
    const stagedHubAction = jest
      .fn()
      .mockResolvedValueOnce({ entries: [], errors: [] }) // mount get_staged
      .mockResolvedValueOnce({ entries: [{ row_index: 0 }], errors: [] }) // stage
      .mockResolvedValueOnce({
        entries: [{ entry_id: 'e1', data: { name: 'Ann' } }],
        errors: []
      }); // post-stage get_staged
    const client = makeClient({ stagedHubAction });
    const { result } = renderHook(() => useDataMapping(baseConfig, client));
    await waitFor(() => expect(result.current.mode).toBe('import'));

    const file = makeCsvFile('name\nAnn\n');
    await act(async () => {
      await result.current.loadFile(file);
    });
    expect(result.current.requiredUnmapped).toEqual([]);

    await act(async () => {
      await result.current.stageAll();
    });

    expect(stagedHubAction).toHaveBeenNthCalledWith(2, {
      hubId: 'hub-1',
      operation: 'stage',
      rows: [{ name: 'Ann' }]
    });
    expect(result.current.mode).toBe('review');
    expect(result.current.tabs[0].staged).toEqual([
      { entryId: 'e1', data: { name: 'Ann' } }
    ]);
  });

  it('stageAll client rejection -> mode stays import and requestError is set', async () => {
    const stagedHubAction = jest.fn()
      .mockResolvedValueOnce({ entries: [], errors: [] }) // mount get_staged
      .mockRejectedValueOnce(new Error('Network error')); // stage rejects
    const client = makeClient({ stagedHubAction });
    const { result } = renderHook(() => useDataMapping(baseConfig, client));
    await waitFor(() => expect(result.current.mode).toBe('import'));

    const file = makeCsvFile('name\nAnn\n');
    await act(async () => {
      await result.current.loadFile(file);
    });
    expect(result.current.requiredUnmapped).toEqual([]);

    await act(async () => {
      await result.current.stageAll();
    });

    expect(result.current.mode).toBe('import');
    expect(result.current.requestError).toBe(
      'Something went wrong. Your data is saved — try again.'
    );
  });

  it('finalizeAll returning errors keeps review mode with errors set', async () => {
    const stagedHubAction = jest.fn().mockImplementation((params) => {
      if (params.operation === 'get_staged') {
        return Promise.resolve({
          entries: [{ entry_id: 'e1', data: { name: 'Ann' } }],
          errors: []
        });
      }
      if (params.operation === 'finalize') {
        return Promise.resolve({
          errors: [{ entry_id: 'e1', field_key: 'name', message: 'Bad' }]
        });
      }
      return Promise.resolve({});
    });
    const client = makeClient({ stagedHubAction });
    const { result } = renderHook(() => useDataMapping(baseConfig, client));
    await waitFor(() => expect(result.current.mode).toBe('review'));

    let outcome: { ok: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.finalizeAll();
    });

    expect(outcome).toEqual({ ok: false });
    expect(result.current.mode).toBe('review');
    expect(result.current.tabs[0].errors).toEqual([
      { entry_id: 'e1', field_key: 'name', message: 'Bad' }
    ]);
  });

  it('finalizeAll with no errors resolves ok true', async () => {
    const stagedHubAction = jest.fn().mockImplementation((params) => {
      if (params.operation === 'get_staged') {
        return Promise.resolve({
          entries: [{ entry_id: 'e1', data: { name: 'Ann' } }],
          errors: []
        });
      }
      if (params.operation === 'finalize') {
        return Promise.resolve({ finalized_count: 1 });
      }
      return Promise.resolve({});
    });
    const client = makeClient({ stagedHubAction });
    const { result } = renderHook(() => useDataMapping(baseConfig, client));
    await waitFor(() => expect(result.current.mode).toBe('review'));

    let outcome: { ok: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.finalizeAll();
    });

    expect(outcome).toEqual({ ok: true });
  });

  it('schema fetch rejection -> mode error', async () => {
    const client = makeClient({
      fetchHubSchemas: jest.fn().mockRejectedValue(new Error('boom'))
    });
    const { result } = renderHook(() => useDataMapping(baseConfig, client));

    await waitFor(() => expect(result.current.mode).toBe('error'));
    expect(result.current.loadError).toBe('boom');
  });

  it('updateCell replaces row errors from response', async () => {
    const stagedHubAction = jest.fn().mockImplementation((params) => {
      if (params.operation === 'get_staged') {
        return Promise.resolve({
          entries: [{ entry_id: 'e1', data: { name: 'Ann' } }],
          errors: [{ entry_id: 'e1', field_key: 'name', message: 'Bad' }]
        });
      }
      if (params.operation === 'update_staged') {
        return Promise.resolve({
          entry_id: 'e1',
          data: { name: 'Ann Fixed' },
          errors: []
        });
      }
      return Promise.resolve({});
    });
    const client = makeClient({ stagedHubAction });
    const { result } = renderHook(() => useDataMapping(baseConfig, client));
    await waitFor(() => expect(result.current.mode).toBe('review'));
    expect(result.current.tabs[0].errors).toHaveLength(1);

    await act(async () => {
      await result.current.updateCell('hub-1', 'e1', 'name', 'Ann Fixed');
    });

    expect(stagedHubAction).toHaveBeenCalledWith({
      hubId: 'hub-1',
      operation: 'update_staged',
      entryId: 'e1',
      data: { name: 'Ann Fixed' }
    });
    expect(result.current.tabs[0].errors).toEqual([]);
    expect(result.current.tabs[0].staged[0].data.name).toBe('Ann Fixed');
  });

  it('manual selections are never overwritten by later auto-map runs', async () => {
    const client = makeClient();
    const { result } = renderHook(() => useDataMapping(baseConfig, client));
    await waitFor(() => expect(result.current.mode).toBe('import'));

    act(() => {
      result.current.setFieldColumn('name', {
        sheetIndex: 0,
        header: 'Custom'
      });
    });

    const file = makeCsvFile('name,email\nAnn,ann@example.com\n');
    await act(async () => {
      await result.current.loadFile(file);
    });

    expect(result.current.mapping.name).toEqual({
      sheetIndex: 0,
      header: 'Custom'
    });
    expect(result.current.mapping.email).toEqual({
      sheetIndex: 0,
      header: 'email'
    });
  });

  it('setFieldColumn(key, null) deletes the mapping', async () => {
    const client = makeClient();
    const { result } = renderHook(() => useDataMapping(baseConfig, client));
    await waitFor(() => expect(result.current.mode).toBe('import'));

    act(() => {
      result.current.setFieldColumn('name', { sheetIndex: 0, header: 'Name' });
    });
    expect(result.current.mapping.name).toBeDefined();

    act(() => {
      result.current.setFieldColumn('name', null);
    });
    expect(result.current.mapping.name).toBeUndefined();
  });
});
