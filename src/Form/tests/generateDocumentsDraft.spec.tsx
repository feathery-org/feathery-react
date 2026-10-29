import './testMocks';
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
