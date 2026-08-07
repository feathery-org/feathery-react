import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BoxFolderPicker from './BoxFolderPicker';

const rootPage = {
  current_folder: { id: '0', name: 'All Files', can_upload: true },
  breadcrumbs: [{ id: '0', name: 'All Files' }],
  folders: [{ id: '1', name: 'Applications' }],
  next_marker: ''
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
  });

  it('saves the current folder and reports the values back', async () => {
    const onSaved = jest.fn();
    const client = {
      browseAccountResources: jest.fn().mockResolvedValue(rootPage),
      saveAccountConfig: jest.fn().mockResolvedValue({
        config: { folder_id: '0' },
        values: { 'feathery.connections.box.folder_path': 'All Files' }
      })
    };

    renderPicker(client, { onSaved });
    await waitFor(() => screen.getByText('Applications'));
    fireEvent.click(screen.getByText('Select this folder'));

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

    renderPicker(client);
    await waitFor(() => screen.getByText('Applications'));

    expect(
      (
        screen
          .getByText('Select this folder')
          .closest('button') as HTMLButtonElement
      ).disabled
    ).toBe(true);
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
  });
});
