import { renderHook, waitFor } from '@testing-library/react';

import {
  __clearVersionDocumentCache,
  clearLocalVersionArtifacts,
  prefetchVersionDocuments,
  registerLocalVersionArtifacts,
  useVersionDocument
} from './useVersionDocument';
import { DocxHistoryHost, DocxVersion } from './types';
import { contentHash, diffSession, normalizeForDiff } from './sfdtDiff';

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
  // Resolved versions are cached module-wide; clear it so each case starts from
  // a real fetch rather than a prior case's result.
  beforeEach(() => __clearVersionDocumentCache());

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

  it('serves a re-opened version from cache without re-fetching', async () => {
    const sfdt = '{"sfdt":"cached"}';
    const fetchVersionFile = jest
      .fn()
      .mockResolvedValue(new TextEncoder().encode(sfdt).buffer);
    const h = host({ fetchVersionFile });
    const ver = version({ id: 'cachial', final_sfdt: 'u' });

    const first = renderHook(() => useVersionDocument(h, ver));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(fetchVersionFile).toHaveBeenCalledTimes(1);
    first.unmount();

    // Re-opening the same version resolves from cache — no second fetch.
    const second = renderHook(() => useVersionDocument(h, ver));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.sfdt).toBe(sfdt);
    expect(fetchVersionFile).toHaveBeenCalledTimes(1);
  });

  it('warms immutable previews before they are selected', async () => {
    const fetchVersionFile = jest
      .fn()
      .mockResolvedValue(new TextEncoder().encode('{"sfdt":"warm"}').buffer);
    const h = host({ fetchVersionFile });
    const ver = version({ id: 'warm', final_sfdt: 'warm-file' });

    await prefetchVersionDocuments(h, [ver]);
    const selected = renderHook(() => useVersionDocument(h, ver));
    await waitFor(() => expect(selected.result.current.loading).toBe(false));
    expect(selected.result.current.sfdt).toBe('{"sfdt":"warm"}');
    expect(fetchVersionFile).toHaveBeenCalledTimes(1);
  });

  it('does not reuse an artifact cache entry after a same-id payload refresh', async () => {
    const fetchVersionFile = jest.fn((url: string) =>
      Promise.resolve(new TextEncoder().encode(`{"sfdt":"${url}"}`).buffer)
    );
    const h = host({ fetchVersionFile });
    const firstVersion = version({ id: 'refreshed', final_sfdt: 'first' });
    const first = renderHook(() => useVersionDocument(h, firstVersion));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    const refreshed = version({ id: 'refreshed', final_sfdt: 'second' });
    const second = renderHook(() => useVersionDocument(h, refreshed));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.sfdt).toContain('second');
    expect(fetchVersionFile).toHaveBeenCalledTimes(2);
  });

  it('re-fetches a Current row when its saved document changes at the same id', async () => {
    const fetchVersionFile = jest.fn((url: string) =>
      Promise.resolve(new TextEncoder().encode(`{"sfdt":"${url}"}`).buffer)
    );
    const h = host({ fetchVersionFile });
    const checkpoint = version({ is_current: true, final_sfdt: 'checkpoint' });
    const first = renderHook(() => useVersionDocument(h, checkpoint));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(first.result.current.sfdt).toContain('checkpoint');
    first.unmount();

    const saved = version({ is_current: true, final_sfdt: 'closed' });
    const closed = renderHook(() => useVersionDocument(h, saved));
    await waitFor(() => expect(closed.result.current.loading).toBe(false));
    expect(closed.result.current.sfdt).toContain('closed');
    expect(fetchVersionFile).toHaveBeenCalledTimes(2);
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
      authors: ['you'],
      confirmed: true
    });
    const fetchVersionFile = jest.fn((url: string) =>
      Promise.resolve(buf(url === 'chg' ? changes : FINAL))
    );
    const h = host({ fetchVersionFile });
    const ver = version({ final_sfdt: 'fin', changes: 'chg', change_count: 2 });
    const { result } = renderHook(() => useVersionDocument(h, ver));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.degraded).toBe(false);
    // editCount counts EDIT GROUPS in the display document (one hunk here),
    // not the stored changeCount — a replace or a whole Robin turn counts once.
    expect(result.current.editCount).toBe(1);
    expect(result.current.formatCount).toBe(1);
    expect(result.current.approvedCount).toBe(1);
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

  it('checks the fetched document itself even when metadata hashes agree', async () => {
    const original = JSON.parse(FINAL);
    const changes = diffSession(
      { sections: [] },
      [{ sfdt: original, author: 'robin' }],
      's'
    );
    const different = JSON.stringify({
      sections: [{ blocks: [{ inlines: [{ text: 'Different document' }] }] }]
    });
    const fetchVersionFile = jest.fn((url: string) =>
      Promise.resolve(buf(url === 'chg' ? JSON.stringify(changes) : different))
    );
    const h = host({ fetchVersionFile });
    const ver = version({
      final_sfdt: 'fin',
      changes: 'chg',
      change_count: 1,
      final_sha256: contentHash(normalizeForDiff(original))
    });
    const { result } = renderHook(() => useVersionDocument(h, ver));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.degraded).toBe(true);
    expect(result.current.sfdt).toBe(different);
    expect(result.current.editCount).toBeUndefined();
  });

  it('retries a temporarily unavailable change list when a version is reopened', async () => {
    const changes = diffSession(
      { sections: [] },
      [{ sfdt: JSON.parse(FINAL), author: 'you' }],
      's'
    );
    let fail = true;
    const fetchVersionFile = jest.fn((url: string) =>
      url === 'chg' && fail
        ? Promise.reject(new Error('temporary failure'))
        : Promise.resolve(buf(url === 'chg' ? JSON.stringify(changes) : FINAL))
    );
    const h = host({ fetchVersionFile });
    const ver = version({ final_sfdt: 'fin', changes: 'chg', change_count: 1 });
    const first = renderHook(() => useVersionDocument(h, ver));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(first.result.current.degraded).toBe(true);
    first.unmount();
    fail = false;
    const second = renderHook(() => useVersionDocument(h, ver));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.degraded).toBe(false);
  });

  it('uses the local closing snapshot even if the row already has older checkpoint artifacts', async () => {
    const ver = version({
      session_id: 'local-close',
      final_sfdt: 'older-final',
      changes: 'older-changes',
      change_count: 1
    });
    const final = JSON.parse(FINAL);
    const changes = diffSession(
      { sections: [] },
      [{ sfdt: final, author: 'you' }],
      'local-close'
    );
    registerLocalVersionArtifacts('local-close', { finalSfdt: FINAL, changes });
    const h = host();
    const { result } = renderHook(() => useVersionDocument(h, ver));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(false);
    expect(result.current.degraded).toBe(false);
    expect(h.fetchVersionFile).not.toHaveBeenCalled();
  });

  it('moves native tracked-row marks onto cell content in the plain view', async () => {
    // A restored version's SFDT can carry a live tracked table insert. Row-level
    // marks paint a wash across whole rows; the plain view must repaint them as
    // cell-content marks like a regular version.
    const finalSfdt = JSON.stringify({
      sections: [
        {
          blocks: [
            {
              tableFormat: {},
              rows: [
                {
                  rowFormat: { revisionIds: ['sync-1'] },
                  cells: [
                    {
                      cellFormat: {},
                      blocks: [{ inlines: [{ text: 'Cell text' }] }]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ],
      revisions: [
        {
          revisionId: 'sync-1',
          revisionType: 'Insertion',
          author: 'Robin',
          customData: JSON.stringify({ source: 'robin', group: 'g1' })
        }
      ]
    });
    const fetchVersionFile = jest
      .fn()
      .mockResolvedValue(new TextEncoder().encode(finalSfdt).buffer);
    const h = host({ fetchVersionFile });
    const ver = version({ final_sfdt: 'restored' });
    const { result } = renderHook(() => useVersionDocument(h, ver));

    await waitFor(() => expect(result.current.loading).toBe(false));
    const doc = JSON.parse(result.current.sfdt!);
    const tableRow = doc.sections[0].blocks[0].rows[0];
    expect(tableRow.rowFormat.revisionIds).toBeUndefined();
    const cellPara = tableRow.cells[0].blocks[0];
    expect(cellPara.inlines[0].revisionIds).toEqual(['sync-1']);
    expect(cellPara.characterFormat.revisionIds).toContain('sync-1');
    // The revision record itself survives, so the renderer still colors it.
    expect(doc.revisions[0].revisionId).toBe('sync-1');
  });

  // A close whose artifact upload is deferred (restore) or still in flight has
  // no final_sfdt on the backend row yet. The registered in-memory snapshot
  // must serve the viewer instead of the raw control-bearing docx fallback.
  it('serves registered local artifacts instead of the docx fallback', async () => {
    const changes = {
      v: 1,
      sessionId: 's1',
      final_sha256: '',
      hunks: [
        {
          id: 1,
          author: 'you',
          type: 'ins',
          at: { block: [0, 'blocks', 0], offset: 0, length: 2 }
        }
      ],
      changeCount: 1,
      formatChangeCount: 0,
      authors: ['you']
    } as any;
    registerLocalVersionArtifacts('s1', { finalSfdt: FINAL, changes });
    const h = host();
    const ver = version({ editor_file: 'editor.docx', file: 'public.docx' });
    const { result } = renderHook(() => useVersionDocument(h, ver));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.docxUrl).toBeUndefined();
    expect(result.current.degraded).toBe(false);
    expect(result.current.sfdt).toContain('revisionId');
    expect(h.fetchVersionFile).not.toHaveBeenCalled();
  });

  it('outranks a cached degraded prefetch and clears only a matching snapshot', async () => {
    const h = host();
    const ver = version({ editor_file: 'editor.docx' });
    // Prefetch caches the degraded docx fallback before the close registers.
    await prefetchVersionDocuments(h, [ver]);
    registerLocalVersionArtifacts('s1', { finalSfdt: FINAL });

    const local = renderHook(() => useVersionDocument(h, ver));
    await waitFor(() => expect(local.result.current.loading).toBe(false));
    expect(local.result.current.sfdt).toBe(FINAL);
    local.unmount();

    // A different snapshot's clear (an older checkpoint completing) is ignored.
    clearLocalVersionArtifacts('s1', '{"other":1}');
    const kept = renderHook(() => useVersionDocument(h, ver));
    await waitFor(() => expect(kept.result.current.loading).toBe(false));
    expect(kept.result.current.sfdt).toBe(FINAL);
    kept.unmount();

    // The matching clear (this close's upload landed) releases it: the row is
    // resolved normally again (here, back to its docx fallback).
    clearLocalVersionArtifacts('s1', FINAL);
    const released = renderHook(() => useVersionDocument(h, ver));
    await waitFor(() => expect(released.result.current.loading).toBe(false));
    expect(released.result.current.docxUrl).toBe('editor.docx');
  });
});
