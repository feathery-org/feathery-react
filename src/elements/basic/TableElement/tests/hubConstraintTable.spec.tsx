import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TableElement from '../index';
import { _clearUnsavedWorkRegistry } from '../../../../utils/unsavedWork';

const MESSAGE = 'Completed intake must be approved';
const FIELDS = [
  {
    id: 'stage-id',
    key: 'stage',
    type: 'text',
    required: false,
    unique: false
  },
  {
    id: 'review-id',
    key: 'review',
    type: 'text',
    required: false,
    unique: false,
    constraint_rules: [
      {
        when: [
          { field_key: 'stage', comparator: 'equal', value: 'Complete' },
          { field_key: 'gate', comparator: 'equal', value: 'true' }
        ],
        constraint: {
          field_key: 'value',
          comparator: 'equal',
          value: 'Approved'
        },
        error_message: MESSAGE
      }
    ]
  },
  {
    id: 'gate-id',
    key: 'gate',
    type: 'boolean',
    required: false,
    unique: false
  }
];

const cell = (text: string) =>
  screen.getByText(text).closest('[role="gridcell"]')!;
const saveButton = () => screen.getByRole('button', { name: 'Save' });
const editCell = (from: string, to: string) => {
  fireEvent.doubleClick(cell(from));
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: to } });
  fireEvent.keyDown(input, { key: 'Enter' });
};

const renderHub = ({
  verified = true,
  stage = 'Draft',
  hidden = ['gate-id'],
  gate = true,
  fields = FIELDS,
  saveError
}: {
  verified?: boolean;
  stage?: string;
  hidden?: string[];
  gate?: unknown;
  fields?: typeof FIELDS;
  saveError?: string;
} = {}) => {
  const dataHubAction = jest.fn(({ operation, data }: any) =>
    Promise.resolve(
      operation === 'get'
        ? [
            {
              id: 'entry1',
              verified,
              data: { stage, review: 'Pending review', gate }
            }
          ]
        : {
            updated: 1,
            ...(saveError && data.review !== 'Approved'
              ? { error: saveError }
              : {})
          }
    )
  );
  const client = {
    dataHubAction,
    getHubSchemas: jest.fn(() =>
      Promise.resolve({ hubs: [{ id: 'hub1', key: 'intake', fields }] })
    )
  };
  render(
    <TableElement
      element={{
        id: 'constraints-table',
        styles: {},
        properties: {
          columns: [],
          actions: [],
          search: false,
          sort: false,
          pagination: 0,
          transpose: false,
          display_mode: 'spreadsheet',
          enable_editing: true,
          data_source: 'hub',
          hub_id: 'hub1',
          hub_verification: 'all',
          hidden_hub_fields: hidden
        }
      }}
      responsiveStyles={{
        addTargets: jest.fn(),
        apply: jest.fn(),
        getTarget: jest.fn(() => ({}))
      }}
      client={client}
    />
  );
  return dataHubAction;
};

beforeEach(() => {
  // Virtualized cells need a nonzero viewport in jsdom.
  jest.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(900);
  jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
});

afterEach(() => {
  _clearUnsavedWorkRegistry();
  jest.restoreAllMocks();
  sessionStorage.clear();
});

describe('Hub conditional cell validation', () => {
  test('a matching hidden attachment constraint permits saving a verified row', async () => {
    const dataHubAction = renderHub({
      stage: 'Complete',
      gate: [{ url: 'https://example.com/invoice.pdf', path: 'invoice.pdf' }],
      fields: FIELDS.map((field) =>
        field.key === 'gate'
          ? { ...field, type: 'file' }
          : field.key === 'review'
          ? {
              ...field,
              constraint_rules: [
                {
                  when: [
                    {
                      field_key: 'stage',
                      comparator: 'equal',
                      value: 'Complete'
                    }
                  ],
                  constraint: {
                    field_key: 'gate',
                    comparator: 'contains',
                    value: 'invoice.pdf'
                  },
                  error_message: 'An invoice is required'
                }
              ]
            }
          : field
      )
    });
    await screen.findByText('Pending review');
    expect(cell('Pending review')).not.toHaveAttribute('title');
    editCell('Pending review', 'Approved');
    expect(saveButton()).toBeEnabled();
    fireEvent.click(saveButton());
    await waitFor(() => expect(dataHubAction).toHaveBeenCalledTimes(2));
    expect(dataHubAction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        operation: 'update',
        data: { review: 'Approved' }
      })
    );
  });

  test('dependency edits flag the owner and correcting the buffered row clears the error', async () => {
    const dataHubAction = renderHub();
    await screen.findByText('Pending review');

    editCell('Draft', 'Complete');

    expect(cell('Pending review')).toHaveAttribute('title', MESSAGE);
    expect(cell('Complete')).not.toHaveAttribute('title');
    expect(saveButton()).toBeDisabled();
    expect(dataHubAction).toHaveBeenCalledTimes(1);

    editCell('Complete', 'Draft');
    expect(cell('Pending review')).not.toHaveAttribute('title');
    expect(saveButton()).toBeEnabled();

    editCell('Draft', 'Complete');
    editCell('Pending review', 'Approved');
    expect(cell('Approved')).not.toHaveAttribute('title');
    expect(saveButton()).toBeEnabled();
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(dataHubAction).toHaveBeenCalledWith({
        hubId: 'hub1',
        operation: 'update',
        where: [{ entryId: 'entry1' }],
        data: { stage: 'Complete', review: 'Approved' }
      })
    );
  });

  test('staged conditional errors remain visible and permit saving', async () => {
    const dataHubAction = renderHub({ verified: false });
    await screen.findByText('Pending review');

    editCell('Draft', 'Complete');

    expect(cell('Pending review')).toHaveAttribute('title', MESSAGE);
    expect(screen.getByRole('status')).toHaveTextContent(
      '1 error on unvalidated rows'
    );
    expect(saveButton()).toBeEnabled();
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(dataHubAction).toHaveBeenCalledWith({
        hubId: 'hub1',
        operation: 'update',
        verification: 'unverified',
        where: [{ entryId: 'entry1' }],
        data: { stage: 'Complete' }
      })
    );
  });

  test('hidden dependencies are evaluated without rendering their columns', async () => {
    renderHub({ stage: 'Complete', hidden: ['stage-id', 'gate-id'] });
    await screen.findByText('Pending review');

    expect(screen.queryByRole('columnheader', { name: 'stage' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'gate' })).toBeNull();
    expect(cell('Pending review')).toHaveAttribute('title', MESSAGE);

    editCell('Pending review', 'Approved');
    expect(cell('Approved')).not.toHaveAttribute('title');
    expect(saveButton()).toBeEnabled();
  });

  test('pasting a dependency and its owner validates and saves the complete row', async () => {
    const dataHubAction = renderHub();
    await screen.findByText('Pending review');

    fireEvent.mouseDown(cell('Draft'), { button: 0 });
    fireEvent.paste(screen.getByRole('grid'), {
      clipboardData: { getData: () => 'Complete\tApproved' }
    });

    await screen.findByText('Approved');
    expect(cell('Approved')).not.toHaveAttribute('title');
    expect(saveButton()).toBeEnabled();
    fireEvent.click(saveButton());

    await waitFor(() => expect(dataHubAction).toHaveBeenCalledTimes(2));
    expect(dataHubAction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: { stage: 'Complete', review: 'Approved' }
      })
    );
  });

  test('correcting a staged buffered row clears its previous server constraint error', async () => {
    const dataHubAction = renderHub({ verified: false, saveError: MESSAGE });
    await screen.findByText('Pending review');
    editCell('Draft', 'Complete');
    fireEvent.click(saveButton());
    await waitFor(() => expect(dataHubAction).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Saving…')).toBeNull());

    editCell('Pending review', 'Approved');

    expect(cell('Approved')).not.toHaveAttribute('title');
    expect(cell('Complete')).not.toHaveAttribute('title');
    expect(screen.getByRole('status')).not.toHaveTextContent('error');
    expect(saveButton()).toBeEnabled();

    fireEvent.click(saveButton());
    await waitFor(() => expect(dataHubAction).toHaveBeenCalledTimes(3));
    expect(dataHubAction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        operation: 'update',
        verification: 'unverified',
        data: { review: 'Approved' }
      })
    );
    await waitFor(() => expect(screen.queryByText('Saving…')).toBeNull());

    expect(cell('Approved')).not.toHaveAttribute('title');
    expect(cell('Complete')).not.toHaveAttribute('title');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
