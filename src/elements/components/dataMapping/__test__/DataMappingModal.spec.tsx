import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import DataMappingModal from '../DataMappingModal';
import { DataMappingClient, DataMappingModalConfig } from '../useDataMapping';

const config: DataMappingModalConfig = {
  hubs: [{ hub_id: 'hub-1', excluded_field_ids: [] }]
};

const baseSchema = {
  id: 'hub-1',
  key: 'Clients',
  fields: [
    {
      id: 'f1',
      key: 'name',
      type: 'text',
      required: true,
      unique: false,
      metadata: {},
      constraint_rules: [],
      order: 0
    },
    {
      id: 'f2',
      key: 'email',
      type: 'email',
      required: false,
      unique: false,
      metadata: {},
      constraint_rules: [],
      order: 1
    }
  ]
};

const makeClient = (overrides: Partial<DataMappingClient> = {}) =>
  ({
    fetchHubSchemas: jest.fn().mockResolvedValue([baseSchema]),
    stagedHubAction: jest.fn().mockResolvedValue({ entries: [], errors: [] }),
    ...overrides
  } as DataMappingClient);

describe('DataMappingModal', () => {
  it('renders the dialog and dropzone in import mode', async () => {
    const client = makeClient();
    render(
      <DataMappingModal config={config} client={client} onClose={jest.fn()} />
    );

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(
      await screen.findByTestId('data-mapping-dropzone')
    ).toBeInTheDocument();
  });

  it('renders the review table with finalize disabled while errors exist', async () => {
    const client = makeClient({
      stagedHubAction: jest.fn().mockResolvedValue({
        entries: [{ entry_id: 'e1', data: { name: 'Ann' } }],
        errors: [{ entry_id: 'e1', field_key: 'name', message: 'Bad value' }]
      })
    });
    render(
      <DataMappingModal config={config} client={client} onClose={jest.fn()} />
    );

    await waitFor(() =>
      expect(
        screen.getByTestId('data-mapping-review-table')
      ).toBeInTheDocument()
    );

    const finalizeButton = screen.getByRole('button', {
      name: /confirm & finalize/i
    });
    expect(finalizeButton).toBeDisabled();
    expect(screen.getByText('Bad value')).toBeInTheDocument();
  });
});
