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
import { loadReviewPrinter } from '../../utils/reviewPrint';

jest.mock('../components/ActionToast/useEnvelopeGenerationToast', () => {
  const state = {
    currentEnvelopeGeneration: [],
    initializeEnvelopeGeneration: jest.fn(),
    updateEnvelopeGeneration: jest.fn(),
    showEnvelopeOutcome: jest.fn(),
    clearEnvelopeGeneration: jest.fn()
  };
  return { useEnvelopeGenerationToast: () => state };
});

// Keep pdf.js pending: these tests drive the review toolbar, not the PDFs.
jest.mock('../../elements/components/DocumentViewer/pdfjsLoader', () => ({
  loadPdfjs: jest.fn(() => new Promise(() => {}))
}));

jest.mock('../../utils/reviewPrint', () => ({
  ...jest.requireActual('../../utils/reviewPrint'),
  loadReviewPrinter: jest.fn()
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
  jest.restoreAllMocks();
});

const files = ['http://x/a.pdf', 'http://x/b.pdf'];

const openPrintReview = async (id: string, onDocumentReview = jest.fn()) => {
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
  state.client.finalizeEnvelopeReview = jest.fn().mockResolvedValue({ files });
  let flow: Promise<any> = Promise.resolve();
  await act(async () => {
    flow = state.generateEnvelopeFlow!({
      documents: ['tpl-1'],
      envelope_action: 'open_in_editor',
      editor_toolbar_actions: ['print']
    });
  });
  flow.catch(() => {});
  fireEvent.click(await screen.findByRole('button', { name: 'Print' }));
  // Boxed: an async function returning the promise would wait on it.
  return { state, flow: { promise: flow } };
};

it('prints the finalized files and reports the print', async () => {
  const printer = jest.fn().mockResolvedValue(undefined);
  (loadReviewPrinter as jest.Mock).mockResolvedValue(printer);
  const onDocumentReview = jest.fn();

  const { state, flow } = await openPrintReview('print-ok', onDocumentReview);

  await expect(flow.promise).resolves.toEqual({
    files,
    reviewAction: 'print'
  });
  expect(state.client.finalizeEnvelopeReview).toHaveBeenCalledWith(
    expect.any(Object),
    expect.objectContaining({ envelopeAction: 'download', draft: false })
  );
  expect(printer).toHaveBeenCalledWith(files);
  expect(onDocumentReview).toHaveBeenCalledWith(
    expect.objectContaining({
      trigger: expect.objectContaining({ action: 'print', files })
    })
  );
});

it('does not finalize when printing cannot load', async () => {
  (loadReviewPrinter as jest.Mock).mockResolvedValue(null);

  const { state } = await openPrintReview('print-blocked');

  expect(
    await screen.findByText('Unable to load printing. Please try again.')
  ).toBeInTheDocument();
  expect(state.client.finalizeEnvelopeReview).not.toHaveBeenCalled();
});

it('keeps the review open with an error when the print fails', async () => {
  (loadReviewPrinter as jest.Mock).mockResolvedValue(
    jest.fn().mockRejectedValue(new Error('403'))
  );
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  const onDocumentReview = jest.fn();

  await openPrintReview('print-failed', onDocumentReview);

  expect(
    await screen.findByText('Unable to print the documents. Please try again.')
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Print' })).toBeEnabled()
  );
  expect(onDocumentReview).not.toHaveBeenCalled();
});
