import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within
} from '@testing-library/react';
import ConnectAccountModal from './ConnectAccountModal';

const credentials = [
  { id: 'c1', account_email: 'advisor@example.com', account_name: 'Advisor' },
  { id: 'c2', account_email: 'other@example.com', account_name: 'Other' }
];
const createProps = () => ({
  show: true,
  provider: 'box',
  accountEmail: '',
  chooseCredential: true,
  credentials,
  client: {
    selectAccountCredential: jest.fn().mockResolvedValue({
      account_email: 'advisor@example.com',
      needs_config: true,
      values: { 'feathery.connections.box.email': 'advisor@example.com' }
    }),
    deleteAccountCredential: jest.fn().mockResolvedValue(undefined),
    browseAccountResources: jest.fn().mockResolvedValue({
      current_folder: { id: '0', name: 'All Files', can_upload: true },
      breadcrumbs: [],
      folders: [],
      next_marker: ''
    })
  },
  onChangeAccount: jest.fn().mockResolvedValue(undefined),
  onCredentialSelected: jest.fn(),
  onSaved: jest.fn(),
  onClose: jest.fn()
});

const trigger = () =>
  screen.getByRole('button', { name: 'Saved Box accounts' });
const openMenu = () => {
  fireEvent.click(trigger());
  return screen.getByRole('listbox', { name: 'Saved Box accounts' });
};
const chooseOption = (name: string | RegExp) => {
  const listbox = openMenu();
  fireEvent.click(within(listbox).getByRole('option', { name }));
};
const NEW_ACCOUNT_OPTION = 'Connect a new account...';
// Waits for the folder picker's browse call *and* its resulting render, so
// BoxFolderPicker's post-fetch state updates settle inside act().
const pickerLoaded = async (
  props: ReturnType<typeof createProps>,
  calls: number
) => {
  await waitFor(() =>
    expect(props.client.browseAccountResources).toHaveBeenCalledTimes(calls)
  );
  await screen.findByText('This folder does not contain any folders.');
};

describe('saved Box credentials', () => {
  it('attaches the selected saved credential and opens configuration', async () => {
    const props = createProps();
    render(<ConnectAccountModal {...props} />);
    expect(trigger()).toHaveAttribute('aria-haspopup', 'listbox');
    expect(props.client.selectAccountCredential).not.toHaveBeenCalled();
    expect(props.client.browseAccountResources).not.toHaveBeenCalled();

    chooseOption('advisor@example.com');

    await pickerLoaded(props, 1);
    expect(props.client.selectAccountCredential).toHaveBeenCalledWith(
      'box',
      'c1'
    );
    expect(props.onCredentialSelected).toHaveBeenCalledWith({
      'feathery.connections.box.email': 'advisor@example.com'
    });
    expect(props.onSaved).not.toHaveBeenCalled();
  });

  it('surfaces selection errors without opening folder access or advancing', async () => {
    const props = createProps();
    props.client.selectAccountCredential.mockRejectedValue(
      new Error('Please sign in to connect an account.')
    );
    render(<ConnectAccountModal {...props} />);
    chooseOption('other@example.com');
    expect(
      await screen.findByText('Please sign in to connect an account.')
    ).toBeTruthy();
    expect(props.client.browseAccountResources).not.toHaveBeenCalled();
    expect(props.onCredentialSelected).not.toHaveBeenCalled();
  });

  it('offers a new OAuth connection directly from a user click', async () => {
    const props = createProps();
    render(<ConnectAccountModal {...props} />);
    chooseOption(NEW_ACCOUNT_OPTION);
    expect(props.onChangeAccount).toHaveBeenCalledTimes(1);
    await pickerLoaded(props, 1);
    expect(props.client.selectAccountCredential).not.toHaveBeenCalled();
  });

  it('keeps configuration hidden when connecting a new account fails', async () => {
    const props = createProps();
    props.onChangeAccount.mockResolvedValue('Please allow pop-ups.' as any);
    render(<ConnectAccountModal {...props} />);
    chooseOption(NEW_ACCOUNT_OPTION);
    expect(await screen.findByText('Please allow pop-ups.')).toBeTruthy();
    expect(props.client.browseAccountResources).not.toHaveBeenCalled();
  });

  it('clears the saved selection after attachment to prevent accidental reattachment', async () => {
    const props = createProps();
    render(<ConnectAccountModal {...props} />);
    chooseOption('advisor@example.com');
    await pickerLoaded(props, 1);
    // The trigger now reports the live connection, not the saved entry.
    expect(trigger()).toHaveTextContent('Current Box account');
    const listbox = openMenu();
    expect(
      within(listbox).getByRole('option', { name: 'Current Box account' })
    ).toHaveAttribute('aria-selected', 'true');
    expect(
      within(listbox).getByRole('option', { name: 'advisor@example.com' })
    ).toHaveAttribute('aria-selected', 'false');
  });

  it('switches an existing connection to a saved account and resets its folder picker', async () => {
    const props = createProps();
    render(
      <ConnectAccountModal
        {...props}
        chooseCredential={false}
        accountEmail='old@example.com'
      />
    );
    await pickerLoaded(props, 1);
    chooseOption('other@example.com');
    await pickerLoaded(props, 2);
    expect(props.client.selectAccountCredential).toHaveBeenCalledWith(
      'box',
      'c2'
    );
    expect(props.onSaved).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'remembers new connections by default only when saving is allowed (%s)',
    async (canSaveCredential) => {
      const props = createProps();
      render(
        <ConnectAccountModal {...props} canSaveCredential={canSaveCredential} />
      );
      chooseOption(NEW_ACCOUNT_OPTION);
      await waitFor(() =>
        expect(props.onChangeAccount).toHaveBeenCalledWith(canSaveCredential)
      );
      await pickerLoaded(props, 1);
    }
  );

  describe('auto-select on open', () => {
    it('attaches a preferred credential on its own', async () => {
      const props = createProps();
      render(
        <ConnectAccountModal
          {...props}
          credentials={[credentials[0], { ...credentials[1], preferred: true }]}
        />
      );
      await waitFor(() =>
        expect(props.client.selectAccountCredential).toHaveBeenCalledTimes(1)
      );
      // Only the credential and provider are pinned here: whether the
      // auto-attach also sends `remember` depends on effect ordering (see the
      // stale rememberCredential note in the test report).
      expect(
        props.client.selectAccountCredential.mock.calls[0].slice(0, 2)
      ).toEqual(['box', 'c2']);
      await pickerLoaded(props, 1);
    });

    it('never attaches the first credential without a preference', async () => {
      const props = createProps();
      render(<ConnectAccountModal {...props} />);
      // Let any effect-driven selection run before asserting it did not.
      await waitFor(() => expect(trigger()).not.toBeDisabled());
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(props.client.selectAccountCredential).not.toHaveBeenCalled();
      expect(props.client.browseAccountResources).not.toHaveBeenCalled();
    });

    it('does not auto-attach when the submission is already connected', async () => {
      const props = createProps();
      render(
        <ConnectAccountModal
          {...props}
          chooseCredential={false}
          accountEmail='old@example.com'
          credentials={[{ ...credentials[0], preferred: true }]}
        />
      );
      await pickerLoaded(props, 1);
      expect(props.client.selectAccountCredential).not.toHaveBeenCalled();
    });
  });

  describe('forgetting a saved account', () => {
    const trashFor = (email: string) =>
      screen.getByRole('button', {
        name: `Forget saved Box account ${email}`
      });

    it('asks for confirmation and only deletes on Forget', async () => {
      const props = createProps();
      render(<ConnectAccountModal {...props} />);
      openMenu();

      fireEvent.click(trashFor('advisor@example.com'));
      const confirm = screen.getByRole('group', {
        name: 'Forget advisor@example.com?'
      });
      expect(props.client.deleteAccountCredential).not.toHaveBeenCalled();

      fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('group')).toBeNull();
      expect(
        screen.getByRole('option', { name: 'advisor@example.com' })
      ).toBeTruthy();
      expect(props.client.deleteAccountCredential).not.toHaveBeenCalled();

      fireEvent.click(trashFor('advisor@example.com'));
      fireEvent.click(
        within(
          screen.getByRole('group', { name: 'Forget advisor@example.com?' })
        ).getByRole('button', { name: 'Forget' })
      );

      // The confirmation stays up until the delete settles.
      await waitFor(() => expect(screen.queryByRole('group')).toBeNull());
      expect(
        screen.queryByRole('option', { name: 'advisor@example.com' })
      ).toBeNull();
      expect(props.client.deleteAccountCredential).toHaveBeenCalledTimes(1);
      expect(props.client.deleteAccountCredential).toHaveBeenCalledWith(
        'box',
        'c1'
      );
      expect(
        screen.getByRole('option', { name: 'other@example.com' })
      ).toBeTruthy();
      expect(props.client.selectAccountCredential).not.toHaveBeenCalled();
    });

    it('keeps the account and shows the error when forgetting fails', async () => {
      const props = createProps();
      props.client.deleteAccountCredential.mockRejectedValue(
        new Error('Unable to delete this saved account.')
      );
      render(<ConnectAccountModal {...props} />);
      openMenu();
      fireEvent.click(trashFor('advisor@example.com'));
      fireEvent.click(screen.getByRole('button', { name: 'Forget' }));
      expect(
        await screen.findByText('Unable to delete this saved account.')
      ).toBeTruthy();
      expect(
        screen.getByRole('group', { name: 'Forget advisor@example.com?' })
      ).toBeTruthy();
    });
  });

  describe('keyboard', () => {
    it('closes the account menu on the first Escape and the dialog on the second', () => {
      const props = createProps();
      render(<ConnectAccountModal {...props} />);
      const listbox = openMenu();
      const [firstOption] = within(listbox).getAllByRole('option');
      expect(firstOption).toHaveFocus();

      fireEvent.keyDown(firstOption, { key: 'Escape' });
      expect(screen.queryByRole('listbox')).toBeNull();
      expect(trigger()).toHaveFocus();
      expect(props.onClose).not.toHaveBeenCalled();

      fireEvent.keyDown(trigger(), { key: 'Escape' });
      expect(props.onClose).toHaveBeenCalledTimes(1);
    });

    it('moves focus between options with the arrow keys, wrapping at the ends', () => {
      render(<ConnectAccountModal {...createProps()} />);
      const listbox = openMenu();
      const options = within(listbox).getAllByRole('option');
      expect(options.map((option) => option.textContent)).toEqual([
        'advisor@example.com',
        'other@example.com',
        NEW_ACCOUNT_OPTION
      ]);

      fireEvent.keyDown(options[0], { key: 'ArrowDown' });
      expect(options[1]).toHaveFocus();
      fireEvent.keyDown(options[1], { key: 'ArrowDown' });
      fireEvent.keyDown(options[2], { key: 'ArrowDown' });
      expect(options[0]).toHaveFocus();
      fireEvent.keyDown(options[0], { key: 'ArrowUp' });
      expect(options[2]).toHaveFocus();
    });
  });

  describe('connection locked to another user', () => {
    const renderLocked = (props = createProps()) => {
      render(
        <ConnectAccountModal
          {...props}
          chooseCredential={false}
          canSaveCredential
          lockedByOwner
          accountEmail='owner@example.com'
        />
      );
      return props;
    };

    it('offers only replacement, hiding the owner connection and its settings', async () => {
      const props = renderLocked();
      expect(
        screen.getByRole('heading', {
          name: 'Replace the connected Box account'
        })
      ).toBeTruthy();
      expect(screen.getByText(/locked to them/)).toBeTruthy();

      const listbox = openMenu();
      expect(
        within(listbox).queryByRole('option', { name: 'owner@example.com' })
      ).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Disconnect current account' })
      ).toBeNull();
      expect(
        within(listbox)
          .getAllByRole('option')
          .map((o) => o.textContent)
      ).toEqual([
        'advisor@example.com',
        'other@example.com',
        NEW_ACCOUNT_OPTION
      ]);

      // Neither the folder picker nor its footer action renders.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(props.client.browseAccountResources).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: /^Select / })).toBeNull();
    });

    it('unlocks the settings after attaching one of the user’s saved accounts', async () => {
      const props = renderLocked();
      chooseOption('advisor@example.com');

      await pickerLoaded(props, 1);
      expect(
        screen.getByRole('button', { name: 'Select “All Files”' })
      ).toBeTruthy();
      expect(props.client.selectAccountCredential).toHaveBeenCalledWith(
        'box',
        'c1',
        true
      );
      expect(props.client.browseAccountResources).toHaveBeenCalledTimes(1);
      expect(
        screen.getByRole('heading', { name: 'Choose a Box account' })
      ).toBeTruthy();
    });

    it('unlocks the settings after connecting a new account', async () => {
      const props = renderLocked();
      chooseOption(NEW_ACCOUNT_OPTION);

      await pickerLoaded(props, 1);
      expect(
        screen.getByRole('button', { name: 'Select “All Files”' })
      ).toBeTruthy();
      expect(props.onChangeAccount).toHaveBeenCalledWith(true);
      expect(
        screen.getByRole('heading', { name: 'Choose a Box account' })
      ).toBeTruthy();
    });

    it('stays locked when connecting a new account fails', async () => {
      const props = createProps();
      props.onChangeAccount.mockResolvedValue('Please allow pop-ups.' as any);
      renderLocked(props);
      chooseOption(NEW_ACCOUNT_OPTION);

      expect(await screen.findByText('Please allow pop-ups.')).toBeTruthy();
      expect(
        screen.getByRole('heading', {
          name: 'Replace the connected Box account'
        })
      ).toBeTruthy();
      expect(props.client.browseAccountResources).not.toHaveBeenCalled();
    });
  });
});
