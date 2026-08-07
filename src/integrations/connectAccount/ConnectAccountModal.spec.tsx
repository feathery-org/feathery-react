import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ConnectAccountModal from './ConnectAccountModal';

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
});
