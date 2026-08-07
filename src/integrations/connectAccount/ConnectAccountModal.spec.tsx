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

  it('calls onChangeAccount when Change account is clicked', () => {
    const onChangeAccount = jest.fn();
    render(
      <ConnectAccountModal {...baseProps} onChangeAccount={onChangeAccount} />
    );

    fireEvent.click(screen.getByText('Change account'));

    expect(onChangeAccount).toHaveBeenCalled();
  });

  it('renders nothing when show is false', () => {
    const { container } = render(
      <ConnectAccountModal {...baseProps} show={false} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a fallback when the provider has no config component', () => {
    render(<ConnectAccountModal {...baseProps} provider='unmapped' />);
    expect(screen.getByText(/no additional setup/i)).toBeTruthy();
  });

  it('calls onClose from the close control', () => {
    const onClose = jest.fn();
    render(<ConnectAccountModal {...baseProps} onClose={onClose} />);

    fireEvent.click(screen.getByLabelText('Close'));

    expect(onClose).toHaveBeenCalled();
  });

  it('clears a config error on Change account and does not carry it across a reopen', () => {
    const onChangeAccount = jest.fn();
    const { rerender } = render(
      <ConnectAccountModal {...baseProps} onChangeAccount={onChangeAccount} />
    );

    fireEvent.click(screen.getByText('Trigger error'));
    expect(screen.getByText('Something went wrong')).toBeTruthy();

    fireEvent.click(screen.getByText('Change account'));
    expect(onChangeAccount).toHaveBeenCalled();
    expect(screen.queryByText('Something went wrong')).toBeNull();

    fireEvent.click(screen.getByText('Trigger error'));
    expect(screen.getByText('Something went wrong')).toBeTruthy();

    rerender(<ConnectAccountModal {...baseProps} show={false} />);
    rerender(<ConnectAccountModal {...baseProps} show />);
    expect(screen.queryByText('Something went wrong')).toBeNull();
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
