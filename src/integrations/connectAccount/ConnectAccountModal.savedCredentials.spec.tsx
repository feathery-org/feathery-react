import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

describe('saved Box credentials', () => {
  it('requires explicit selection before attaching or browsing credentials', async () => {
    const props = createProps();
    render(<ConnectAccountModal {...props} />);
    expect(
      screen.getByRole('combobox', { name: 'Saved Box accounts' })
    ).toBeTruthy();
    expect(screen.getByText('Use selected account')).toBeDisabled();
    expect(props.client.selectAccountCredential).not.toHaveBeenCalled();
    expect(props.client.browseAccountResources).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c1' } });
    expect(props.client.selectAccountCredential).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Use selected account'));
    await waitFor(() =>
      expect(props.client.browseAccountResources).toHaveBeenCalledTimes(1)
    );
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
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'c2' } });
    fireEvent.click(screen.getByText('Use selected account'));
    expect(
      await screen.findByText('Please sign in to connect an account.')
    ).toBeTruthy();
    expect(props.client.browseAccountResources).not.toHaveBeenCalled();
    expect(props.onCredentialSelected).not.toHaveBeenCalled();
  });

  it('offers a new OAuth connection directly from a user click', async () => {
    const props = createProps();
    render(<ConnectAccountModal {...props} />);
    fireEvent.click(screen.getByText('Connect a new account'));
    expect(props.onChangeAccount).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(props.client.browseAccountResources).toHaveBeenCalledTimes(1)
    );
    expect(props.client.selectAccountCredential).not.toHaveBeenCalled();
  });

  it('keeps configuration hidden when connecting a new account fails', async () => {
    const props = createProps();
    props.onChangeAccount.mockResolvedValue('Please allow pop-ups.' as any);
    render(<ConnectAccountModal {...props} />);
    fireEvent.click(screen.getByText('Connect a new account'));
    expect(await screen.findByText('Please allow pop-ups.')).toBeTruthy();
    expect(props.client.browseAccountResources).not.toHaveBeenCalled();
  });
});
