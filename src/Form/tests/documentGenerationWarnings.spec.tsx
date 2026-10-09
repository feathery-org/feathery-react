import { GridMod } from './testMocks';
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
import { DocumentGenerationWarning } from '../../utils/documentGenerationWarnings';
import { ACTION_GENERATE_ENVELOPES } from '../../utils/elementActions';

const mockViewer: { props: any } = { props: null };
jest.mock('../../elements/components/DocumentViewer', () => ({
  __esModule: true,
  default: (props: any) => {
    mockViewer.props = props;
    return <div data-testid='review-viewer' />;
  }
}));

const warning: DocumentGenerationWarning = {
  code: 'pdf_option_unmatched',
  document_name: 'IAA',
  field_name: 'Investment experience',
  page: 1,
  supplied_values: ['Extensive'],
  allowed_options: ['Moderate'],
  message: 'Extensive is not a PDF option. Allowed options: Moderate.'
};

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.assign(
    jest.requireMock('../../utils/document'),
    jest.requireActual('../../utils/document')
  );
  jest
    .spyOn(jest.requireMock('../../utils/document'), 'getSignUrl')
    .mockReturnValue('https://example.com/sign');
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  mockViewer.props = null;
  GridMod._spies.actions = [];
  jest.requireMock('../../utils/browser')._spies.location.href =
    'https://example.com/';
});

async function renderForm() {
  render(<JSForm formId='f1' _internalId='warning-form' />);
  await screen.findByTestId('btn');
  return (setFormInternalState as jest.Mock).mock.calls.find(
    ([id, state]) => id === 'warning-form' && state.generateEnvelopeFlow
  )[1];
}

it('shows grouped warnings with progress off, keeps files available and lets the user dismiss', async () => {
  const state = await renderForm();
  const result = {
    files: ['https://x/1.pdf'],
    warnings: [warning, { ...warning }]
  };
  state.client.generateEnvelopes = jest.fn().mockResolvedValue(result);
  await act(async () => {
    await expect(
      state.generateEnvelopeFlow({
        documents: ['doc1'],
        envelope_action: 'fill'
      })
    ).resolves.toEqual(result);
  });
  expect(screen.getByRole('status')).toHaveTextContent(
    'Some PDF fields could not be filled.'
  );
  expect(screen.getByText('View 1 mapping warning')).toBeInTheDocument();
  fireEvent.click(screen.getByText('View 1 mapping warning'));
  expect(screen.getByRole('status')).toHaveTextContent(warning.message);

  // Later successful actions do not silently discard a warning still being read.
  state.client.generateEnvelopes.mockResolvedValue({ files: [] });
  await act(async () => {
    await state.generateEnvelopeFlow({
      documents: ['doc2'],
      envelope_action: 'fill'
    });
  });
  expect(screen.getByRole('status')).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('button', { name: 'Dismiss mapping warnings' })
  );
  expect(
    screen.queryByText('Some PDF fields could not be filled.')
  ).not.toBeInTheDocument();
});

it('shows warnings from the button action without converting successful generation to an error', async () => {
  GridMod._spies.actions = [
    {
      type: ACTION_GENERATE_ENVELOPES,
      documents: ['doc1'],
      envelope_action: 'fill'
    }
  ];
  const state = await renderForm();
  state.client.generateEnvelopes = jest
    .fn()
    .mockResolvedValue({ files: [], warnings: [warning] });
  fireEvent.click(screen.getByTestId('btn'));
  await screen.findByText('Some PDF fields could not be filled.');
  expect(state.client.generateEnvelopes).toHaveBeenCalledTimes(1);
});

it('preserves generation warnings through review finalization and after closing the viewer', async () => {
  const state = await renderForm();
  const generated = {
    documents: [],
    expires_at: '2999-01-01',
    warnings: [warning]
  };
  state.client.generateEnvelopes = jest.fn().mockResolvedValue(generated);
  state.client.finalizeEnvelopeReview = jest
    .fn()
    .mockResolvedValue({ files: [] });
  let flow: Promise<any> | undefined;
  await act(async () => {
    flow = state.generateEnvelopeFlow({
      documents: ['doc1'],
      envelope_action: 'open_in_editor'
    });
  });
  await screen.findByTestId('review-viewer');
  expect(mockViewer.props.payload.warnings).toEqual([warning]);
  await act(async () => {
    await expect(
      mockViewer.props.onFinalize({
        envelopes: [{ envelopeId: 'env1' }],
        envelopeAction: 'fill',
        draft: false
      })
    ).resolves.toEqual({ files: [], warnings: [warning] });
    mockViewer.props.onComplete();
    await expect(flow).resolves.toEqual({
      files: [],
      warnings: [warning],
      reviewAction: 'fill'
    });
  });
  await waitFor(() =>
    expect(screen.queryByTestId('review-viewer')).not.toBeInTheDocument()
  );
  expect(
    screen.getByText('Some PDF fields could not be filled.')
  ).toBeInTheDocument();
});

it('keeps the existing return shape and shows no warning for successful mappings', async () => {
  const state = await renderForm();
  state.client.generateEnvelopes = jest.fn().mockResolvedValue({ files: [] });
  await act(async () => {
    await expect(
      state.generateEnvelopeFlow({
        documents: ['doc1'],
        envelope_action: 'fill'
      })
    ).resolves.toEqual({ files: [] });
  });
  expect(
    screen.queryByText('Some PDF fields could not be filled.')
  ).not.toBeInTheDocument();
});

it.each([true, false])(
  'hosted signing waits for warning acknowledgement only when warnings=%s',
  async (hasWarnings) => {
    GridMod._spies.actions = [
      {
        type: ACTION_GENERATE_ENVELOPES,
        documents: ['doc1'],
        envelope_action: 'sign',
        redirect: true
      }
    ];
    const state = await renderForm();
    state.client.generateEnvelopes = jest.fn().mockResolvedValue({
      signers: [{ signer_id: 'signer1' }],
      ...(hasWarnings ? { warnings: [warning] } : {})
    });
    const location = jest.requireMock('../../utils/browser')._spies.location;
    state.client.registerEvent.mockClear();
    fireEvent.click(screen.getByTestId('btn'));
    if (hasWarnings) {
      const continueButton = await screen.findByRole('button', {
        name: 'Continue to signing'
      });
      expect(location.href).toBe('https://example.com/');
      expect(state.client.registerEvent).not.toHaveBeenCalled();
      expect(
        screen.queryByRole('button', { name: 'Dismiss mapping warnings' })
      ).not.toBeInTheDocument();
      fireEvent.click(continueButton);
    }
    await waitFor(() => expect(location.href).toBe('https://example.com/sign'));
    expect(state.client.registerEvent).toHaveBeenCalled();
  }
);
