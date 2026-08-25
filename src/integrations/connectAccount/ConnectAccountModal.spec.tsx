import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ConnectAccountModal from './ConnectAccountModal';

// A fake config component that lets tests trigger `onError` directly, since
// the real `box` stub (BoxFolderPicker) never calls it.
jest.mock('./providers', () => {
  const actual = jest.requireActual('./providers');
  const react = jest.requireActual('react');
  return {
    ...actual,
    CONFIG_COMPONENTS: {
      box: ({ onError }: any) =>
        react.createElement(
          'button',
          { onClick: () => onError('Something went wrong') },
          'Trigger error'
        )
    }
  };
});

describe('ConnectAccountModal', () => {
  const baseProps = {
    show: true,
    provider: 'box',
    client: {
      browseAccountResources: jest.fn().mockResolvedValue({
        current_folder: { id: '0', name: 'All Files', can_upload: true },
        breadcrumbs: [{ id: '0', name: 'All Files' }],
        folders: [],
        next_marker: ''
      })
    },
    accountEmail: 'respondent@example.com',
    onChangeAccount: jest.fn(),
    onSaved: jest.fn(),
    onClose: jest.fn()
  };

  it('shows the connected account email', () => {
    render(<ConnectAccountModal {...baseProps} />);
    expect(screen.getByText('respondent@example.com')).toBeTruthy();
  });

  it('confirms the connection when the provider reports no account', () => {
    // Schwab exposes no account identity, so the line would otherwise be blank.
    render(
      <ConnectAccountModal
        {...baseProps}
        provider='charles-schwab'
        accountEmail=''
      />
    );

    expect(
      screen.getByText('Your Charles Schwab account is connected')
    ).toBeTruthy();
  });

  it('calls onChangeAccount when Change account is clicked', async () => {
    const onChangeAccount = jest.fn();
    render(
      <ConnectAccountModal {...baseProps} onChangeAccount={onChangeAccount} />
    );

    fireEvent.click(screen.getByText('Change account'));

    expect(onChangeAccount).toHaveBeenCalled();
    // handleChangeAccount's finally-block setChangingAccount(false) settles a
    // tick later; wait for it so that update lands inside act().
    await waitFor(() =>
      expect(screen.getByText('Change account')).not.toBeDisabled()
    );
  });

  it('renders nothing when show is false', () => {
    const { container } = render(
      <ConnectAccountModal {...baseProps} show={false} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows only the change-account row when the provider has no config component', () => {
    render(<ConnectAccountModal {...baseProps} provider='unmapped' />);
    expect(screen.getByText('Change account')).toBeTruthy();
    expect(screen.queryByText('Trigger error')).toBeNull();
  });

  it('calls onClose from the close control', () => {
    const onClose = jest.fn();
    render(<ConnectAccountModal {...baseProps} onClose={onClose} />);

    fireEvent.click(screen.getByLabelText('Close'));

    expect(onClose).toHaveBeenCalled();
  });

  it('clears a config error on Change account and does not carry it across a reopen', async () => {
    const onChangeAccount = jest.fn();
    const { rerender } = render(
      <ConnectAccountModal {...baseProps} onChangeAccount={onChangeAccount} />
    );

    fireEvent.click(screen.getByText('Trigger error'));
    expect(screen.getByText('Something went wrong')).toBeTruthy();

    fireEvent.click(screen.getByText('Change account'));
    expect(onChangeAccount).toHaveBeenCalled();
    expect(screen.queryByText('Something went wrong')).toBeNull();
    // handleChangeAccount's finally-block setChangingAccount(false) settles a
    // tick later; wait for it so that update lands inside act().
    await waitFor(() =>
      expect(screen.getByText('Change account')).not.toBeDisabled()
    );

    fireEvent.click(screen.getByText('Trigger error'));
    expect(screen.getByText('Something went wrong')).toBeTruthy();

    rerender(<ConnectAccountModal {...baseProps} show={false} />);
    rerender(<ConnectAccountModal {...baseProps} show />);
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  // Regression test: the modal renders inside Form's <form> (see
  // src/Form/index.tsx, between the <form> open tag and its close tag),
  // which has no onSubmit handler. A chrome button without an explicit
  // `type` defaults to type="submit" and would reload the respondent's form
  // on click. Both buttons must render standalone, but wrapped in a real
  // <form> here - unlike baseProps' bare render above - since that's the
  // only setup that can catch this.
  it('does not submit an enclosing form when Close is clicked', () => {
    const handleSubmit = jest.fn((e) => e.preventDefault());
    render(
      <form onSubmit={handleSubmit}>
        <ConnectAccountModal {...baseProps} />
      </form>
    );

    fireEvent.click(screen.getByLabelText('Close'));

    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('does not submit an enclosing form when Change account is clicked', async () => {
    const handleSubmit = jest.fn((e) => e.preventDefault());
    const onChangeAccount = jest.fn();
    render(
      <form onSubmit={handleSubmit}>
        <ConnectAccountModal {...baseProps} onChangeAccount={onChangeAccount} />
      </form>
    );

    fireEvent.click(screen.getByText('Change account'));

    expect(handleSubmit).not.toHaveBeenCalled();
    // handleChangeAccount's finally-block setChangingAccount(false) settles a
    // tick later; wait for it so that update lands inside act().
    await waitFor(() => expect(onChangeAccount).toHaveBeenCalled());
  });

  // Regression test: onChangeAccount must never reject (Form's implementation
  // resolves with an error message string instead), since this fires it from
  // a plain onClick without awaiting or catching. A resolved error message
  // still needs to reach the user.
  it('surfaces the error message returned by onChangeAccount', async () => {
    const onChangeAccount = jest
      .fn()
      .mockResolvedValue('Please allow pop-ups to connect your account.');
    render(
      <ConnectAccountModal {...baseProps} onChangeAccount={onChangeAccount} />
    );

    fireEvent.click(screen.getByText('Change account'));

    await waitFor(() =>
      expect(
        screen.getByText('Please allow pop-ups to connect your account.')
      ).toBeTruthy()
    );
  });
});
