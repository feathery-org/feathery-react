import { renderHook, waitFor } from '@testing-library/react';

import { useVersionDocument } from './useVersionDocument';
import { DocxHistoryHost, DocxVersion } from './types';

const version = (over: Partial<DocxVersion>): DocxVersion =>
  ({
    id: 'v1',
    session_id: 's1',
    seq: 1,
    is_baseline: false,
    is_current: false,
    name: '',
    started_at: '',
    ended_at: '',
    closed_at: '',
    authors: [],
    actor_label: '',
    actor_name: '',
    restored_from: null,
    restored_from_at: null,
    editor_file: null,
    file: null,
    final_sfdt: null,
    changes: null,
    change_count: null,
    format_change_count: null,
    final_sha256: '',
    highlights_pruned_at: null,
    created_at: '',
    ...over
  } as DocxVersion);

const host = (over: Partial<DocxHistoryHost> = {}): DocxHistoryHost => ({
  listVersions: jest.fn(),
  closeVersion: jest.fn(),
  fetchVersionFile: jest.fn(),
  restoreVersion: jest.fn(),
  renameVersion: jest.fn(),
  ...over
});

describe('useVersionDocument', () => {
  // The host and version MUST be stable identities across renders — the hook
  // keys its fetch effect on them. Create them once per test, never inside the
  // renderHook callback (that would re-fetch every render, an infinite loop).
  it('fetches and inflates the final SFDT when present', async () => {
    const sfdt = '{"sfdt":"hello"}';
    const fetchVersionFile = jest
      .fn()
      .mockResolvedValue(new TextEncoder().encode(sfdt).buffer);
    const h = host({ fetchVersionFile });
    const ver = version({ final_sfdt: 'u' });
    const { result } = renderHook(() => useVersionDocument(h, ver));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchVersionFile).toHaveBeenCalledWith('u');
    expect(result.current.sfdt).toBe(sfdt);
    expect(result.current.error).toBe(false);
  });

  it('falls back to the version’s docx URL when there is no final SFDT', async () => {
    const h = host();
    const ver = version({ editor_file: 'editor.docx', file: 'public.docx' });
    const { result } = renderHook(() => useVersionDocument(h, ver));

    await waitFor(() => expect(result.current.loading).toBe(false));
    // The control-bearing editor copy is preferred.
    expect(result.current.docxUrl).toBe('editor.docx');
    expect(result.current.sfdt).toBeUndefined();
  });

  it('reports an error when a version has no document at all', async () => {
    const h = host();
    const ver = version({});
    const { result } = renderHook(() => useVersionDocument(h, ver));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(true);
  });

  it('reports an error when the fetch fails', async () => {
    const fetchVersionFile = jest.fn().mockRejectedValue(new Error('network'));
    const h = host({ fetchVersionFile });
    const ver = version({ final_sfdt: 'u' });
    const { result } = renderHook(() => useVersionDocument(h, ver));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(true);
  });
});
