import React from 'react';
import {
  act,
  fireEvent,
  render,
  waitFor,
  within
} from '@testing-library/react';

import DocxEditor from './index';
import { AUTOSAVE_IDLE_MS } from './history/autosaveScheduler';
import { DocxHistoryHost, DocxSaveMeta, DocxVersion } from './history/types';

let mockText = 'Original';
let mockOnEdit: (info: { assistant: boolean }) => void;
const mockEditor = {
  serialize: () =>
    JSON.stringify({
      sections: [{ blocks: [{ inlines: [{ text: mockText }] }] }]
    })
};
const mockViewerOpen = jest.fn();

jest.mock('./DocxToolbar', () => ({ __esModule: true, default: () => null }));
jest.mock('./useDocxEditor', () => ({
  useDocxEditor: (options: any) => {
    mockOnEdit = options.onEdit;
    return {
      containerRef: { current: null },
      editor: mockEditor,
      loading: false,
      error: null,
      exportDoc: async () => new Blob(['docx']),
      bindings: { ready: false, commitForSave: () => true, diagnostics: [] }
    };
  },
  isOpeningDocument: () => false,
  installRevisionHighlightRendering: jest.fn(),
  closeTrackedChangeReviewPane: jest.fn()
}));
jest.mock('./ejLoader', () => ({
  loadStyles: jest.fn(),
  waitForDocumentLoad: async () => true,
  waitForEj: async () => ({
    documenteditor: {
      DocumentEditorContainer: class {
        documentEditor = { open: mockViewerOpen };

        addEventListener(event: string, callback: () => void) {
          if (event === 'created') callback();
        }

        appendTo() {}
        destroy() {}
      }
    }
  })
}));
jest.mock('./contentControlSafety', () => ({
  stampMissingContentControlColors: jest.fn()
}));

describe('version history experience', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockText = 'Original';
    mockViewerOpen.mockClear();
  });
  afterEach(() => jest.useRealTimers());

  it('shows the human avatar with its live highlight before the checkpoint upload completes', async () => {
    let savedMeta: DocxSaveMeta | undefined;
    let finishCheckpoint: (version: DocxVersion | null) => void = () =>
      undefined;
    const host: DocxHistoryHost = {
      listVersions: jest.fn(async () => [
        {
          id: 'current',
          session_id: savedMeta?.sessionId,
          seq: 1,
          is_current: true,
          is_baseline: false,
          name: '',
          ended_at: new Date().toISOString(),
          closed_at: null,
          authors: savedMeta?.authors ?? [],
          final_sfdt: null,
          changes: null,
          change_count: null,
          format_change_count: null
        } as DocxVersion
      ]),
      closeVersion: jest.fn(
        () =>
          new Promise((resolve) => {
            finishCheckpoint = resolve;
          })
      ),
      fetchVersionFile: jest.fn(),
      restoreVersion: jest.fn(),
      renameVersion: jest.fn()
    };
    const view = render(
      <DocxEditor
        history={host}
        onSave={async (_blob, meta) => {
          savedMeta = meta;
        }}
      />
    );
    mockText = 'Original human edit';
    act(() => mockOnEdit({ assistant: false }));
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_IDLE_MS);
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    expect(savedMeta?.sessionId).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'History' }));
    await view.findByText('Just now');
    await waitFor(() => expect(mockViewerOpen).toHaveBeenCalled());
    const display = JSON.parse(
      mockViewerOpen.mock.calls[mockViewerOpen.mock.calls.length - 1][0]
    );
    expect(display.revisions.map((revision: any) => revision.author)).toEqual([
      'you'
    ]);
    expect(view.queryByTitle('You')).not.toBeNull();
    expect(view.queryByTitle('Robin')).toBeNull();
    expect(view.queryByText('1 edit')).not.toBeNull();
    fireEvent.click(view.getByText('Just now'));
    expect(view.queryByText('1 edit')).not.toBeNull();
    mockText += ' Robin edit';
    act(() => mockOnEdit({ assistant: true }));
    await act(async () => finishCheckpoint(null));
    // The checkpoint response is older than the live document. Refreshing it
    // must recompute both the preview and avatars, without losing the human.
    await waitFor(() => expect(view.queryByTitle('Robin')).not.toBeNull());
    expect(view.queryByTitle('You')).not.toBeNull();
    const updated = JSON.parse(
      mockViewerOpen.mock.calls[mockViewerOpen.mock.calls.length - 1][0]
    );
    expect(updated.revisions.map((revision: any) => revision.author)).toEqual([
      'you',
      'robin'
    ]);
    view.unmount();
  });

  const savedVersion = (over: Partial<DocxVersion>): DocxVersion => ({
    id: 'older',
    session_id: 'older-session',
    seq: 1,
    is_current: false,
    is_baseline: false,
    name: 'Older draft',
    started_at: '2026-09-17T12:00:00Z',
    ended_at: '2026-09-17T12:00:00Z',
    closed_at: '2026-09-17T12:00:00Z',
    authors: [],
    actor_name: '',
    actor_label: '',
    restored_from: null,
    restored_from_at: null,
    editor_file: null,
    file: null,
    final_sfdt: 'saved-sfdt',
    changes: null,
    change_count: null,
    format_change_count: null,
    final_sha256: '',
    highlights_pruned_at: null,
    created_at: '2026-09-17T12:00:00Z',
    ...over
  });

  const restoreSetup = () => {
    const older = savedVersion({});
    const current = savedVersion({
      id: 'current',
      name: 'Current draft',
      seq: 2,
      is_current: true
    });
    const restored = savedVersion({
      id: 'restored',
      name: '',
      seq: 3,
      is_current: true,
      session_id: 'restored-session',
      restored_from: older.id,
      restored_from_at: older.ended_at,
      ended_at: new Date().toISOString(),
      final_sfdt: 'restored-sfdt'
    });
    const host: jest.Mocked<DocxHistoryHost> = {
      listVersions: jest.fn().mockResolvedValue([current, older]),
      closeVersion: jest.fn().mockResolvedValue(null),
      fetchVersionFile: jest.fn(
        async (url) =>
          new TextEncoder().encode(
            JSON.stringify({
              sections: [{ blocks: [{ inlines: [{ text: url }] }] }]
            })
          ).buffer
      ),
      restoreVersion: jest.fn(),
      renameVersion: jest.fn()
    };
    return { host, older, current, restored };
  };

  it.each([true, false])(
    'shows restore progress through saving and selects the new row (host returns row: %s)',
    async (returnsRow) => {
      const { host, older, current, restored } = restoreSetup();
      let finishSave: () => void = () => undefined;
      let finishRestore: (row: DocxVersion | void) => void = () => undefined;
      let finishDiff: (row: DocxVersion | null) => void = () => undefined;
      const onSave = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            finishSave = resolve;
          })
      );
      host.restoreVersion.mockImplementation(
        () =>
          new Promise((resolve) => {
            finishRestore = resolve;
          })
      );
      host.closeVersion.mockImplementation(
        () =>
          new Promise((resolve) => {
            finishDiff = resolve;
          })
      );
      const view = render(<DocxEditor history={host} onSave={onSave} />);
      mockText += ' unsaved edit';
      act(() => mockOnEdit({ assistant: false }));
      fireEvent.click(view.getByRole('button', { name: 'History' }));
      fireEvent.click(await view.findByText('Older draft'));
      fireEvent.click(view.getByRole('button', { name: 'Restore version' }));
      const confirm = within(view.getByRole('alertdialog')).getByRole(
        'button',
        { name: 'Restore' }
      );
      fireEvent.click(confirm);

      expect(view.getByText('Restoring version…')).toBeTruthy();
      expect(view.getByRole('button', { name: 'Restoring…' })).toBeDisabled();
      expect(view.getByRole('button', { name: 'Close panel' })).toBeDisabled();
      fireEvent.keyDown(view.container.ownerDocument, { key: 'Escape' });
      expect(
        view.container.querySelector('[aria-current="true"]')
      ).toHaveTextContent('Older draft');
      expect(host.restoreVersion).not.toHaveBeenCalled();
      await waitFor(() => expect(onSave).toHaveBeenCalled());
      await act(async () => finishSave());
      await waitFor(() =>
        expect(host.restoreVersion).toHaveBeenCalledWith(older.id)
      );
      expect(view.getByText('Restoring version…')).toBeTruthy();
      fireEvent.click(view.getByRole('button', { name: 'Restoring…' }));
      expect(host.restoreVersion).toHaveBeenCalledTimes(1);

      host.listVersions.mockResolvedValue([
        restored,
        { ...current, is_current: false },
        older
      ]);
      await act(async () => finishRestore(returnsRow ? restored : undefined));
      await waitFor(() =>
        expect(
          view.getByText('Just now').closest('[aria-current="true"]')
        ).not.toBeNull()
      );
      expect(view.queryByText('Restoring version…')).toBeNull();
      expect(view.getByText(/Restored from /)).toBeTruthy();
      expect(
        view.getByRole('button', { name: 'Restore version' })
      ).toBeDisabled();
      await waitFor(() =>
        expect(mockViewerOpen).toHaveBeenLastCalledWith(
          expect.stringContaining('restored-sfdt')
        )
      );
      // A delayed pre-restore diff must not move selection back to the old row.
      await act(async () => {
        jest.advanceTimersByTime(0);
        finishDiff(null);
      });
      expect(
        view.getByText('Just now').closest('[aria-current="true"]')
      ).not.toBeNull();
      view.unmount();
    }
  );

  it('clears restore progress on failure and keeps the original selection available for retry', async () => {
    const { host } = restoreSetup();
    let rejectRestore: (error: Error) => void = () => undefined;
    host.restoreVersion.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          rejectRestore = reject;
        })
    );
    const onError = jest.fn();
    const view = render(<DocxEditor history={host} onError={onError} />);
    fireEvent.click(view.getByRole('button', { name: 'History' }));
    fireEvent.click(await view.findByText('Older draft'));
    fireEvent.click(view.getByRole('button', { name: 'Restore version' }));
    fireEvent.click(
      within(view.getByRole('alertdialog')).getByRole('button', {
        name: 'Restore'
      })
    );
    await waitFor(() => expect(host.restoreVersion).toHaveBeenCalled());
    expect(view.getByText('Restoring version…')).toBeTruthy();
    await act(async () => rejectRestore(new Error('Restore failed')));
    expect(view.queryByText('Restoring version…')).toBeNull();
    expect(view.getByText('Could not restore this version')).toBeTruthy();
    expect(
      view.container.querySelector('[aria-current="true"]')
    ).toHaveTextContent('Older draft');
    expect(
      view.getByRole('button', { name: 'Restore version' })
    ).not.toBeDisabled();
    expect(onError).toHaveBeenCalledWith('Restore failed');
    view.unmount();
  });
});
