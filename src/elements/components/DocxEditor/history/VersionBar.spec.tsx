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

  it('shows the highlight toggle, edit count and steppers when available', () => {
    const onToggle = jest.fn();
    const onPrev = jest.fn();
    const onNext = jest.fn();
    const { getByText, getByRole, getByLabelText } = render(
      <VersionBar
        version={version()}
        onExit={jest.fn()}
        editCount={3}
        highlightsAvailable
        highlightsOn
        onToggleHighlights={onToggle}
        onPrevChange={onPrev}
        onNextChange={onNext}
      />
    );
    expect(getByText('3 edits')).toBeTruthy();
    // Toggle reflects state and flips it.
    const toggle = getByRole('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(false);
    // Steppers navigate.
    fireEvent.click(getByLabelText('Next change'));
    fireEvent.click(getByLabelText('Previous change'));
    expect(onNext).toHaveBeenCalled();
    expect(onPrev).toHaveBeenCalled();
  });

  it('shows an explicit approved badge in the version preview', () => {
    const { getByText } = render(
      <VersionBar
        version={version()}
        onExit={jest.fn()}
        highlightsAvailable
        approvedCount={1}
      />
    );

    expect(getByText('✓ 1 approved')).toBeTruthy();
  });

  it('makes historical pending status explicitly relative to the saved snapshot', () => {
    const { getByText } = render(
      <VersionBar
        version={version()}
        onExit={jest.fn()}
        highlightsAvailable
        pendingCount={2}
      />
    );
    expect(getByText('2 pending at save').getAttribute('title')).toContain(
      'may have since been accepted'
    );
  });

  it('disables the steppers while highlights are toggled off', () => {
    const onNext = jest.fn();
    const { getByLabelText } = render(
      <VersionBar
        version={version()}
        onExit={jest.fn()}
        editCount={3}
        highlightsAvailable
        highlightsOn={false}
        onNextChange={onNext}
      />
    );
    fireEvent.click(getByLabelText('Next change'));
    expect(onNext).not.toHaveBeenCalled();
  });

  it('hides the change controls when highlights are unavailable', () => {
    const { queryByText, queryByRole } = render(
      <VersionBar
        version={version()}
        onExit={jest.fn()}
        highlightsAvailable={false}
      />
    );
    expect(queryByText(/edits/)).toBeNull();
    expect(queryByRole('switch')).toBeNull();
    expect(queryByText('Detailed changes unavailable')).toBeTruthy();
  });

  it('never offers highlight controls or pending badges for a restored baseline', () => {
    const view = render(
      <VersionBar
        version={version({ restored_from: 'original' })}
        onExit={jest.fn()}
        highlightsAvailable
        pendingCount={2}
        editCount={2}
      />
    );
    expect(view.queryByRole('switch')).toBeNull();
    expect(view.queryByLabelText('Next change')).toBeNull();
    expect(view.queryByText(/pending/)).toBeNull();
    expect(view.queryByText('Detailed changes unavailable')).toBeNull();
  });
});
