import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DataMappingModal from './DataMappingModal';

// Exercise the real CSV parser, dropdown selection, draft restore and import.
test('imports the selected duplicate columns after closing and reopening the mapper', async () => {
  const user = userEvent.setup();
  const client = {
    getHubSchemas: jest.fn().mockResolvedValue({
      hubs: [
        {
          id: 'duplicate-columns-test',
          key: 'Accounts',
          fields: [
            {
              id: 'primary',
              key: 'Primary',
              type: 'text',
              required: true,
              unique: false
            },
            {
              id: 'secondary',
              key: 'Secondary',
              type: 'text',
              required: true,
              unique: false
            }
          ]
        }
      ]
    }),
    dataHubAction: jest.fn().mockResolvedValue([])
  };
  const props = {
    hubs: [{ hub_id: 'duplicate-columns-test' }],
    client,
    onClose: jest.fn()
  };
  const first = render(<DataMappingModal {...props} />);
  const input = first.container.querySelector('input[type="file"]');
  if (!input) throw new Error('File input missing');
  fireEvent.change(input, {
    target: {
      files: [
        new File(['First Name,Unused,First Name\nJohn,,Jane'], 'owners.csv', {
          type: 'text/csv'
        })
      ]
    }
  });
  await screen.findByRole(
    'combobox',
    { name: 'Primary source column' },
    { timeout: 4000 }
  );
  expect(
    screen.getByRole('columnheader', { name: 'First Name — A' })
  ).toBeInTheDocument();
  expect(
    screen.getByRole('columnheader', { name: 'First Name — C' })
  ).toBeInTheDocument();
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Primary source column' }),
    JSON.stringify(['Sheet1', 'First Name', 0])
  );
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Secondary source column' }),
    JSON.stringify(['Sheet1', 'First Name', 2])
  );
  expect(
    screen.getByRole('combobox', { name: 'Primary source column' })
  ).toHaveValue(JSON.stringify(['Sheet1', 'First Name', 0]));
  first.unmount();
  render(<DataMappingModal {...props} />);
  const secondary = await screen.findByRole('combobox', {
    name: 'Secondary source column'
  });
  expect(secondary).toHaveValue(JSON.stringify(['Sheet1', 'First Name', 2]));
  await user.click(
    screen.getByRole('button', { name: 'Confirm', exact: true })
  );
  await user.click(screen.getByRole('button', { name: 'Yes, save' }));
  await waitFor(() =>
    expect(client.dataHubAction).toHaveBeenCalledWith({
      hubId: 'duplicate-columns-test',
      operation: 'create',
      verification: 'unverified',
      data: [{ Primary: 'John', Secondary: 'Jane' }],
      idFieldId: undefined
    })
  );
});
