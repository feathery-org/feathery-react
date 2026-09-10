import React from 'react';
import { fireEvent, render } from '@testing-library/react';

import VersionBar from './VersionBar';
import { DocxVersion } from './types';

const version = (over: Partial<DocxVersion> = {}): DocxVersion =>
  ({
    id: 'v1',
    session_id: 's1',
    seq: 1,
    is_baseline: false,
    is_current: false,
    name: '',
    started_at: '2026-09-02T12:00:00Z',
    ended_at: '2026-09-02T12:00:00Z',
    closed_at: '2026-09-02T12:00:00Z',
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

describe('VersionBar', () => {
  it('shows the version name and exits on the back button', () => {
    const onExit = jest.fn();
    const { getByText, getByLabelText } = render(
      <VersionBar version={version({ name: 'Draft v2' })} onExit={onExit} />
    );
    expect(getByText('Draft v2')).toBeTruthy();
    fireEvent.click(getByLabelText('Back to current version'));
    expect(onExit).toHaveBeenCalled();
  });

  it('summarizes changes when highlights are available', () => {
    const { getByText } = render(
      <VersionBar
        version={version()}
        onExit={jest.fn()}
        editCount={3}
        formatCount={2}
        highlightsAvailable
      />
    );
    expect(getByText(/3 edits · 2 formatting/)).toBeTruthy();
  });

  it('hides the change summary when highlights are unavailable', () => {
    const { queryByText } = render(
      <VersionBar
        version={version()}
        onExit={jest.fn()}
        highlightsAvailable={false}
      />
    );
    expect(queryByText(/edits/)).toBeNull();
  });
});
