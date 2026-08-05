import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { initState } from '../../../utils/init';
import { ACTION_GENERATE_ENVELOPES } from '../../../utils/elementActions';
import { featheryWindow } from '../../../utils/browser';
import {
  _clearDocxEditors,
  getActiveDocxEditorEnvelopeTarget,
  getDocxEditor
} from '../../../assistant/tools/docx/docxEditorRegistry';
import DocumentEditorContainer from './DocumentEditorContainer';

// Exposes the terminal handlers as buttons so the container's outcome routing
// can be driven the way the real toolbar drives it.
jest.mock('./index', () => {
  const React = jest.requireActual('react');

  return function MockDocxEditor({
    source,
    onEditorReady,
    terminalAction,
    onTerminalAction,
    onTerminalActionDraft
  }: any) {
    const editor = React.useMemo(
      () => ({ sourceUrl: source?.url }),
      [source?.url]
    );
    React.useEffect(() => onEditorReady?.(editor), [editor, onEditorReady]);
    return React.createElement(
      'div',
      { 'data-testid': `editor:${source?.url ?? 'none'}` },
      onTerminalAction &&
        React.createElement('button', {
          key: 'terminal',
          'data-testid': `terminal:${terminalAction}`,
          onClick: () => onTerminalAction()
        }),
      onTerminalActionDraft &&
        React.createElement('button', {
          key: 'draft',
          'data-testid': 'terminal:draft-menu',
          onClick: () => onTerminalActionDraft()
        })
    );
  };
});

const mockFinalizeEnvelope = jest.fn();
const mockFinalizeEnvelopeReview = jest.fn();
jest.mock('../../../utils/featheryClient', () => ({
  __esModule: true,
  API_URL: 'https://api.test/',
  default: jest.fn().mockImplementation(function (this: any, formKey: string) {
    this.formKey = formKey;
    this.finalizeEnvelope = (...args: any[]) => mockFinalizeEnvelope(...args);
    this.finalizeEnvelopeReview = (...args: any[]) =>
      mockFinalizeEnvelopeReview(...args);
    this.getCurrentEnvelope = jest.fn().mockResolvedValue({});
    this.saveEnvelopeFile = jest.fn().mockResolvedValue({});
    this.downloadEnvelopePdf = jest.fn().mockResolvedValue(new Blob());
  })
}));

const PENDING_DRAFTS_KEY = '__featheryDocxEditorDrafts';

const schemaFor = (containerIds: string[]) => ({
  steps: containerIds.map((containerId, index) => ({
    id: `step-${index}`,
    buttons: [
      {
        properties: {
          actions: [
            {
              type: ACTION_GENERATE_ENVELOPES,
              editor_mode: containerId,
              documents: [`document-${containerId}`]
            }
          ]
        }
      }
    ]
  }))
});

const draftFor = (containerId: string) => ({
  documents: [`document-${containerId}`],
  envelopes: [
    {
      id: `envelope-${containerId}`,
      document: `document-${containerId}`,
      file: `https://example.com/${containerId}.docx`,
      type: 'docx',
      signed: false
    }
  ]
});

describe('DocumentEditorContainer registry lifecycle', () => {
  beforeEach(() => {
    _clearDocxEditors();
    initState.formSchemas = {
      'form-key': schemaFor(['document-container-a', 'document-container-b'])
    };
    (featheryWindow() as any)[PENDING_DRAFTS_KEY] = {
      'document-container-a': draftFor('document-container-a'),
      'document-container-b': draftFor('document-container-b')
    };
  });

  afterEach(() => {
    _clearDocxEditors();
    initState.formSchemas = {};
    delete (featheryWindow() as any)[PENDING_DRAFTS_KEY];
    jest.restoreAllMocks();
  });

  it('keeps both same-step editors usable and silently selects one assistant target', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const first = render(
      <DocumentEditorContainer
        containerId='document-container-b'
        formId='form-1'
        stepId='step-same'
      />
    );

    await waitFor(() =>
      expect(getDocxEditor('form-1')).toMatchObject({
        sourceUrl: 'https://example.com/document-container-b.docx'
      })
    );

    const second = render(
      <DocumentEditorContainer
        containerId='document-container-a'
        formId='form-1'
        stepId='step-same'
      />
    );

    await waitFor(() => {
      expect(
        second.getByTestId(
          'editor:https://example.com/document-container-a.docx'
        )
      ).toBeInTheDocument();
      expect(
        first.getByTestId(
          'editor:https://example.com/document-container-b.docx'
        )
      ).toBeInTheDocument();
      expect(getDocxEditor('form-1')).toMatchObject({
        sourceUrl: 'https://example.com/document-container-a.docx'
      });
    });
    expect(error).not.toHaveBeenCalled();
    expect(getActiveDocxEditorEnvelopeTarget('form-1')).toEqual({
      type: 'envelope',
      id: 'envelope-document-container-a'
    });

    second.unmount();
    expect(getDocxEditor('form-1')).toMatchObject({
      sourceUrl: 'https://example.com/document-container-b.docx'
    });
    expect(getActiveDocxEditorEnvelopeTarget('form-1')?.id).toBe(
      'envelope-document-container-b'
    );

    first.unmount();
    expect(getDocxEditor('form-1')).toBeUndefined();
  });

  it('hands off to the next step before the previous step unmounts', async () => {
    const outgoing = render(
      <DocumentEditorContainer
        containerId='document-container-a'
        formId='form-1'
        stepId='step-a'
      />
    );
    await waitFor(() =>
      expect(getDocxEditor('form-1')).toMatchObject({
        sourceUrl: 'https://example.com/document-container-a.docx'
      })
    );

    // This is React's real transition ordering: incoming mount first.
    const incoming = render(
      <DocumentEditorContainer
        containerId='document-container-b'
        formId='form-1'
        stepId='step-b'
      />
    );
    await waitFor(() =>
      expect(getDocxEditor('form-1')).toMatchObject({
        sourceUrl: 'https://example.com/document-container-b.docx'
      })
    );
    expect(getActiveDocxEditorEnvelopeTarget('form-1')?.id).toBe(
      'envelope-document-container-b'
    );

    // Then the outgoing cleanup arrives late.
    outgoing.unmount();
    expect(getDocxEditor('form-1')).toMatchObject({
      sourceUrl: 'https://example.com/document-container-b.docx'
    });
    incoming.unmount();
    expect(getDocxEditor('form-1')).toBeUndefined();
  });

  it('keeps editors mounted by different forms isolated', async () => {
    const formA = render(
      <DocumentEditorContainer
        containerId='document-container-a'
        formId='form-a'
        stepId='step-a'
      />
    );
    const formB = render(
      <DocumentEditorContainer
        containerId='document-container-b'
        formId='form-b'
        stepId='step-b'
      />
    );

    await waitFor(() => {
      expect(getDocxEditor('form-a')).toMatchObject({
        sourceUrl: 'https://example.com/document-container-a.docx'
      });
      expect(getDocxEditor('form-b')).toMatchObject({
        sourceUrl: 'https://example.com/document-container-b.docx'
      });
    });

    formA.unmount();
    expect(getDocxEditor('form-a')).toBeUndefined();
    expect(getDocxEditor('form-b')).toMatchObject({
      sourceUrl: 'https://example.com/document-container-b.docx'
    });
    formB.unmount();
  });
});

describe('DocumentEditorContainer signing outcomes', () => {
  const CONTAINER = 'document-container-a';

  const seed = (action: Record<string, any>) => {
    initState.formSchemas = {
      'form-key': {
        steps: [
          {
            id: 'step-0',
            buttons: [
              {
                properties: {
                  actions: [
                    {
                      type: ACTION_GENERATE_ENVELOPES,
                      editor_mode: CONTAINER,
                      documents: [`document-${CONTAINER}`],
                      ...action
                    }
                  ]
                }
              }
            ]
          }
        ]
      }
    };
    (featheryWindow() as any)[PENDING_DRAFTS_KEY] = {
      [CONTAINER]: draftFor(CONTAINER)
    };
  };

  const mount = () =>
    render(
      <DocumentEditorContainer
        containerId={CONTAINER}
        formId='form-1'
        stepId='step-0'
      />
    );

  beforeEach(() => {
    _clearDocxEditors();
    mockFinalizeEnvelope.mockReset().mockResolvedValue({});
    mockFinalizeEnvelopeReview
      .mockReset()
      .mockResolvedValue({ docusign_envelope_id: 'ds-1', status: 'sent' });
  });

  afterEach(() => {
    _clearDocxEditors();
    initState.formSchemas = {};
    delete (featheryWindow() as any)[PENDING_DRAFTS_KEY];
    jest.restoreAllMocks();
  });

  it('sends the reviewed docx to DocuSign instead of the Feathery sign page', async () => {
    seed({ sign_method: 'docusign', editor_toolbar_actions: ['sign'] });
    const { getByTestId } = mount();

    await waitFor(() => expect(getByTestId('terminal:sign')).toBeTruthy());
    getByTestId('terminal:sign').click();

    // The docx must be converted to a signable PDF before it is sent.
    await waitFor(() => expect(mockFinalizeEnvelope).toHaveBeenCalled());
    await waitFor(() => expect(mockFinalizeEnvelopeReview).toHaveBeenCalled());
    const [action, params] = mockFinalizeEnvelopeReview.mock.calls[0];
    expect(action.sign_method).toBe('docusign');
    expect(params).toEqual({
      envelopes: [{ envelopeId: `envelope-${CONTAINER}` }],
      envelopeAction: 'sign',
      draft: false
    });
  });

  it('sends draft=true from the Save as Draft menu entry', async () => {
    seed({
      sign_method: 'docusign',
      editor_toolbar_actions: ['sign', 'draft']
    });
    const { getByTestId } = mount();

    await waitFor(() =>
      expect(getByTestId('terminal:draft-menu')).toBeTruthy()
    );
    getByTestId('terminal:draft-menu').click();

    await waitFor(() => expect(mockFinalizeEnvelopeReview).toHaveBeenCalled());
    expect(mockFinalizeEnvelopeReview.mock.calls[0][1].draft).toBe(true);
  });

  it('sends draft=true when Create Draft is the only signing outcome', async () => {
    seed({ sign_method: 'docusign', editor_toolbar_actions: ['draft'] });
    const { getByTestId } = mount();

    await waitFor(() => expect(getByTestId('terminal:draft')).toBeTruthy());
    getByTestId('terminal:draft').click();

    await waitFor(() => expect(mockFinalizeEnvelopeReview).toHaveBeenCalled());
    expect(mockFinalizeEnvelopeReview.mock.calls[0][1].draft).toBe(true);
  });

  it('keeps the Feathery eSign path when sign_method is not docusign', async () => {
    seed({ sign_method: 'feathery', editor_toolbar_actions: ['sign'] });
    const { getByTestId } = mount();

    await waitFor(() => expect(getByTestId('terminal:sign')).toBeTruthy());
    getByTestId('terminal:sign').click();

    await waitFor(() => expect(mockFinalizeEnvelope).toHaveBeenCalled());
    expect(mockFinalizeEnvelopeReview).not.toHaveBeenCalled();
  });
});
