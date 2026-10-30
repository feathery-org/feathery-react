import { BrowserMod, GridMod } from './testMocks';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { JSForm } from '..';
import { setFormInternalState } from '../../utils/internalState';

jest.mock('../components/ActionToast/useEnvelopeGenerationToast', () => {
  const state = {
    currentEnvelopeGeneration: [],
    initializeEnvelopeGeneration: jest.fn(),
    updateEnvelopeGeneration: jest.fn(),
    showEnvelopeOutcome: jest.fn(),
    clearEnvelopeGeneration: jest.fn()
  };
  return { useEnvelopeGenerationToast: () => state, _spies: state };
});

// Keep pdf.js pending: these tests drive the review toolbar, not the PDFs.
jest.mock('../../elements/components/DocumentViewer/pdfjsLoader', () => ({
  loadPdfjs: jest.fn(() => new Promise(() => {}))
}));

beforeAll(() => {
  Object.assign(
    jest.requireMock('../../utils/document'),
    jest.requireActual('../../utils/document')
  );
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

const toastSpies = () =>
  jest.requireMock('../components/ActionToast/useEnvelopeGenerationToast')
    ._spies;

it.each([
  [true, 'created', 'Saved as Draft'],
  [false, 'sent', 'Sent for Signature']
])(
  'reports the correct direct DocuSign outcome for draft=%s',
  async (draft, status, label) => {
    const id = `docusign-draft-${draft}`;
    render(<JSForm formId='f1' _internalId={id} />);
    await screen.findByTestId('btn');
    const state = (setFormInternalState as jest.Mock).mock.calls.find(
      ([formId, values]) => formId === id && values.generateEnvelopeFlow
    )[1];
    const result = { docusign_envelope_id: 'ds-1', status };
    state.client.generateEnvelopes = jest.fn().mockResolvedValue(result);
    const action = {
      documents: ['tpl-1'],
      envelope_action: 'sign',
      sign_method: 'docusign',
      draft
    };
    await act(async () => {
      await expect(state.generateEnvelopeFlow!(action)).resolves.toEqual(
        result
      );
    });
    expect(state.client.generateEnvelopes).toHaveBeenCalledWith(action);
    expect(
      jest.requireMock('../components/ActionToast/useEnvelopeGenerationToast')
        ._spies.showEnvelopeOutcome
    ).toHaveBeenCalledWith(expect.any(String), label, ['tpl-1']);
  }
);

it('runs document_review on Create Draft while the review screen stays open', async () => {
  const id = 'review-keep-open';
  const onDocumentReview = jest.fn();
  render(
    <JSForm formId='f1' _internalId={id} onDocumentReview={onDocumentReview} />
  );
  await screen.findByTestId('btn');
  const state = (setFormInternalState as jest.Mock).mock.calls.find(
    ([formId, values]) => formId === id && values.generateEnvelopeFlow
  )[1];
  state.client.generateEnvelopes = jest.fn().mockResolvedValue({
    documents: [
      { type: 'form', pdf_url: 'http://x/a.pdf', envelope_id: 'env-1' }
    ],
    expires_at: '2999-01-01T00:00:00Z'
  });
  const draftResult = { docusign_envelope_id: 'ds-1', status: 'complete' };
  state.client.finalizeEnvelopeReview = jest
    .fn()
    .mockResolvedValue(draftResult);

  let flow: Promise<any> = Promise.resolve();
  await act(async () => {
    flow = state.generateEnvelopeFlow!({
      documents: ['tpl-1'],
      envelope_action: 'open_in_editor',
      editor_toolbar_actions: ['sign', 'draft'],
      editor_close_on_action: false,
      sign_method: 'docusign'
    });
  });
  const settled = jest.fn();
  flow.then(settled, settled);

  fireEvent.click(await screen.findByRole('button', { name: 'Create Draft' }));

  await waitFor(() =>
    expect(onDocumentReview).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: expect.objectContaining({
          action: 'draft',
          docusignEnvelopeId: 'ds-1'
        })
      })
    )
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled()
  );
  expect(screen.getByRole('button', { name: 'Create Draft' })).toBeDisabled();
  expect(state.client.finalizeEnvelopeReview).toHaveBeenCalledWith(
    expect.any(Object),
    expect.objectContaining({ draft: true, refreshDraft: false })
  );
  expect(settled).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Back' }));

  await expect(flow).resolves.toEqual({
    ...draftResult,
    reviewAction: 'draft'
  });
});

describe('a kept-open review screen', () => {
  const reviewPayload = {
    documents: [
      { type: 'form', pdf_url: 'http://x/a.pdf', envelope_id: 'env-1' }
    ],
    expires_at: '2999-01-01T00:00:00Z'
  };
  const draftResult = { docusign_envelope_id: 'ds-1', status: 'complete' };
  const signResult = { docusign_envelope_id: 'ds-1', status: 'complete' };
  const downloadResult = { files: ['http://x/a.pdf'] };
  const keepOpenAction = {
    documents: ['tpl-1'],
    envelope_action: 'open_in_editor',
    editor_toolbar_actions: ['sign', 'draft', 'download'],
    editor_close_on_action: false,
    sign_method: 'docusign'
  };
  const button = (name: string) => screen.getByRole('button', { name });
  const press = async (name: string) => {
    fireEvent.click(button(name));
    await waitFor(() => expect(button('Back')).toBeEnabled());
  };

  const renderForm = async (id: string) => {
    render(<JSForm formId='f1' _internalId={id} />);
    await screen.findByTestId('btn');
    const state = (setFormInternalState as jest.Mock).mock.calls.find(
      ([formId, values]) => formId === id && values.generateEnvelopeFlow
    )[1];
    state.client.generateEnvelopes = jest.fn().mockResolvedValue(reviewPayload);
    state.client.finalizeEnvelopeReview = jest.fn(
      async (_: any, { envelopeAction, draft }: any) => {
        if (draft) return draftResult;
        return envelopeAction === 'sign' ? signResult : downloadResult;
      }
    );
    return state;
  };

  const openFromRule = async (state: any) => {
    let flow: Promise<any> = Promise.resolve();
    await act(async () => {
      flow = state.generateEnvelopeFlow!(keepOpenAction);
    });
    await screen.findByRole('button', { name: 'Create Draft' });
    // Boxed: an async function returning the promise would wait on it.
    return { flow };
  };

  it('resolves with the draft, not a later Download', async () => {
    const { flow } = await openFromRule(await renderForm('keep-open-download'));

    await press('Create Draft');
    await press('Download');
    fireEvent.click(button('Back'));

    await expect(flow).resolves.toEqual({
      ...draftResult,
      reviewAction: 'draft'
    });
  });

  it('resolves with a Sign that follows the draft', async () => {
    const { flow } = await openFromRule(await renderForm('keep-open-sign'));

    await press('Create Draft');
    await press('Sign');
    fireEvent.click(button('Back'));

    await expect(flow).resolves.toEqual({
      ...signResult,
      reviewAction: 'sign'
    });
  });

  it('reports a Sign held as a draft and keeps it editable', async () => {
    const state = await renderForm('keep-open-held-sign');
    const heldResult = { ...signResult, docusign_status: 'created' };
    state.client.finalizeEnvelopeReview.mockResolvedValue(heldResult);
    const { flow } = await openFromRule(state);

    await press('Sign');

    expect(toastSpies().showEnvelopeOutcome).toHaveBeenCalledWith(
      expect.any(String),
      'Saved as Draft',
      ['tpl-1']
    );
    expect(button('Sign')).toBeEnabled();
    expect(button('Create Draft')).toBeDisabled();
    fireEvent.click(button('Back'));
    await expect(flow).resolves.toEqual({
      ...heldResult,
      reviewAction: 'sign'
    });
  });

  it('lets the filler retry a close whose button flow failed', async () => {
    const onAction = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Flow failed'));
    const id = 'keep-open-flow-fails';
    render(<JSForm formId='f1' _internalId={id} onAction={onAction} />);
    await screen.findByTestId('btn');
    const state = (setFormInternalState as jest.Mock).mock.calls.find(
      ([formId, values]) => formId === id && values.generateEnvelopeFlow
    )[1];
    state.client.generateEnvelopes = jest.fn().mockResolvedValue(reviewPayload);
    state.client.finalizeEnvelopeReview = jest
      .fn()
      .mockResolvedValue(draftResult);
    GridMod._spies.actions = [
      { type: 'open_fuser_envelopes', ...keepOpenAction },
      { type: 'url', url: 'example.com/next', open_tab: true }
    ];
    GridMod._spies.submit = false;

    fireEvent.click(screen.getByTestId('btn'));
    await screen.findByRole('button', { name: 'Create Draft' });
    await press('Create Draft');
    fireEvent.click(button('Back'));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Flow failed')
    );
    expect(BrowserMod.openTab).not.toHaveBeenCalled();
    fireEvent.click(button('Back'));

    await waitFor(() =>
      expect(BrowserMod.openTab).toHaveBeenCalledWith(
        'https://example.com/next'
      )
    );
  });

  it('continues a button flow once on close', async () => {
    await renderForm('keep-open-button');
    GridMod._spies.actions = [
      { type: 'open_fuser_envelopes', ...keepOpenAction },
      { type: 'url', url: 'example.com/next', open_tab: true }
    ];
    GridMod._spies.submit = false;

    fireEvent.click(screen.getByTestId('btn'));
    await screen.findByRole('button', { name: 'Create Draft' });
    await press('Create Draft');
    fireEvent.click(button('Back'));
    fireEvent.click(button('Back'));
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(BrowserMod.openTab).toHaveBeenCalledTimes(1));
    expect(BrowserMod.openTab).toHaveBeenCalledWith('https://example.com/next');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    expect(BrowserMod.openTab).toHaveBeenCalledTimes(1);
  });
});

it.each([
  ['Sign', 'created', 'Saved as Draft'],
  ['Sign', 'sent', 'Sent for Signature'],
  ['Sign', undefined, 'Sent for Signature'],
  ['Create Draft', 'sent', 'Sent for Signature'],
  ['Create Draft', undefined, 'Saved as Draft']
])(
  'labels a review-screen %s whose DocuSign status is %s',
  async (button, docusignStatus, label) => {
    const id = `button-${button}-${docusignStatus}`;
    render(<JSForm formId='f1' _internalId={id} />);
    await screen.findByTestId('btn');
    const state = (setFormInternalState as jest.Mock).mock.calls.find(
      ([formId, values]) => formId === id && values.generateEnvelopeFlow
    )[1];
    state.client.generateEnvelopes = jest.fn().mockResolvedValue({
      documents: [
        { type: 'form', pdf_url: 'http://x/a.pdf', envelope_id: 'env-1' }
      ],
      expires_at: '2999-01-01T00:00:00Z'
    });
    state.client.finalizeEnvelopeReview = jest.fn().mockResolvedValue({
      docusign_envelope_id: 'ds-1',
      status: 'complete',
      docusign_status: docusignStatus
    });
    GridMod._spies.actions = [
      {
        type: 'open_fuser_envelopes',
        documents: ['tpl-1'],
        envelope_action: 'open_in_editor',
        editor_toolbar_actions: ['sign', 'draft'],
        sign_method: 'docusign'
      }
    ];
    GridMod._spies.submit = false;

    fireEvent.click(screen.getByTestId('btn'));
    fireEvent.click(await screen.findByRole('button', { name: button }));

    await waitFor(() =>
      expect(toastSpies().showEnvelopeOutcome).toHaveBeenCalledWith(
        expect.any(String),
        label,
        ['tpl-1']
      )
    );
  }
);
