import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ConnectAccountModal from './ConnectAccountModal';

// Regression test for Finding 2 (stale provider config after "Change
// account"): BoxFolderPicker's mount effect only runs once, keyed off
// loadFolder's identity, which never changes across an account swap. Unlike
// ConnectAccountModal.spec.tsx, this file does NOT mock ./providers, so the
// real BoxFolderPicker - and the shell's `key={accountEmail}` remount - are
// exercised end to end. Without that key, this test fails: the third
// `browseAccountResources` call (the post-swap refetch from root) never
// happens.
describe('ConnectAccountModal account change remount', () => {
  const rootPage = {
    current_folder: { id: '0', name: 'All Files', can_upload: true },
    breadcrumbs: [{ id: '0', name: 'All Files' }],
    folders: [{ id: '1', name: 'Applications' }],
    next_marker: ''
  };
  const subPage = {
    current_folder: { id: '1', name: 'Applications', can_upload: true },
    breadcrumbs: [
      { id: '0', name: 'All Files' },
      { id: '1', name: 'Applications' }
    ],
    folders: [],
    next_marker: ''
  };

  const baseProps = {
    show: true,
    provider: 'box',
    onChangeAccount: jest.fn(),
    onSaved: jest.fn(),
    onClose: jest.fn()
  };

  it('refetches from root instead of keeping the previous account folder state', async () => {
    const browseAccountResources = jest
      .fn()
      .mockResolvedValueOnce(rootPage)
      .mockResolvedValueOnce(subPage)
      .mockResolvedValueOnce(rootPage);
    const client = { browseAccountResources };

    const { rerender } = render(
      <ConnectAccountModal
        {...baseProps}
        client={client}
        accountEmail='old@example.com'
      />
    );

    await waitFor(() => screen.getByText('Applications'));
    fireEvent.click(screen.getByText('Applications'));
    await waitFor(() =>
      expect(browseAccountResources).toHaveBeenLastCalledWith('box', '1', {})
    );
    // The mock call assertion above resolves as soon as loadFolder invokes
    // client.browseAccountResources, before that promise itself resolves and
    // the resulting setBreadcrumbs/setFolders/etc land. Wait for the
    // resulting UI (subPage's empty folder list) too, so those updates
    // settle inside act() before the next step.
    await waitFor(() =>
      expect(
        screen.getByText('This folder does not contain any folders.')
      ).toBeTruthy()
    );

    // Simulate a completed "Change account": Form re-renders the shell with
    // a new accountEmail once onChangeAccount resolves and writes the new
    // connection email into field values.
    rerender(
      <ConnectAccountModal
        {...baseProps}
        client={client}
        accountEmail='new@example.com'
      />
    );

    await waitFor(() =>
      expect(browseAccountResources).toHaveBeenLastCalledWith('box', '0', {})
    );
    // Same reasoning: wait for the remount's refetch to actually reach the
    // DOM (root's folder list) before asserting the final call count.
    await waitFor(() => expect(screen.getByText('Applications')).toBeTruthy());
    expect(browseAccountResources).toHaveBeenCalledTimes(3);
  });
});
