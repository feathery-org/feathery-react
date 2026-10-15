import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
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
      onSaved,
      onSaveAll,
      onDownloadAll,
      onChange,
      onBeforeReplaceReady
    }: any) {
      ReactActual.useEffect(() => {
        onBeforeReplaceReady?.(mockBeforeReplace);
        return () => onBeforeReplaceReady?.(null);
      }, [onBeforeReplaceReady]);
      return ReactActual.createElement(
        'div',
        {
          'data-testid': `pptx-editor:${source?.url ?? 'none'}`,
          'data-read-only': String(!!readOnly),
          'data-hide-download': String(!!hideDownload)
        },
        ReactActual.createElement('input', {
          'aria-label': `local:${source?.url}`,
          defaultValue: ''
        }),
        onSaveAll &&
          ReactActual.createElement('button', {
            'data-testid': `save-all:${source?.url}`,
            onClick: onSaveAll
          }),
        onDownloadAll &&
          ReactActual.createElement('button', {
            'data-testid': `download-all:${source?.url}`,
            onClick: onDownloadAll
          }),
        onSave &&
          ReactActual.createElement('button', {
            key: 'save',
            'data-testid': 'pptx-save',
            onClick: async () => {
              await onSave(new Blob(['pptx-bytes']));
              await onSaved?.();
            }
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

const mockSaveEnvelopeFile = jest
  .fn()
  .mockResolvedValue({ file: 'https://example.com/saved.pptx' });
const mockSubmitCustom = jest.fn().mockResolvedValue({});
const mockDownloadAll = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../utils/browser', () => ({
  ...jest.requireActual('../../../utils/browser'),
  downloadAllFileUrls: (...args: any[]) => mockDownloadAll(...args)
}));
const mockBeforeReplace = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../utils/featheryClient', () => ({
  __esModule: true,
  API_URL: 'https://api.test/',
  default: jest.fn().mockImplementation(function (this: any) {
    this.getCurrentEnvelope = jest.fn().mockResolvedValue({});
    this.saveEnvelopeFile = (...args: any[]) => mockSaveEnvelopeFile(...args);
    this.submitCustom = (...args: any[]) => mockSubmitCustom(...args);
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

describe('presentation document tabs', () => {
  beforeEach(() => {
    mockBeforeReplace.mockReset().mockResolvedValue(undefined);
    mockSubmitCustom.mockClear();
    mockDownloadAll.mockClear();
    mockSaveEnvelopeFile.mockClear();
    stashEnvelope({ key: 'Overview.pptx' });
    (featheryWindow() as any)[PENDING_DRAFTS_KEY][CONTAINER].envelopes.push({
      id: 'envelope-2',
      document: 'second-template',
      key: 'Financials.pptx',
      file: 'https://example.com/second.pptx',
      type: 'pptx',
      signed: false
    });
    initState.formSchemas = { 'form-key': schema };
  });
  afterEach(() => {
    _clearDocxDirtyRegistry();
    initState.formSchemas = {};
    delete (featheryWindow() as any)[PENDING_DRAFTS_KEY];
  });

  it('navigates in generation order and retains cached decks after saving', async () => {
    render(
      <DocumentEditorContainer containerId={CONTAINER} formId='pptx-tabs' />
    );
    await screen.findByTestId('pptx-editor:https://example.com/deck.pptx');
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Overview.pptx',
      'Financials.pptx'
    ]);
    fireEvent.click(screen.getByRole('tab', { name: 'Financials.pptx' }));
    await screen.findByTestId('pptx-editor:https://example.com/second.pptx');
    expect(mockBeforeReplace).not.toHaveBeenCalled();
    fireEvent.click(
      screen
        .getByTestId('pptx-editor:https://example.com/second.pptx')
        .querySelector('[data-testid="pptx-save"]')!
    );
    await waitFor(() =>
      expect(mockSaveEnvelopeFile).toHaveBeenCalledWith(
        'envelope-2',
        expect.any(Blob),
        'document.pptx'
      )
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Overview.pptx' }));
    await screen.findByTestId('pptx-editor:https://example.com/deck.pptx');
    fireEvent.click(screen.getByRole('tab', { name: 'Financials.pptx' }));
    await screen.findByTestId('pptx-editor:https://example.com/second.pptx');
  });

  it('keeps local edits in both presentations without saving on tab switches', async () => {
    render(
      <DocumentEditorContainer containerId={CONTAINER} formId='pptx-tabs' />
    );
    const original = await screen.findByTestId(
      'pptx-editor:https://example.com/deck.pptx'
    );
    fireEvent.change(
      screen.getByLabelText('local:https://example.com/deck.pptx'),
      { target: { value: 'Local slide A' } }
    );
    fireEvent.click(screen.getByTestId('pptx-dirty'));
    fireEvent.click(screen.getByRole('tab', { name: 'Financials.pptx' }));
    const second = await screen.findByTestId(
      'pptx-editor:https://example.com/second.pptx'
    );
    fireEvent.change(
      screen.getByLabelText('local:https://example.com/second.pptx'),
      { target: { value: 'Local slide B' } }
    );
    fireEvent.click(second.querySelector('[data-testid="pptx-clean"]')!);
    expect(hasDirtyDocxEditors('pptx-tabs')).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: 'Overview.pptx' }));
    expect(
      screen.getByTestId('pptx-editor:https://example.com/deck.pptx')
    ).toBe(original);
    expect(
      screen.getByLabelText('local:https://example.com/deck.pptx')
    ).toHaveValue('Local slide A');
    expect(
      screen.getByLabelText('local:https://example.com/second.pptx')
    ).toHaveValue('Local slide B');
    expect(mockBeforeReplace).not.toHaveBeenCalled();
    expect(mockSaveEnvelopeFile).not.toHaveBeenCalled();
  });

  it('retries failed Save all and keeps both loaded presentations mounted', async () => {
    render(<DocumentEditorContainer containerId={CONTAINER} />);
    await screen.findByTestId('pptx-editor:https://example.com/deck.pptx');
    fireEvent.click(screen.getByRole('tab', { name: 'Financials.pptx' }));
    await screen.findByTestId('pptx-editor:https://example.com/second.pptx');
    mockBeforeReplace.mockRejectedValueOnce(new Error('Offline'));
    fireEvent.click(
      screen.getByTestId('save-all:https://example.com/second.pptx')
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
    expect(
      screen.getByTestId('pptx-editor:https://example.com/deck.pptx')
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByTestId('save-all:https://example.com/second.pptx')
    );
    expect(
      await screen.findByRole('status', { name: 'Document notification' })
    ).toHaveTextContent('All documents saved');
    fireEvent.click(screen.getAllByTestId('pptx-dirty')[0]);
    expect(screen.queryAllByText('All documents saved')).toHaveLength(0);
    expect(mockBeforeReplace).toHaveBeenCalledTimes(3);
  });

  it('saves one field URL for current Save and ordered URLs for Save all', async () => {
    initState.sdkKey = 'test-key';
    const localSchema = JSON.parse(JSON.stringify(schema));
    const action = localSchema.steps[0].buttons[0].properties.actions[0];
    action.editor_toolbar_actions = ['save', 'download'];
    action.save_document_field_key = 'packet-files';
    initState.formSchemas = { 'form-key': localSchema };
    render(<DocumentEditorContainer containerId={CONTAINER} />);
    await screen.findByTestId('pptx-editor:https://example.com/deck.pptx');
    await act(async () => {
      fireEvent.click(screen.getByTestId('pptx-save'));
    });
    expect(mockSubmitCustom).toHaveBeenLastCalledWith({
      'packet-files': 'https://example.com/saved.pptx'
    });
    fireEvent.click(
      screen.getByTestId('save-all:https://example.com/deck.pptx')
    );
    await waitFor(() =>
      expect(mockSubmitCustom).toHaveBeenLastCalledWith({
        'packet-files': [
          'https://example.com/saved.pptx',
          'https://example.com/second.pptx'
        ]
      })
    );
    expect(mockBeforeReplace).toHaveBeenCalledTimes(1);
  });

  it('flushes both cached decks before downloading all with fresh bytes', async () => {
    render(<DocumentEditorContainer containerId={CONTAINER} />);
    await screen.findByTestId('pptx-editor:https://example.com/deck.pptx');
    fireEvent.click(screen.getByRole('tab', { name: 'Financials.pptx' }));
    await screen.findByTestId('pptx-editor:https://example.com/second.pptx');
    fireEvent.click(
      screen.getByTestId('download-all:https://example.com/second.pptx')
    );
    await waitFor(() =>
      expect(mockDownloadAll).toHaveBeenCalledWith(
        ['https://example.com/deck.pptx', 'https://example.com/second.pptx'],
        undefined,
        { cache: 'no-store' }
      )
    );
    expect(mockBeforeReplace).toHaveBeenCalledTimes(2);
  });

  it('uses keyboard navigation without submitting the host form', async () => {
    const submit = jest.fn((event) => event.preventDefault());
    render(
      <form onSubmit={submit}>
        <DocumentEditorContainer containerId={CONTAINER} />
      </form>
    );
    await screen.findByTestId('pptx-editor:https://example.com/deck.pptx');
    const first = screen.getByRole('tab', { name: 'Overview.pptx' });
    const second = screen.getByRole('tab', { name: 'Financials.pptx' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(second).toHaveFocus();
    fireEvent.click(second);
    await screen.findByTestId('pptx-editor:https://example.com/second.pptx');
    expect(submit).not.toHaveBeenCalled();
  });

  it('replaces all tabs after regeneration', async () => {
    render(<DocumentEditorContainer containerId={CONTAINER} />);
    await screen.findByTestId('pptx-editor:https://example.com/deck.pptx');
    await act(async () => {
      featheryWindow().dispatchEvent(
        new CustomEvent('feathery-docx-editor-refresh', {
          detail: {
            containerId: CONTAINER,
            envelopes: [
              {
                id: 'new-envelope',
                document: 'new-template',
                type: 'pptx',
                file: 'new.pptx',
                key: 'Replacement.pptx'
              }
            ]
          }
        })
      );
    });
    await screen.findByTestId('pptx-editor:new.pptx');
    expect(screen.queryByRole('tablist')).toBeNull();
  });
});
