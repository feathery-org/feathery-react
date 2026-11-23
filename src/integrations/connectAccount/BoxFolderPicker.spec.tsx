import React from 'react';
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor
} from '@testing-library/react';
import BoxFolderPicker from './BoxFolderPicker';
import { featheryWindow } from '../../utils/browser';
import type { ProviderFooterAction } from './providers';

const rootPage = {
  current_folder: { id: '0', name: 'All Files', can_upload: true },
  breadcrumbs: [{ id: '0', name: 'All Files' }],
  folders: [{ id: '1', name: 'Applications' }],
  next_marker: ''
};

// The Select button lives in the modal footer; the picker only reports it.
const latestFooterAction = (spy: jest.Mock): ProviderFooterAction =>
  spy.mock.calls[spy.mock.calls.length - 1][0];

const deferred = <T,>() => {
  let settle: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: settle };
};

const renderPicker = (client: any, overrides = {}) =>
  render(
    <BoxFolderPicker
      client={client}
      provider='box'
      onSaved={jest.fn()}
      onError={jest.fn()}
      {...overrides}
    />
  );

describe('BoxFolderPicker', () => {
  it('lists folders from the root on mount', async () => {
    const client = {
      browseAccountResources: jest.fn().mockResolvedValue(rootPage)
    };

    renderPicker(client);

    await waitFor(() => expect(screen.getByText('Applications')).toBeTruthy());
    expect(client.browseAccountResources).toHaveBeenCalledWith('box', '0', {});
  });

  it('navigates into a folder', async () => {
    const client = {
      browseAccountResources: jest
        .fn()
        .mockResolvedValueOnce(rootPage)
        .mockResolvedValueOnce({
          current_folder: { id: '1', name: 'Applications', can_upload: true },
          breadcrumbs: [
            { id: '0', name: 'All Files' },
            { id: '1', name: 'Applications' }
          ],
          folders: [],
          next_marker: ''
        })
    };

    renderPicker(client);
    await waitFor(() => screen.getByText('Applications'));
    fireEvent.click(screen.getByText('Applications'));

    await waitFor(() =>
      expect(client.browseAccountResources).toHaveBeenLastCalledWith(
        'box',
        '1',
        {}
      )
    );
    // The call assertion above resolves as soon as loadFolder invokes
    // browseAccountResources, before that promise resolves and the
    // resulting setBreadcrumbs/setFolders/etc land. Wait for the resulting
    // UI (the empty folder list) too, so those updates settle inside act().
    await waitFor(() =>
      expect(
        screen.getByText('This folder does not contain any folders.')
      ).toBeTruthy()
    );
  });

  it('saves the current folder and reports the values back', async () => {
    const onSaved = jest.fn();
    const onFooterActionChange = jest.fn();
    const client = {
      browseAccountResources: jest.fn().mockResolvedValue(rootPage),
      saveAccountConfig: jest.fn().mockResolvedValue({
        config: { folder_id: '0' },
        values: { 'feathery.connections.box.folder_path': 'All Files' }
      })
    };

    renderPicker(client, { onSaved, onFooterActionChange });
    await waitFor(() => screen.getByText('Applications'));
    // The footer action is published from an effect after the folder renders,
    // so wait for the labelled one rather than reading the spy eagerly.
    await waitFor(() =>
      expect(latestFooterAction(onFooterActionChange).label).toBe(
        'Select “All Files”'
      )
    );
    const action = latestFooterAction(onFooterActionChange);
    expect(action.disabled).toBe(false);
    act(() => {
      action.onClick();
    });

    await waitFor(() =>
      expect(client.saveAccountConfig).toHaveBeenCalledWith('box', {
        folder_id: '0'
      })
    );
    // onSaved fires a tick after saveAccountConfig resolves, so it needs its
    // own waitFor. Asserting it synchronously here races the handler and
    // tempts a "fix" in the component instead of the test.
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith({
        'feathery.connections.box.folder_path': 'All Files'
      })
    );
  });

  it('disables Select when the folder is not writable', async () => {
    const client = {
      browseAccountResources: jest.fn().mockResolvedValue({
        ...rootPage,
        current_folder: { id: '0', name: 'All Files', can_upload: false }
      })
    };

    const onFooterActionChange = jest.fn();
    renderPicker(client, { onFooterActionChange });
    await waitFor(() => screen.getByText('Applications'));

    await waitFor(() =>
      expect(latestFooterAction(onFooterActionChange).label).toBe(
        'Select “All Files”'
      )
    );
    expect(latestFooterAction(onFooterActionChange).disabled).toBe(true);
  });

  it('withdraws its footer action on unmount', async () => {
    const onFooterActionChange = jest.fn();
    const { unmount } = renderPicker(
      { browseAccountResources: jest.fn().mockResolvedValue(rootPage) },
      { onFooterActionChange }
    );
    await waitFor(() => screen.getByText('Applications'));
    unmount();
    expect(onFooterActionChange).toHaveBeenLastCalledWith(null);
  });

  it('creates a new folder in the current folder', async () => {
    const client = {
      browseAccountResources: jest.fn().mockResolvedValue(rootPage)
    };

    renderPicker(client);
    await waitFor(() => screen.getByText('Applications'));
    fireEvent.click(screen.getByText('New folder'));
    fireEvent.change(screen.getByPlaceholderText('Folder name'), {
      target: { value: 'Tax Docs' }
    });
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() =>
      expect(client.browseAccountResources).toHaveBeenLastCalledWith(
        'box',
        '0',
        {
          create: 'Tax Docs'
        }
      )
    );
    // handleCreateFolder's post-success setShowNewFolder(false)/setFolderName('')
    // settle a tick AFTER the call assertion resolves. Without asserting the
    // resulting UI state too, those setStates land outside act() and warn.
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('Folder name')).toBeNull()
    );
  });

  it('reports a browse failure through onError', async () => {
    const onError = jest.fn();
    const client = {
      browseAccountResources: jest
        .fn()
        .mockRejectedValue(new Error('Unable to load Box folders'))
    };

    renderPicker(client, { onError });

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith('Unable to load Box folders')
    );
    // loadFolder's finally-block setLoading(false) settles a tick after the
    // onError assertion resolves. Without asserting the resulting UI state
    // too, that setState lands outside act() and warns.
    await waitFor(() =>
      expect(
        screen.getByText('This folder does not contain any folders.')
      ).toBeTruthy()
    );
  });

  it.each(['load more first', 'refresh first'])(
    'does not duplicate rows when Load more overlaps a background refresh (%s)',
    async (order) => {
      const refresh = deferred<typeof rootPage>();
      const nextPage = deferred<typeof rootPage>();
      let pageOneRequests = 0;
      const client = {
        browseAccountResources: jest.fn(
          (_provider: string, _folderId: string, opts: any) => {
            if (opts.marker) return nextPage.promise;
            pageOneRequests += 1;
            return pageOneRequests === 1
              ? Promise.resolve({ ...rootPage, next_marker: 'm1' })
              : refresh.promise;
          }
        )
      };

      renderPicker(client);
      fireEvent.click(await screen.findByText('Load more'));
      expect(client.browseAccountResources).toHaveBeenLastCalledWith(
        'box',
        '0',
        { marker: 'm1' }
      );
      // A window focus while the next page is still loading starts a
      // separate, silent page-one refresh.
      fireEvent.focus(featheryWindow());
      expect(client.browseAccountResources).toHaveBeenCalledTimes(3);
      expect(client.browseAccountResources).toHaveBeenLastCalledWith(
        'box',
        '0',
        {}
      );

      const page2 = {
        ...rootPage,
        folders: [{ id: '2', name: 'Archive' }],
        next_marker: ''
      };
      const page1 = { ...rootPage, next_marker: 'm1' };
      await act(async () => {
        if (order === 'load more first') {
          nextPage.resolve(page2);
          await nextPage.promise;
          refresh.resolve(page1);
          await refresh.promise;
        } else {
          refresh.resolve(page1);
          await refresh.promise;
          nextPage.resolve(page2);
          await nextPage.promise;
        }
      });

      await waitFor(() => expect(screen.getByText('Archive')).toBeTruthy());
      expect(screen.getAllByText('Applications')).toHaveLength(1);
      expect(screen.getAllByText('Archive')).toHaveLength(1);
      expect(screen.queryByText('Load more')).toBeNull();
    }
  );

  describe('hover prefetch', () => {
    const threeFolders = {
      ...rootPage,
      folders: [
        { id: '1', name: 'Applications' },
        { id: '2', name: 'Archive' },
        { id: '3', name: 'Clients' }
      ]
    };

    afterEach(() => {
      jest.useRealTimers();
    });

    it('debounces a quick sweep down the list into one request for the last row', async () => {
      const client = {
        browseAccountResources: jest.fn().mockResolvedValue(threeFolders)
      };
      renderPicker(client);
      await screen.findByText('Clients');
      expect(client.browseAccountResources).toHaveBeenCalledTimes(1);

      jest.useFakeTimers();
      ['Applications', 'Archive', 'Clients'].forEach((name) =>
        fireEvent.mouseEnter(screen.getByText(name))
      );
      act(() => {
        jest.advanceTimersByTime(149);
      });
      expect(client.browseAccountResources).toHaveBeenCalledTimes(1);

      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(client.browseAccountResources).toHaveBeenCalledTimes(2);
      expect(client.browseAccountResources).toHaveBeenLastCalledWith(
        'box',
        '3',
        {}
      );
    });

    it('cancels a pending prefetch when the pointer leaves the row', async () => {
      const client = {
        browseAccountResources: jest.fn().mockResolvedValue(threeFolders)
      };
      renderPicker(client);
      await screen.findByText('Clients');

      jest.useFakeTimers();
      fireEvent.mouseEnter(screen.getByText('Archive'));
      fireEvent.mouseLeave(screen.getByText('Archive'));
      act(() => {
        jest.advanceTimersByTime(500);
      });
      expect(client.browseAccountResources).toHaveBeenCalledTimes(1);
    });
  });
});
