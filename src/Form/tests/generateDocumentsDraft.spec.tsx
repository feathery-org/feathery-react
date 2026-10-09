import './testMocks';
import { act, cleanup, render, screen } from '@testing-library/react';
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
