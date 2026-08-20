import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import DocxEditor from './index';

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
