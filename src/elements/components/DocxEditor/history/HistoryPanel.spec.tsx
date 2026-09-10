import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';

import HistoryPanel from './HistoryPanel';
import { DocxHistoryHost, DocxVersion, VersionAuthor } from './types';

const YOU: VersionAuthor = { kind: 'user', key: 'you', label: 'You' };

let seq = 0;
const v = (over: Partial<DocxVersion> = {}): DocxVersion => {
  seq += 1;
  const iso = over.ended_at ?? '2026-09-02T12:00:00Z';
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
  onVersionsLoaded?: any
) =>
  render(
    <HistoryPanel
      host={host}
      currentUser={YOU}
      onSelect={onSelect}
      onVersionsLoaded={onVersionsLoaded}
    />
  );

beforeEach(() => {
  seq = 0;
});

describe('HistoryPanel', () => {
  it('shows the empty state when there are no versions', async () => {
    const { findByText } = renderPanel(makeHost([]));
    expect(await findByText('No versions yet.')).toBeTruthy();
  });

  it('shows an avatar for the baseline version even with no authors', async () => {
    // The baseline (initial upload) has an empty authors list; it must still
    // render an avatar (falls back to the current viewer's "Y").
    const host = makeHost([
      v({ name: 'Baseline', seq: 0, authors: [] as any })
    ]);
    const { findByText, getByTitle } = renderPanel(host);
    await findByText('Baseline');
    expect(getByTitle('You')).toBeTruthy();
  });

  it('lists versions under a month header and tags the newest Current', async () => {
    // Past-year dates so labels are stable ('Month Year') regardless of today.
    const host = makeHost([
      v({ name: 'Latest', seq: 3, ended_at: '2020-09-05T09:00:00Z' }),
      v({ name: 'Draft', seq: 2, ended_at: '2020-08-10T09:00:00Z' })
    ]);
    const { findByText, getByText } = renderPanel(host);

    expect(await findByText('Latest')).toBeTruthy();
    expect(getByText('September 2020')).toBeTruthy();
    expect(getByText('August 2020')).toBeTruthy();
    // The highest-seq version is Current.
    expect(getByText('Current')).toBeTruthy();
  });

  it('lists every version as its own flat row (no clustering/expand)', async () => {
    const host = makeHost([
      v({ name: 'Recent', seq: 2, ended_at: '2026-09-02T12:00:00Z' }),
      v({ name: 'FiveMinsBefore', seq: 1, ended_at: '2026-09-02T11:55:00Z' })
    ]);
    const { findByText, queryByLabelText } = renderPanel(host);

    // Both close-in-time versions are visible at once — no expand affordance.
    expect(await findByText('Recent')).toBeTruthy();
    expect(await findByText('FiveMinsBefore')).toBeTruthy();
    expect(queryByLabelText('Expand')).toBeNull();
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
      ended_at: '2026-08-10T12:00:00Z'
    });
    const host = makeHost([v({ name: 'Current one', seq: 2 }), older]);
    const { findByText, queryByLabelText } = renderPanel(host);

    await findByText('Old name');
    expect(queryByLabelText('Rename version')).toBeNull();
  });

  it('reports the loaded versions up for auto-selecting the latest', async () => {
    const rows = [v({ name: 'Current one', seq: 2 }), v({ name: 'Older', seq: 1 })];
    const host = makeHost(rows);
    const onVersionsLoaded = jest.fn();
    const { findByText } = renderPanel(host, undefined, onVersionsLoaded);

    await findByText('Current one');
    expect(onVersionsLoaded).toHaveBeenCalledWith(rows);
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
