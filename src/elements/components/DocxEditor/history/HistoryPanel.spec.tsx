import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';

import HistoryPanel from './HistoryPanel';
import {
  DocxHistoryHost,
  DocxVersion,
  LiveSessionAuthors,
  VersionAuthor
} from './types';

const YOU: VersionAuthor = { kind: 'user', key: 'you', label: 'You' };

let seq = 0;
const v = (over: Partial<DocxVersion> = {}): DocxVersion => {
  seq += 1;
  const iso = over.ended_at ?? '2026-09-02T12:00:00';
  return {
    id: `v${seq}`,
    session_id: `s${seq}`,
    seq,
    is_baseline: false,
    is_current: false,
    name: '',
    started_at: iso,
    ended_at: iso,
    closed_at: iso,
    authors: [{ kind: 'user', label: 'You' }],
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
    created_at: iso,
    ...over
  };
};

const makeHost = (rows: DocxVersion[]): jest.Mocked<DocxHistoryHost> => ({
  listVersions: jest.fn().mockResolvedValue(rows),
  closeVersion: jest.fn().mockResolvedValue(null),
  fetchVersionFile: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
  restoreVersion: jest.fn().mockResolvedValue(undefined),
  renameVersion: jest.fn()
});

const renderPanel = (
  host: DocxHistoryHost,
  onSelect?: any,
  onVersionsLoaded?: any,
  liveSessionAuthors?: LiveSessionAuthors
) =>
  render(
    <HistoryPanel
      host={host}
      currentUser={YOU}
      onSelect={onSelect}
      onVersionsLoaded={onVersionsLoaded}
      liveSessionAuthors={liveSessionAuthors}
    />
  );

beforeEach(() => {
  seq = 0;
});

describe('HistoryPanel', () => {
  it('shows a zero-edit restore and the preceding edit as separate selectable rows', async () => {
    const prior = v({
      seq: 1,
      ended_at: '2026-09-02T11:59:00',
      change_count: 1,
      changes: '/changes.gz'
    });
    const restored = v({
      seq: 2,
      is_current: true,
      restored_from: 'original',
      restored_from_at: '2026-09-02T11:58:00',
      change_count: 0
    });
    const onSelect = jest.fn();
    const { findByText, queryByRole } = renderPanel(
      makeHost([restored, prior]),
      onSelect
    );
    fireEvent.click(await findByText(/^Restored from /));
    expect(onSelect).toHaveBeenLastCalledWith(restored);
    expect(queryByRole('button', { name: /earlier version/ })).toBeNull();
    fireEvent.click(await findByText('You'));
    expect(onSelect).toHaveBeenLastCalledWith(prior);
  });

  it('shows the empty state when there are no versions', async () => {
    const { findByText } = renderPanel(makeHost([]));
    expect(await findByText('No versions yet.')).toBeTruthy();
  });

  it('labels an authorless baseline as the original document, not an edit by the viewer', async () => {
    const host = makeHost([
      v({
        name: '',
        seq: 0,
        is_baseline: true,
        ended_at: '2026-09-14T20:17:01',
        authors: []
      })
    ]);
    const { findByText, queryByTitle } = renderPanel(host);
    await findByText('Original document');
    expect(queryByTitle('You')).toBeNull();
  });

  it('uses the backend-resolved actor identity for a collaborator version', async () => {
    const host = makeHost([
      v({
        authors: [{ kind: 'user', label: 'You' }],
        actor_label: 'a@x.co',
        changes: '/changes.gz',
        change_count: 1
      })
    ]);
    const { findByText, getByTitle } = renderPanel(host);
    await findByText('a@x.co');
    expect(getByTitle('a@x.co')).toBeTruthy();
  });

  it('does not show a session-activity avatar without saved tracked changes', async () => {
    const host = makeHost([
      v({
        name: 'Activity only',
        authors: [{ kind: 'user', label: 'You' }],
        changes: null,
        change_count: null
      })
    ]);
    const { findByText, queryByTitle } = renderPanel(host);
    await findByText('Activity only');
    expect(queryByTitle('You')).toBeNull();
  });

  it('shows the human author on the open Just now version before a Robin checkpoint', async () => {
    const host = makeHost([
      v({
        is_current: true,
        session_id: 'live-session',
        closed_at: null,
        ended_at: new Date().toISOString(),
        authors: [{ kind: 'user', label: 'You' }]
      })
    ]);
    const { findByText, queryByTitle } = renderPanel(
      host,
      undefined,
      undefined,
      {
        sessionId: 'live-session',
        authors: [YOU]
      }
    );
    await findByText('Just now');
    expect(queryByTitle('You')).not.toBeNull();
  });

  it('prefers live surviving authors over a stale checkpoint, including undoing all edits', async () => {
    const row = v({
      name: 'Live session',
      is_current: true,
      closed_at: null,
      changes: '/older-checkpoint.gz',
      change_count: 1,
      authors: [{ kind: 'assistant', label: 'Robin' }]
    });
    const host = makeHost([row]);
    const view = renderPanel(host, undefined, undefined, {
      sessionId: row.session_id as string,
      authors: [YOU]
    });
    await view.findByText('Live session');
    expect(view.queryByTitle('You')).not.toBeNull();
    expect(view.queryByTitle('Robin')).toBeNull();
    view.rerender(
      <HistoryPanel
        host={host}
        currentUser={YOU}
        liveSessionAuthors={{
          sessionId: row.session_id as string,
          authors: []
        }}
      />
    );
    expect(view.queryByTitle('You')).toBeNull();
    expect(view.queryByTitle('Robin')).toBeNull();
  });

  it('names each person in a folded row', async () => {
    const edited = { changes: '/changes.gz', change_count: 1 };
    const host = makeHost([
      v({
        name: 'Recent',
        seq: 2,
        ended_at: '2026-09-02T12:00:00',
        actor_name: 'Bob',
        ...edited
      }),
      v({
        seq: 1,
        ended_at: '2026-09-02T11:50:00',
        actor_name: 'Alice',
        ...edited
      })
    ]);
    const view = renderPanel(host);
    await view.findByText('Recent');
    expect(view.queryByTitle('Bob')).not.toBeNull();
    expect(view.queryByTitle('Alice')).not.toBeNull();
  });

  it('keeps folded authors while the live session heads the row', async () => {
    const host = makeHost([
      v({
        name: 'Live session',
        seq: 2,
        session_id: 'live',
        is_current: true,
        closed_at: null,
        ended_at: '2026-09-02T12:05:00'
      }),
      v({
        seq: 1,
        ended_at: '2026-09-02T11:55:00',
        authors: [{ kind: 'assistant', label: 'Robin' }],
        changes: '/changes.gz',
        change_count: 1
      })
    ]);
    const view = renderPanel(host, undefined, undefined, {
      sessionId: 'live',
      authors: [YOU]
    });
    await view.findByText('Live session');
    expect(view.queryByTitle('You')).not.toBeNull();
    expect(view.queryByTitle('Robin')).not.toBeNull();
  });

  it('does not apply live attribution to a different session or a closed version', async () => {
    const host = makeHost([
      v({ name: 'Other session', is_current: true, closed_at: null }),
      v({ name: 'Closed session', session_id: 'live-session' })
    ]);
    const view = renderPanel(host, undefined, undefined, {
      sessionId: 'live-session',
      authors: [YOU]
    });
    await view.findByText('Other session');
    expect(view.queryByTitle('You')).toBeNull();
  });

  it('shows only authors with surviving edits on a closed version', async () => {
    const host = makeHost([
      v({
        name: 'Table insertion',
        authors: [{ kind: 'assistant', label: 'Robin' }],
        changes: '/changes.gz',
        change_count: 15
      })
    ]);
    const { findByText, queryByTitle, getByText } = renderPanel(host);
    await findByText('Table insertion');
    expect(getByText('Robin')).toBeTruthy();
    expect(queryByTitle('You')).toBeNull();
  });

  it('keeps saved attribution visible when detailed highlights are unavailable', async () => {
    const host = makeHost([
      v({
        name: 'Saved without diff',
        final_sfdt: '/final.gz',
        changes: null,
        change_count: null,
        authors: [
          { kind: 'user', label: 'You' },
          { kind: 'assistant', label: 'Robin' }
        ]
      })
    ]);
    const { findByText, getByTitle } = renderPanel(host);
    await findByText('Saved without diff');
    expect(getByTitle('You')).toBeTruthy();
    expect(getByTitle('Robin')).toBeTruthy();
  });

  it('lists versions under a month header and tags the newest Current', async () => {
    // Past-year dates so labels are stable ('Month Year') regardless of today.
    const host = makeHost([
      v({ name: 'Latest', seq: 3, ended_at: '2020-09-05T09:00:00' }),
      v({ name: 'Draft', seq: 2, ended_at: '2020-08-10T09:00:00' })
    ]);
    const { findByText, getByText } = renderPanel(host);

    expect(await findByText('Latest')).toBeTruthy();
    expect(getByText('September 2020')).toBeTruthy();
    expect(getByText('August 2020')).toBeTruthy();
    // The highest-seq version is Current.
    expect(getByText('Current')).toBeTruthy();
  });

  // Newest heads the row; two plain sessions 5 and 10 minutes earlier fold.
  const clusterRows = () => [
    v({ name: 'Recent', seq: 3, ended_at: '2026-09-02T12:00:00' }),
    v({ seq: 2, ended_at: '2026-09-02T11:55:00' }),
    v({ seq: 1, ended_at: '2026-09-02T11:50:00' })
  ];
  const timeOf = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit'
    });

  it('folds sessions within 15 minutes behind a collapsed chevron', async () => {
    const { findByText, getByRole, queryByText } = renderPanel(
      makeHost(clusterRows())
    );
    expect(await findByText('Recent')).toBeTruthy();
    const chevron = getByRole('button', { name: 'Expand 2 earlier versions' });
    expect(chevron.getAttribute('aria-expanded')).toBe('false');
    expect(queryByText(timeOf('2026-09-02T11:55:00'), { exact: false })).toBe(
      null
    );
  });

  it('expands to time-only rows and toggles aria-expanded', async () => {
    const { findByText, getByRole, getAllByText, queryByText } = renderPanel(
      makeHost(clusterRows())
    );
    await findByText('Recent');
    fireEvent.click(getByRole('button', { name: 'Expand 2 earlier versions' }));

    const collapse = getByRole('button', {
      name: 'Collapse 2 earlier versions'
    });
    expect(collapse.getAttribute('aria-expanded')).toBe('true');
    // Inner rows carry the time only: no avatars or author names.
    const inner = getAllByText(timeOf('2026-09-02T11:55:00'), {
      exact: false
    });
    expect(inner).toHaveLength(1);
    expect(inner[0].textContent).toMatch(/^September 2, /);
    expect(inner[0].querySelector('[title]')).toBeNull();

    fireEvent.click(collapse);
    expect(queryByText(timeOf('2026-09-02T11:55:00'), { exact: false })).toBe(
      null
    );
  });

  it('opens a folded version when its row is clicked', async () => {
    const onSelect = jest.fn();
    const rows = clusterRows();
    const { findByText, getByRole, getByText } = renderPanel(
      makeHost(rows),
      onSelect
    );
    await findByText('Recent');
    fireEvent.click(getByRole('button', { name: 'Expand 2 earlier versions' }));
    // Toggling the chevron does not open the cluster's head version.
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(getByText(timeOf('2026-09-02T11:50:00'), { exact: false }));
    expect(onSelect).toHaveBeenCalledWith(rows[2]);
  });

  it('keeps sessions more than 15 minutes apart as separate rows', async () => {
    const host = makeHost([
      v({ name: 'Recent', seq: 2, ended_at: '2026-09-02T12:00:00' }),
      v({ seq: 1, ended_at: '2026-09-02T11:40:00' })
    ]);
    const { findByText, queryByRole, getByText } = renderPanel(host);
    await findByText('Recent');
    expect(queryByRole('button', { name: /earlier version/ })).toBeNull();
    expect(
      getByText(timeOf('2026-09-02T11:40:00'), { exact: false })
    ).toBeTruthy();
  });

  it('calls onSelect when a version row is clicked', async () => {
    const onSelect = jest.fn();
    const host = makeHost([v({ name: 'Pick me', seq: 1 })]);
    const { findByText } = renderPanel(host, onSelect);

    fireEvent.click(await findByText('Pick me'));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Pick me' })
    );
  });

  it('offers no rename affordance on version rows', async () => {
    const older = v({
      name: 'Old name',
      seq: 1,
      ended_at: '2026-08-10T12:00:00'
    });
    const host = makeHost([v({ name: 'Current one', seq: 2 }), older]);
    const { findByText, queryByLabelText } = renderPanel(host);

    await findByText('Old name');
    expect(queryByLabelText('Rename version')).toBeNull();
  });

  it('reports the loaded versions up for auto-selecting the latest', async () => {
    const rows = [
      v({ name: 'Current one', seq: 2 }),
      v({ name: 'Older', seq: 1 })
    ];
    const host = makeHost(rows);
    const onVersionsLoaded = jest.fn();
    const { findByText } = renderPanel(host, undefined, onVersionsLoaded);

    await findByText('Current one');
    expect(onVersionsLoaded).toHaveBeenCalledWith(rows);
  });

  it('refetches behind the cached rows when reopened with the same refresh key', async () => {
    const host = makeHost([v({ name: 'Stale', seq: 1 })]);
    const panel = (active: boolean) => (
      <HistoryPanel
        host={host}
        currentUser={YOU}
        active={active}
        refreshKey='k'
      />
    );
    const view = render(panel(true));
    await view.findByText('Stale');
    view.rerender(panel(false));
    host.listVersions.mockRejectedValueOnce(new Error('offline'));
    view.rerender(panel(true));
    // A failed revalidation keeps the cached rows instead of the error state
    await waitFor(() => expect(host.listVersions).toHaveBeenCalledTimes(2));
    await act(async () => {}); // let the rejection settle
    expect(view.getByText('Stale')).toBeTruthy();
    expect(view.queryByText('Couldn’t load version history.')).toBeNull();
    host.listVersions.mockResolvedValueOnce([v({ name: 'Fresh', seq: 2 })]);
    view.rerender(panel(false));
    view.rerender(panel(true));
    expect(await view.findByText('Fresh')).toBeTruthy();
    expect(view.queryByText('Stale')).toBeNull();
  });

  it('shows a retry on load failure', async () => {
    const host = makeHost([]);
    host.listVersions
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce([v({ name: 'Back', seq: 1 })]);
    const { findByText, getByText } = renderPanel(host);

    expect(await findByText('Couldn’t load version history.')).toBeTruthy();
    fireEvent.click(getByText('Retry'));
    expect(await findByText('Back')).toBeTruthy();
  });
});
