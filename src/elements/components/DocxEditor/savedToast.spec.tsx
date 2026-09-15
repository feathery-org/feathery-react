import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import DocxEditor, { restoredSuggestionsMessage } from './index';

// Drive the real DocxEditor (toolbar + save flow) against a stubbed engine so
// the Save-confirmation toast can be exercised without SyncFusion. The `mock`
// prefix lets jest.mock's hoisted factory reference it.
const mockExportDoc = jest.fn(async () => new Blob(['docx'], { type: 'docx' }));

// Stub the toolbar to a bare Save button wired to onSave — the toast under
// test lives in index.tsx, not in the toolbar's editor-formatting internals.
jest.mock('./DocxToolbar', () => ({
  __esModule: true,
  default: ({ onSave }: any) => {
    const R = jest.requireActual('react');
    return onSave
      ? R.createElement('button', { onClick: onSave }, 'Save')
      : null;
  }
}));

jest.mock('./useDocxEditor', () => ({
  useDocxEditor: () => ({
    containerRef: { current: null },
    editor: { stub: true },
    loading: false,
    error: null,
    exportDoc: mockExportDoc,
    bindings: { ready: false, commitForSave: () => true, diagnostics: [] }
  })
}));

describe('DocxEditor save confirmation toast', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockExportDoc.mockClear();
  });
  afterEach(() => {
    act(() => jest.runOnlyPendingTimers());
    jest.useRealTimers();
  });

  it('flashes "Document saved" after a successful save, then auto-dismisses', async () => {
    const onSave = jest.fn(async () => undefined);
    render(<DocxEditor onSave={onSave} />);

    expect(screen.queryByText('Document saved')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Document saved')).toBeInTheDocument();

    // Auto-dismisses once the timer elapses.
    act(() => jest.advanceTimersByTime(2500));
    await waitFor(() =>
      expect(screen.queryByText('Document saved')).not.toBeInTheDocument()
    );
  });

  // A restored version's .docx can carry back tracked changes that were still
  // awaiting review when it was saved. When the reopened document reports a
  // pending count shortly after a restore, the host toasts it (see
  // handleChangesCount); this pins the decision + copy that toast uses.
  describe('restoredSuggestionsMessage', () => {
    const now = 1_000_000;

    it('announces the count reported right after a restore', () => {
      expect(restoredSuggestionsMessage(18, now - 3000, now)).toBe(
        'This version includes 18 unapproved suggestions — review them in Suggested changes'
      );
      // Singular form.
      expect(restoredSuggestionsMessage(1, now - 3000, now)).toContain(
        '1 unapproved suggestion —'
      );
    });

    it('stays quiet with no restore, no suggestions, or a stale window', () => {
      // No restore recorded.
      expect(restoredSuggestionsMessage(5, 0, now)).toBeNull();
      // Restored version had no pending suggestions.
      expect(restoredSuggestionsMessage(0, now - 3000, now)).toBeNull();
      // A count arriving well after the restore is a new edit, not the restore.
      expect(restoredSuggestionsMessage(5, now - 60_000, now)).toBeNull();
    });
  });

  it('shows an error toast (not the success one) when the save fails', async () => {
    const onSave = jest.fn(async () => {
      throw new Error('network down');
    });
    const onError = jest.fn();
    render(<DocxEditor onSave={onSave} onError={onError} />);

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(
      await screen.findByText('Could not save document')
    ).toBeInTheDocument();
    expect(screen.queryByText('Document saved')).not.toBeInTheDocument();
  });
});
