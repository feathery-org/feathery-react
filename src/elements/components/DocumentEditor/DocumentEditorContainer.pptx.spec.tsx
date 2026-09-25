import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { initState } from '../../../utils/init';
import { ACTION_GENERATE_ENVELOPES } from '../../../utils/elementActions';
import { featheryWindow } from '../../../utils/browser';
import DocumentEditorContainer from './DocumentEditorContainer';
import {
  _clearDocxDirtyRegistry,
  hasDirtyDocxEditors
} from '../DocxEditor/docxDirtyRegistry';

jest.mock('../../../utils/documentEditorPrimitives', () => ({
  rebindRevisionGroups: jest.fn()
}));

jest.mock('../DocxEditor', () => {
  const ReactActual = jest.requireActual('react');
  return function MockDocxEditor({ source }: any) {
    return ReactActual.createElement('div', {
      'data-testid': `docx-editor:${source?.url ?? 'none'}`
    });
  };
});

// The container lazy-imports ../PptxEditor; jest.mock intercepts the dynamic
// import so the Suspense boundary resolves against this stub.
jest.mock('../PptxEditor', () => {
  const ReactActual = jest.requireActual('react');
  return {
    __esModule: true,
    default: function MockPptxEditor({
      source,
      readOnly,
      hideDownload,
      onSave,
      onChange
    }: any) {
      return ReactActual.createElement(
        'div',
        {
          'data-testid': `pptx-editor:${source?.url ?? 'none'}`,
          'data-read-only': String(!!readOnly),
          'data-hide-download': String(!!hideDownload)
        },
        onSave &&
          ReactActual.createElement('button', {
            key: 'save',
            'data-testid': 'pptx-save',
            onClick: () => onSave(new Blob(['pptx-bytes']))
          }),
        onChange &&
          ReactActual.createElement('button', {
            key: 'dirty',
            'data-testid': 'pptx-dirty',
            onClick: () => onChange(true)
          }),
        onChange &&
          ReactActual.createElement('button', {
            key: 'clean',
            'data-testid': 'pptx-clean',
            onClick: () => onChange(false)
          })
      );
    }
  };
});

const mockSaveEnvelopeFile = jest.fn().mockResolvedValue({});
jest.mock('../../../utils/featheryClient', () => ({
  __esModule: true,
  API_URL: 'https://api.test/',
  default: jest.fn().mockImplementation(function (this: any) {
    this.getCurrentEnvelope = jest.fn().mockResolvedValue({});
    this.saveEnvelopeFile = (...args: any[]) => mockSaveEnvelopeFile(...args);
    this.downloadEnvelopePdf = jest.fn().mockResolvedValue(new Blob());
  })
}));

const PENDING_DRAFTS_KEY = '__featheryDocxEditorDrafts';
const CONTAINER = 'pptx-container';

const schema = {
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
                editor_toolbar_actions: ['download']
              }
            ]
          }
        }
      ]
    }
  ]
};

function stashEnvelope(overrides: Record<string, any> = {}) {
  (featheryWindow() as any)[PENDING_DRAFTS_KEY] = {
    [CONTAINER]: {
      documents: [`document-${CONTAINER}`],
      envelopes: [
        {
          id: 'envelope-1',
          document: `document-${CONTAINER}`,
          file: 'https://example.com/deck.pptx',
          type: 'pptx',
          signed: false,
          ...overrides
        }
      ]
    }
  };
}

describe('DocumentEditorContainer pptx dispatch', () => {
  beforeEach(() => {
    _clearDocxDirtyRegistry();
    mockSaveEnvelopeFile.mockClear();
    initState.formSchemas = { 'form-key': schema };
  });

  afterEach(() => {
    _clearDocxDirtyRegistry();
    initState.formSchemas = {};
    delete (featheryWindow() as any)[PENDING_DRAFTS_KEY];
  });

  it('lazy-loads the PptxEditor for a pptx envelope', async () => {
    stashEnvelope();
    render(<DocumentEditorContainer containerId={CONTAINER} formId='form-1' />);
    const editor = await screen.findByTestId(
      'pptx-editor:https://example.com/deck.pptx'
    );
    expect(editor).toHaveAttribute('data-read-only', 'false');
    // The action offers download, so it is not hidden.
    expect(editor).toHaveAttribute('data-hide-download', 'false');
  });

  it('keeps unsupported envelope types on the placeholder', async () => {
    stashEnvelope({ type: 'csv', file: 'https://example.com/data.csv' });
    render(<DocumentEditorContainer containerId={CONTAINER} formId='form-1' />);
    expect(
      await screen.findByText("Editing csv documents isn't supported yet.")
    ).toBeInTheDocument();
  });

  it('hides the PptxEditor when the feature flag is off for the org', async () => {
    stashEnvelope();
    render(
      <DocumentEditorContainer
        containerId={CONTAINER}
        formId='form-1'
        pptxEditorEnabled={false}
      />
    );
    expect(
      await screen.findByText("Editing pptx documents isn't supported yet.")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('pptx-editor:https://example.com/deck.pptx')
    ).not.toBeInTheDocument();
  });

  it('saves through the envelope API with a .pptx filename', async () => {
    stashEnvelope();
    render(<DocumentEditorContainer containerId={CONTAINER} formId='form-1' />);
    (await screen.findByTestId('pptx-save')).click();
    await waitFor(() =>
      expect(mockSaveEnvelopeFile).toHaveBeenCalledWith(
        'envelope-1',
        expect.any(Blob),
        'document.pptx'
      )
    );
  });

  it('registers and clears unsaved-changes protection', async () => {
    stashEnvelope();
    render(<DocumentEditorContainer containerId={CONTAINER} formId='form-1' />);
    (await screen.findByTestId('pptx-dirty')).click();
    expect(hasDirtyDocxEditors('form-1')).toBe(true);
    (await screen.findByTestId('pptx-clean')).click();
    expect(hasDirtyDocxEditors('form-1')).toBe(false);
  });

  it('renders a signed pptx envelope read-only with no dirty registration', async () => {
    stashEnvelope({ signed: true });
    render(<DocumentEditorContainer containerId={CONTAINER} formId='form-1' />);
    const editor = await screen.findByTestId(
      'pptx-editor:https://example.com/deck.pptx'
    );
    expect(editor).toHaveAttribute('data-read-only', 'true');
    expect(screen.queryByTestId('pptx-dirty')).toBeNull();
  });
});
