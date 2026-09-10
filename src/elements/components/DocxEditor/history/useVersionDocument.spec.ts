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

  const buf = (s: string) => new TextEncoder().encode(s).buffer;
  const FINAL = JSON.stringify({
    sections: [{ blocks: [{ inlines: [{ text: 'hi' }] }] }]
  });

  it('applies hunks and reports highlights available when a change list is present', async () => {
    const changes = JSON.stringify({
      v: 1,
      sessionId: 's',
      final_sha256: '',
      // A real inline insertion over "hi" (sections[0].blocks[0], offset 0..2).
      hunks: [
        {
          id: 1,
          author: 'you',
          type: 'ins',
          at: { block: [0, 'blocks', 0], offset: 0, length: 2 }
        }
      ],
      changeCount: 2,
      formatChangeCount: 1,
      authors: ['you']
    });
    const fetchVersionFile = jest.fn((url: string) =>
      Promise.resolve(buf(url === 'chg' ? changes : FINAL))
    );
    const h = host({ fetchVersionFile });
    const ver = version({ final_sfdt: 'fin', changes: 'chg', change_count: 2 });
    const { result } = renderHook(() => useVersionDocument(h, ver));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.degraded).toBe(false);
    expect(result.current.editCount).toBe(2);
    expect(result.current.formatCount).toBe(1);
    expect(result.current.sfdt).toContain('sections');
    // The applied hunk produced a synthetic revision to render.
    expect(result.current.sfdt).toContain('revisionId');
  });

  it('degrades to the plain document when the change list has no hunks', async () => {
    const changes = JSON.stringify({
      v: 1,
      sessionId: 's',
      final_sha256: '',
      hunks: [],
      changeCount: 0,
      formatChangeCount: 0,
      authors: ['you']
    });
    const fetchVersionFile = jest.fn((url: string) =>
      Promise.resolve(buf(url === 'chg' ? changes : FINAL))
    );
    const h = host({ fetchVersionFile });
    const ver = version({ final_sfdt: 'fin', changes: 'chg', change_count: 0 });
    const { result } = renderHook(() => useVersionDocument(h, ver));

    await waitFor(() => expect(result.current.loading).toBe(false));
    // No hunks → nothing to highlight → plain, degraded view (not a false
    // "highlights on" that paints nothing).
    expect(result.current.degraded).toBe(true);
    expect(result.current.sfdt).toContain('sections');
  });

  it('degrades to the plain document on a change-list hash mismatch', async () => {
    const changes = JSON.stringify({
      v: 1,
      sessionId: 's',
      final_sha256: 'AAA',
      hunks: [],
      changeCount: 1,
      formatChangeCount: 0,
      authors: ['you']
    });
    const fetchVersionFile = jest.fn((url: string) =>
      Promise.resolve(buf(url === 'chg' ? changes : FINAL))
    );
    const h = host({ fetchVersionFile });
    const ver = version({
      final_sfdt: 'fin',
      changes: 'chg',
      change_count: 1,
      final_sha256: 'BBB' // != the change list's hash
    });
    const { result } = renderHook(() => useVersionDocument(h, ver));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.degraded).toBe(true);
    expect(result.current.sfdt).toBe(FINAL);
  });
});
