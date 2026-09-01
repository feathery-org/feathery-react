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
const FILE_FIELD_ID = 'servar-file-1';

const defaultSteps = ClientMod._spies.formState.steps;

describe('box_send_files action', () => {
  const clickTrigger = async () =>
    fireEvent.click(await screen.findByTestId('btn'));

  beforeEach(() => {
    jest.clearAllMocks();
    delete (fieldValues as any)[FILE_FIELD_KEY];
    mockedSendBoxFiles.mockResolvedValue(true);

    // One step with a real file_upload servar, so submitFieldFiles has
    // something to find. The shared testMocks.tsx default has none.
    ClientMod._spies.formState.steps = [
      {
        key: 'step-1',
        id: 's1',
        servar_fields: [
          {
            servar: {
              key: FILE_FIELD_KEY,
              id: FILE_FIELD_ID,
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

    // A real button always has its target field(s) configured; the field_key
    // is resolved server-side (see property_field_id_to_key) before it ever
    // reaches the runtime.
    GridMod._spies.actions = [
      {
        type: 'box_send_files',
        field_ids: [
          { field_id: FILE_FIELD_ID, field_type: 'servar', field_key: FILE_FIELD_KEY }
        ]
      }
    ];
    // The riskiest path: the button's "Validate & Submit Step" toggle is off,
    // so submitPromise alone would never persist the uploaded file.
    GridMod._spies.submit = false;
  });

  afterEach(() => {
    cleanup();
    ClientMod._spies.formState.steps = defaultSteps;
  });

  it('force-submits the configured field(s) before sending, with the submit toggle off', async () => {
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
      ...GridMod._spies.actions,
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
      ...GridMod._spies.actions,
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

  it('does nothing and does not block a following action when the configured field has no value', async () => {
    // fieldValues[FILE_FIELD_KEY] intentionally left unset.
    GridMod._spies.actions = [
      ...GridMod._spies.actions,
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

  it('only submits and sends the fields named in field_ids, not every file field on the form', async () => {
    const OTHER_FIELD_KEY = 'other_file_field';
    ClientMod._spies.formState.steps = [
      {
        ...ClientMod._spies.formState.steps[0],
        servar_fields: [
          ...ClientMod._spies.formState.steps[0].servar_fields,
          {
            servar: {
              key: OTHER_FIELD_KEY,
              id: 'servar-file-2',
              type: 'file_upload',
              name: '',
              required: false
            },
            properties: {}
          }
        ]
      }
    ];
    (fieldValues as any)[FILE_FIELD_KEY] = new File(['content'], 'a.pdf');
    (fieldValues as any)[OTHER_FIELD_KEY] = new File(['content'], 'b.pdf');

    render(<JSForm formId='f1' _internalId='iid-box-send-8' />);
    await clickTrigger();

    await waitFor(() => expect(mockedSendBoxFiles).toHaveBeenCalled());
    const client = GridMod._spies.form.client;
    expect(client.submitFiles).toHaveBeenCalledWith([
      {
        servar: { key: FILE_FIELD_KEY, file_upload: expect.anything() },
        stepKey: 'step-1'
      }
    ]);
    expect(mockedSendBoxFiles).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      [FILE_FIELD_ID]
    );

    delete (fieldValues as any)[OTHER_FIELD_KEY];
  });

  it('passes every configured field_id through to sendBoxFiles, even ones with no current value', async () => {
    (fieldValues as any)[FILE_FIELD_KEY] = new File(['content'], 'a.pdf');
    GridMod._spies.actions = [
      {
        type: 'box_send_files',
        field_ids: [
          { field_id: FILE_FIELD_ID, field_type: 'servar', field_key: FILE_FIELD_KEY },
          {
            field_id: 'servar-file-2',
            field_type: 'servar',
            field_key: 'field_not_on_this_form'
          }
        ]
      }
    ];

    render(<JSForm formId='f1' _internalId='iid-box-send-6' />);
    await clickTrigger();

    await waitFor(() =>
      expect(mockedSendBoxFiles).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        [FILE_FIELD_ID, 'servar-file-2']
      )
    );
  });

  it('does nothing and sends nothing when field_ids is empty', async () => {
    (fieldValues as any)[FILE_FIELD_KEY] = new File(['content'], 'a.pdf');
    GridMod._spies.actions = [
      { type: 'box_send_files', field_ids: [] },
      { type: 'url', url: 'https://example.com/after-send', open_tab: false }
    ];

    render(<JSForm formId='f1' _internalId='iid-box-send-7' />);
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
