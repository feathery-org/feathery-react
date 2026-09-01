import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { ACTION_GENERATE_ENVELOPES } from '../../../utils/elementActions';
import {
  featheryWindow,
  downloadAllFileUrls,
  openTab
} from '../../../utils/browser';
import { initState, setFieldValues } from '../../../utils/init';
import PdfEnvelopeViewer from './PdfEnvelopeViewer';
import DocumentEditorContainer from './DocumentEditorContainer';

// Emulates the pdf renderer: exposes the surface API and reports its props so
// outcome routing can be asserted without pdf.js. `saveEditedDocuments`
// persists one pretend-dirty document through the viewer's own save prop,
// mirroring the real implementation's contract.
jest.mock('../DocumentViewer/PdfViewer', () => {
  const React = jest.requireActual('react');
  return {
    __esModule: true,
    default: function MockPdfViewer({
      documents,
      onSaveEnvelopeFile,
      apiRef,
      readOnly
    }: any) {
      if (apiRef) {
        apiRef.current = {
          saveEditedDocuments: async () => {
            if (!onSaveEnvelopeFile) return;
            for (const doc of documents) {
              if (doc.envelope_id)
                await onSaveEnvelopeFile(doc.envelope_id, new Blob());
            }
          },
          stepPage: jest.fn()
        };
      }
      return React.createElement('div', {
        'data-testid': `pdf:${documents[0]?.pdf_url}`,
        'data-read-only': String(!!readOnly),
        'data-savable': String(!!onSaveEnvelopeFile)
      });
    }
  };
});

jest.mock('../../../utils/browser', () => ({
  ...jest.requireActual('../../../utils/browser'),
  openTab: jest.fn(),
  downloadAllFileUrls: jest.fn()
}));
jest.mock('../../../utils/document', () => ({
  ...jest.requireActual('../../../utils/document'),
  getSignUrl: jest.fn((token: string) => `https://sign.test/${token}`)
}));
jest.mock('../../../utils/init', () => ({
  fieldValues: { signer_field: 'filler@feathery.io' },
  setFieldValues: jest.fn(),
  initState: { formSchemas: {} }
}));

const mockFinalizeEnvelope = jest.fn();
const mockSaveEnvelopeFile = jest.fn();
const mockSubmitCustom = jest.fn();
jest.mock('../../../utils/featheryClient', () => ({
  __esModule: true,
  API_URL: 'https://api.test/',
  default: jest.fn().mockImplementation(function (this: any) {
    this.finalizeEnvelope = (...args: any[]) => mockFinalizeEnvelope(...args);
    this.saveEnvelopeFile = (...args: any[]) => mockSaveEnvelopeFile(...args);
    this.submitCustom = (...args: any[]) => mockSubmitCustom(...args);
    this.getCurrentEnvelope = jest.fn().mockResolvedValue({});
  })
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const FeatheryClient = require('../../../utils/featheryClient').default;

const envelope = (overrides: Record<string, any> = {}) => ({
  id: 'envelope-1',
  file: 'https://files.test/doc.pdf',
  document: 'document-1',
  type: 'pdf',
  signed: false,
  ...overrides
});

const renderViewer = (
  action: Record<string, any>,
  envelopeOverrides: Record<string, any> = {}
) =>
  render(
    <PdfEnvelopeViewer
      envelope={envelope(envelopeOverrides) as any}
      action={action}
      client={new FeatheryClient('form-key')}
      sourceUrl='https://files.test/doc.pdf'
      formId='form-1'
      defaultDocumentId='document-1'
    />
  );

afterEach(() => {
  jest.clearAllMocks();
});

describe('PdfEnvelopeViewer outcomes', () => {
  it('saves edits, finalizes with the shared signer field, and opens the sign page', async () => {
    mockSaveEnvelopeFile.mockResolvedValue({
      file: 'https://files.test/v2.pdf'
    });
    mockFinalizeEnvelope.mockResolvedValue({ signer_id: 'tok-1' });
    renderViewer({
      envelope_action: 'open_in_editor',
      editor_toolbar_actions: ['sign'],
      envelope_signer_field_key: 'signer_field'
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Sign'));
    });

    // Edits were persisted before the outcome ran.
    expect(mockSaveEnvelopeFile).toHaveBeenCalledWith(
      'envelope-1',
      expect.any(Blob),
      'document.pdf'
    );
    expect(mockFinalizeEnvelope).toHaveBeenCalledWith(
      'envelope-1',
      [
        {
          document_id: 'document-1',
          email: 'filler@feathery.io',
          filler: true
        }
      ],
      undefined
    );
    expect(openTab).toHaveBeenCalledWith('https://sign.test/tok-1');
  });

  it('downloads the freshly saved file URL, not the one loaded at mount', async () => {
    mockSaveEnvelopeFile.mockResolvedValue({
      file: 'https://files.test/v2.pdf'
    });
    renderViewer({
      envelope_action: 'open_in_editor',
      editor_toolbar_actions: ['download']
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Download'));
    });

    expect(downloadAllFileUrls).toHaveBeenCalledWith([
      'https://files.test/v2.pdf'
    ]);
  });

  it('saves the file URL to the configured field and submits it', async () => {
    mockSaveEnvelopeFile.mockResolvedValue({
      file: 'https://files.test/v2.pdf'
    });
    renderViewer({
      envelope_action: 'open_in_editor',
      editor_toolbar_actions: ['save'],
      save_document_field_key: 'doc_field'
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    expect(setFieldValues).toHaveBeenCalledWith(
      { doc_field: 'https://files.test/v2.pdf' },
      true,
      true
    );
    expect(mockSubmitCustom).toHaveBeenCalledWith({
      doc_field: 'https://files.test/v2.pdf'
    });
  });

  it('surfaces a failed outcome without unmounting the viewer', async () => {
    mockSaveEnvelopeFile.mockResolvedValue({});
    mockFinalizeEnvelope.mockRejectedValue(new Error('quota exceeded'));
    renderViewer({
      envelope_action: 'open_in_editor',
      editor_toolbar_actions: ['sign']
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Sign'));
    });

    expect(screen.getByText('quota exceeded')).toBeTruthy();
    expect(screen.getByTestId('pdf:https://files.test/doc.pdf')).toBeTruthy();
  });

  it('renders read-only, non-persisting pages for a signed envelope', () => {
    renderViewer(
      { envelope_action: 'open_in_editor', editor_toolbar_actions: ['sign'] },
      { signed: true }
    );
    const viewer = screen.getByTestId('pdf:https://files.test/doc.pdf');
    expect(viewer.getAttribute('data-read-only')).toBe('true');
    expect(viewer.getAttribute('data-savable')).toBe('false');
    expect((screen.getByText('Sign') as HTMLButtonElement).disabled).toBe(true);
  });

  it('honors editor_read_only from the owning action', () => {
    renderViewer({
      envelope_action: 'open_in_editor',
      editor_toolbar_actions: ['download'],
      editor_read_only: true
    });
    const viewer = screen.getByTestId('pdf:https://files.test/doc.pdf');
    expect(viewer.getAttribute('data-read-only')).toBe('true');
  });
});

describe('DocumentEditorContainer pdf renderer', () => {
  const PENDING_DRAFTS_KEY = '__featheryDocxEditorDrafts';

  afterEach(() => {
    initState.formSchemas = {};
    delete (featheryWindow() as any)[PENDING_DRAFTS_KEY];
  });

  it('renders the pdf viewer for a generated pdf envelope', async () => {
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
                      editor_mode: 'container-pdf',
                      documents: ['document-1'],
                      editor_toolbar_actions: ['sign']
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
      'container-pdf': {
        documents: ['document-1'],
        envelopes: [envelope()]
      }
    };

    render(
      <DocumentEditorContainer containerId='container-pdf' formId='form-1' />
    );

    await waitFor(() =>
      expect(screen.getByTestId('pdf:https://files.test/doc.pdf')).toBeTruthy()
    );
    expect(screen.getByText('Sign')).toBeTruthy();
    expect(screen.queryByText(/isn't supported yet/)).toBeNull();
  });
});
