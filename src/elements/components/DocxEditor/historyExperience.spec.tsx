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
let mockSaveShortcut: () => Promise<void>;
let mockBindingsReady = false;
const mockCommitBindings = jest.fn(() => true);
const mockEditorListeners = new Map<string, Set<() => void>>();
const mockEditor = {
  serialize: () =>
    JSON.stringify({
      sections: [{ blocks: [{ inlines: [{ text: mockText }] }] }]
    }),
  revisions: { changes: [] as any[] },
  selection: {
    getCurrentRevision: () => null,
    selectRevision: jest.fn(),
    start: null,
    end: null
  },
  selectionModule: {
    selectRevision: jest.fn(),
    start: null,
    end: null
  },
  addEventListener: (event: string, callback: () => void) => {
    const listeners = mockEditorListeners.get(event) ?? new Set();
    listeners.add(callback);
    mockEditorListeners.set(event, listeners);
  },
  removeEventListener: (event: string, callback: () => void) => {
    mockEditorListeners.get(event)?.delete(callback);
  },
  focusIn: jest.fn(),
  viewer: { renderVisiblePages: jest.fn() }
};
const mockViewerOpen = jest.fn();
const mockViewerConstruct = jest.fn();
const mockViewerDestroy = jest.fn();
let mockViewer: any;

jest.mock('./DocxToolbar', () => ({ __esModule: true, default: () => null }));
jest.mock('./useDocxEditor', () => ({
  useDocxEditor: (options: any) => {
    mockOnEdit = options.onEdit;
    mockSaveShortcut = options.onSaveShortcut;
    return {
      containerRef: { current: null },
      editor: mockEditor,
      loading: false,
      error: null,
      exportDoc: async () => new Blob(['docx']),
      bindings: {
        ready: mockBindingsReady,
        commitForSave: mockCommitBindings,
        diagnostics: []
      }
    };
  },
  isOpeningDocument: () => false,
  setActiveInlineRevisions: jest.fn(),
  installRevisionHighlightRendering: jest.fn(),
  closeTrackedChangeReviewPane: jest.fn()
}));
jest.mock('./ejLoader', () => ({
  loadStyles: jest.fn(),
  waitForDocumentLoad: async () => true,
  waitForEj: async () => ({
    documenteditor: {
      DocumentEditorContainer: class {
        documentEditor = (mockViewer = {
          documentHelper: {
            viewerContainer: { style: {}, scrollTop: 0, scrollLeft: 0 }
          },
          open: (sfdt: string) => {
            mockViewerOpen(sfdt);
            mockViewer.documentHelper.viewerContainer.scrollTop = 0;
            mockViewer.documentHelper.viewerContainer.scrollLeft = 0;
          }
        });

        constructor() {
          mockViewerConstruct();
        }

        addEventListener(event: string, callback: () => void) {
          if (event === 'created') callback();
        }

        appendTo() {}
        destroy() {
          mockViewerDestroy();
        }
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
    mockViewerConstruct.mockClear();
    mockViewerDestroy.mockClear();
    mockBindingsReady = false;
    mockCommitBindings.mockReset().mockReturnValue(true);
    mockEditor.revisions.changes = [];
    mockEditorListeners.clear();
  });
  afterEach(() => jest.useRealTimers());

  it('toggles highlights without rebuilding, flashing a loader, or moving the viewport', async () => {
    let savedMeta: DocxSaveMeta | undefined;
    const host: DocxHistoryHost = {
      listVersions: async () => [
        savedVersion({
          id: 'current',
          session_id: savedMeta?.sessionId ?? '',
          is_current: true,
          final_sfdt: null,
          closed_at: null
        })
      ],
      closeVersion: () => new Promise(() => undefined),
      restoreVersion: jest.fn(),
      fetchVersionFile: jest.fn(),
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
    fireEvent.click(view.getByRole('button', { name: 'History' }));
    await waitFor(() => expect(mockViewerOpen).toHaveBeenCalled());
    await view.findByRole('switch', { name: 'Highlight changes' });
    const viewer = mockViewer;
    viewer.documentHelper.viewerContainer.scrollTop = 850;
    viewer.documentHelper.viewerContainer.scrollLeft = 45;

    for (const checked of [false, true, false, true]) {
      const previousOpens = mockViewerOpen.mock.calls.length;
      fireEvent.click(view.getByRole('switch', { name: 'Highlight changes' }));
      expect(view.queryByText('Loading version…')).toBeNull();
      await waitFor(() =>
        expect(mockViewerOpen.mock.calls.length).toBeGreaterThan(previousOpens)
      );
      expect(mockViewerConstruct).toHaveBeenCalledTimes(1);
      expect(mockViewerDestroy).not.toHaveBeenCalled();
      expect(mockViewer).toBe(viewer);
      expect(viewer.documentHelper.viewerContainer.scrollTop).toBe(850);
      expect(viewer.documentHelper.viewerContainer.scrollLeft).toBe(45);
      const display = JSON.parse(mockViewerOpen.mock.calls.slice(-1)[0][0]);
      expect(Boolean(display.revisions?.length)).toBe(checked);
    }
    view.unmount();
  });

  it('does not clear newer unsaved edits when an older save finishes', async () => {
    let finish!: () => void;
    const onChange = jest.fn();
    const host: DocxHistoryHost = {
      listVersions: async () => [],
      closeVersion: async () => null,
      restoreVersion: jest.fn(),
      fetchVersionFile: jest.fn(),
      renameVersion: jest.fn()
    };
    const view = render(
      <DocxEditor
        history={host}
        onChange={onChange}
        onSave={() =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
        }
      />
    );
    mockText = 'First edit';
    act(() => mockOnEdit({ assistant: false }));
    let saving!: Promise<void>;
    await act(async () => {
      saving = mockSaveShortcut();
    });
    mockText = 'Second edit while saving';
    act(() => mockOnEdit({ assistant: false }));
    await act(async () => {
      finish();
      await saving;
    });
    expect(onChange).toHaveBeenCalledWith(true);
    expect(onChange).not.toHaveBeenCalledWith(false);
    view.unmount();
  });

  it('uses the real binding commit gate before an automatic save', async () => {
    mockBindingsReady = true;
    const onSave = jest.fn().mockResolvedValue(undefined);
    const host: DocxHistoryHost = {
      listVersions: async () => [],
      closeVersion: async () => null,
      restoreVersion: jest.fn(),
      fetchVersionFile: jest.fn(),
      renameVersion: jest.fn()
    };
    const view = render(
      <DocxEditor history={host} bindings={{ enabled: true }} onSave={onSave} />
    );
    mockText = 'Bound edit';
    act(() => mockOnEdit({ assistant: false }));
    mockCommitBindings.mockReturnValue(false);
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_IDLE_MS);
    });
    expect(mockCommitBindings).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    mockCommitBindings.mockReturnValue(true);
    await act(async () => {
      jest.advanceTimersByTime(AUTOSAVE_IDLE_MS);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    view.unmount();
  });

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

  it('returns to the live editor when a Robin edit auto-opens Suggested changes', async () => {
    const current = savedVersion({
      id: 'current',
      seq: 2,
      is_current: true,
      final_sfdt: null,
      closed_at: null
    });
    const host: DocxHistoryHost = {
      listVersions: async () => [current],
      closeVersion: async () => null,
      restoreVersion: jest.fn(),
      fetchVersionFile: jest.fn(),
      renameVersion: jest.fn()
    };
    const view = render(
      <DocxEditor history={host} reviewChanges onSave={jest.fn()} />
    );
    fireEvent.click(view.getByRole('button', { name: 'History' }));
    await view.findByRole('button', { name: 'Back to current version' });

    mockEditor.revisions.changes = [
      {
        revisionID: 'robin-pending',
        revisionType: 'Insertion',
        author: 'Robin',
        customData: JSON.stringify({
          changeSetId: 'turn-1',
          group: 'new-copy',
          source: 'robin'
        }),
        getRange: () => [{ text: 'New copy' }]
      }
    ];
    act(() => {
      for (const listener of mockEditorListeners.get('contentChange') ?? [])
        listener();
    });

    await view.findAllByText('Suggested changes');
    expect(
      view.queryByRole('button', { name: 'Back to current version' })
    ).toBeNull();
    view.unmount();
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
