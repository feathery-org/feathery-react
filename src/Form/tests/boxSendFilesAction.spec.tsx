import { BrowserMod, ClientMod, FormHelperMod, GridMod } from './testMocks';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { JSForm } from '..';
import { fieldValues } from '../../utils/init';
import { sendBoxFiles } from '../../integrations/box';

// Mocked at the same boundary as the other third-party integrations (schwab,
// plaid, connectAccount, ...) in testMocks.tsx: Form only needs to know it
// calls sendBoxFiles correctly and reacts to what it resolves with. The
// endpoint call itself is sendBoxFiles's own responsibility.
jest.mock('../../integrations/box', () => ({
  sendBoxFiles: jest.fn()
}));

const mockedSendBoxFiles = sendBoxFiles as jest.Mock;

const FILE_FIELD_KEY = 'box_file_field';

const defaultSteps = ClientMod._spies.formState.steps;

describe('box_send_files action', () => {
  const clickTrigger = async () =>
    fireEvent.click(await screen.findByTestId('btn'));

  beforeEach(() => {
    jest.clearAllMocks();
    delete (fieldValues as any)[FILE_FIELD_KEY];
    mockedSendBoxFiles.mockResolvedValue(true);

    // One step with a real file_upload servar, so submitAllUploadedFiles has
    // something to find. The shared testMocks.tsx default has none.
    ClientMod._spies.formState.steps = [
      {
        key: 'step-1',
        id: 's1',
        servar_fields: [
          {
            servar: {
              key: FILE_FIELD_KEY,
              id: 'servar-file-1',
              type: 'file_upload',
              name: '',
              required: false
            },
            properties: {}
          }
        ],
        buttons: [],
        next_conditions: []
      }
    ];

    GridMod._spies.actions = [{ type: 'box_send_files' }];
    // The riskiest path: the button's "Validate & Submit Step" toggle is off,
    // so submitPromise alone would never persist the uploaded file.
    GridMod._spies.submit = false;
  });

  afterEach(() => {
    cleanup();
    ClientMod._spies.formState.steps = defaultSteps;
  });

  it('force-submits uploaded files before sending, with the submit toggle off', async () => {
    (fieldValues as any)[FILE_FIELD_KEY] = new File(['content'], 'a.pdf');

    render(<JSForm formId='f1' _internalId='iid-box-send-1' />);
    await clickTrigger();

    await waitFor(() => expect(mockedSendBoxFiles).toHaveBeenCalled());
    const client = GridMod._spies.form.client;
    expect(client.submitFiles).toHaveBeenCalledWith([
      {
        servar: { key: FILE_FIELD_KEY, file_upload: expect.anything() },
        stepKey: 'step-1'
      }
    ]);

    // submitFiles must complete before sendBoxFiles is called.
    const submitOrder = client.submitFiles.mock.invocationCallOrder[0];
    const sendOrder = mockedSendBoxFiles.mock.invocationCallOrder[0];
    expect(submitOrder).toBeLessThan(sendOrder);
  });

  it('stops the chain when sendBoxFiles fails', async () => {
    (fieldValues as any)[FILE_FIELD_KEY] = new File(['content'], 'a.pdf');
    mockedSendBoxFiles.mockResolvedValue(false);
    GridMod._spies.actions = [
      { type: 'box_send_files' },
      { type: 'url', url: 'https://example.com/after-send', open_tab: false }
    ];

    render(<JSForm formId='f1' _internalId='iid-box-send-2' />);
    await clickTrigger();

    await waitFor(() => expect(mockedSendBoxFiles).toHaveBeenCalled());
    // The following url action must not have run.
    expect(BrowserMod._spies.location.href).toBe('https://example.com/');
  });

  it('lets a following action run when sendBoxFiles succeeds (regression guard: no unconditional break)', async () => {
    (fieldValues as any)[FILE_FIELD_KEY] = new File(['content'], 'a.pdf');
    GridMod._spies.actions = [
      { type: 'box_send_files' },
      { type: 'url', url: 'https://example.com/after-send', open_tab: false }
    ];

    render(<JSForm formId='f1' _internalId='iid-box-send-3' />);
    await clickTrigger();

    await waitFor(() =>
      expect(BrowserMod._spies.location.href).toBe(
        'https://example.com/after-send'
      )
    );
  });

  it('does nothing and does not block a following action when no files are uploaded', async () => {
    // fieldValues[FILE_FIELD_KEY] intentionally left unset.
    GridMod._spies.actions = [
      { type: 'box_send_files' },
      { type: 'url', url: 'https://example.com/after-send', open_tab: false }
    ];

    render(<JSForm formId='f1' _internalId='iid-box-send-4' />);
    await clickTrigger();

    await waitFor(() =>
      expect(BrowserMod._spies.location.href).toBe(
        'https://example.com/after-send'
      )
    );
    expect(mockedSendBoxFiles).not.toHaveBeenCalled();
    const client = GridMod._spies.form.client;
    expect(client.submitFiles).not.toHaveBeenCalled();
  });

  it('surfaces an error and does not escape the action loop when the file submit rejects', async () => {
    (fieldValues as any)[FILE_FIELD_KEY] = new File(['content'], 'a.pdf');

    render(<JSForm formId='f1' _internalId='iid-box-send-5' />);
    // Grab the client only after the initial render populates GridMod._spies.form.
    await screen.findByTestId('btn');
    const client = GridMod._spies.form.client;
    client.submitFiles.mockRejectedValueOnce(new Error('upload failed'));

    await clickTrigger();

    await waitFor(() =>
      expect(FormHelperMod.setFormElementError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'upload failed' })
      )
    );
    expect(mockedSendBoxFiles).not.toHaveBeenCalled();
  });
});
