import React from 'react';
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
import { ACTION_GENERATE_ENVELOPES } from '../../utils/elementActions';

jest.mock('../../elements/components/DocumentViewer', () => ({
  __esModule: true,
  default: () => <div data-testid='pdf-overlay' />
}));

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
  jest.restoreAllMocks();
  GridMod._spies.actions = [];
});

it('clears only the former container when generation falls back to PDF overlay', async () => {
  const win = BrowserMod.featheryWindow();
  win.__featheryDocxEditorDrafts = {
    'old-container': { envelopes: [{ id: 'old-deck' }] },
    'other-container': { envelopes: [{ id: 'other-deck' }] }
  };
  jest.spyOn(BrowserMod, 'featheryWindow').mockReturnValue(win);
  const id = 'overlay-fallback';
  render(<JSForm formId='f1' _internalId={id} />);
  await screen.findByTestId('btn');
  const state = (setFormInternalState as jest.Mock).mock.calls.find(
    ([formId, values]) => formId === id && values.generateEnvelopeFlow
  )[1];
  state.client.generateEnvelopes = jest
    .fn()
    .mockResolvedValue({ editor_mode: 'overlay', envelopes: [] });
  GridMod._spies.actions = [
    {
      type: ACTION_GENERATE_ENVELOPES,
      envelope_action: 'open_in_editor',
      editor_mode: 'old-container',
      documents: ['a', 'b']
    }
  ];
  fireEvent.click(screen.getByTestId('btn'));
  await screen.findByTestId('pdf-overlay');
  await waitFor(() =>
    expect(win.__featheryDocxEditorDrafts['old-container']).toEqual({
      containerId: 'old-container',
      documents: [],
      envelopes: []
    })
  );
  expect(win.__featheryDocxEditorDrafts['other-container']).toEqual({
    envelopes: [{ id: 'other-deck' }]
  });
  expect(win.dispatchEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'feathery-docx-editor-refresh',
      detail: { containerId: 'old-container', documents: [], envelopes: [] }
    })
  );
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
