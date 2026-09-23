import { render, waitFor } from '@testing-library/react';
import React from 'react';
import useSalesforceSync from './useSalesforceSync';
import { clearOptionLabels, getOptionLabel } from '../utils/optionLabels';

const mockFetchOptions = jest.fn();
jest.mock('../utils/featheryClient', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    fetchSalesforcePicklistOptions: (...args: any[]) =>
      mockFetchOptions(...args)
  }))
}));

const salesforceServar = {
  key: 'stage',
  type: 'dropdown',
  metadata: {
    options: ['closed_won'],
    option_labels: ['Schema Label'],
    salesforce_sync: {
      object_name: 'Opportunity',
      field_name: 'StageName',
      credential_key: 'cred'
    }
  }
};

function Harness({ servar, editMode = false }: any) {
  const { dynamicOptions } = useSalesforceSync(servar, editMode);
  return <div data-testid='count'>{dynamicOptions.length}</div>;
}

describe('useSalesforceSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearOptionLabels();
  });

  it('registers the fetched labels for text variables', async () => {
    mockFetchOptions.mockResolvedValue({
      options: [{ value: 'closed_won', label: 'Closed Won' }]
    });

    render(<Harness servar={salesforceServar} />);

    await waitFor(() =>
      expect(getOptionLabel('stage', 'closed_won')).toBe('Closed Won')
    );
  });

  it('leaves no labels behind when the fetch fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockFetchOptions.mockRejectedValue(new Error('nope'));

    render(<Harness servar={salesforceServar} />);

    await waitFor(() => expect(mockFetchOptions).toHaveBeenCalled());
    expect(getOptionLabel('stage', 'closed_won')).toBeUndefined();
  });

  it('does not fetch or register in edit mode', async () => {
    render(<Harness servar={salesforceServar} editMode />);

    await waitFor(() => expect(mockFetchOptions).not.toHaveBeenCalled());
    expect(getOptionLabel('stage', 'closed_won')).toBeUndefined();
  });

  it('does nothing for a field without a sync config', async () => {
    render(<Harness servar={{ key: 'plain', metadata: {} }} />);

    await waitFor(() => expect(mockFetchOptions).not.toHaveBeenCalled());
  });
});
