import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { fieldValues, initState } from '../../../utils/init';
import { ACTION_GENERATE_ENVELOPES } from '../../../utils/elementActions';
import { featheryWindow } from '../../../utils/browser';
import {
  _clearDocxEditors,
  getActiveDocxEditorEnvelopeTarget,
  getDocxEditor
} from '../../../assistant/tools/docx/docxEditorRegistry';
import { setFormInternalState } from '../../../utils/internalState';
import { rebindRevisionGroups } from '../../../utils/documentEditorPrimitives';
import DocumentEditorContainer from './DocumentEditorContainer';
import {
  _clearDocxDirtyRegistry,
  hasDirtyDocxEditors
} from './docxDirtyRegistry';

const mockDownloadAll = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../utils/browser', () => ({
  ...jest.requireActual('../../../utils/browser'),
  downloadAllFileUrls: (...args: any[]) => mockDownloadAll(...args)
}));

jest.mock('../../../utils/documentEditorPrimitives', () => ({
  rebindRevisionGroups: jest.fn()
}));

// Mirrors the real lifecycle in useDocxEditor: `onEditorReady` fires from
// SyncFusion's `created` callback against a BLANK default document, and `onReady`
// only after openAsync resolves — and again on every openNonce reload. The mock
// reflects that by exposing the document's revisions only once it has opened, so
// a rebind at create time observes an empty document and is detectably wrong.
const OPEN_STATE = { opened: false };
const mockBeforeReplace = jest.fn().mockResolvedValue(undefined);
let mockHistory: any;

// Exposes the terminal handlers as buttons so the container's outcome routing
// can be driven the way the real toolbar drives it.
jest.mock('./index', () => {
  const React = jest.requireActual('react');

  return function MockDocxEditor({
    source,
    openNonce,
    onEditorReady,
    onChange,
    onReady,
    preview,
    onSave,
    onSaveAll,
    onDownloadAll,
    onError,
    onBeforeReplaceReady,
    history,
    reviewChanges,
    terminalAction,
    onTerminalAction,
    onTerminalActionDraft,
    onSaved,
    onDownloaded
  }: any) {
    mockHistory = history;
    React.useEffect(() => {
      onBeforeReplaceReady?.(mockBeforeReplace);
      return () => onBeforeReplaceReady?.(null);
    }, [onBeforeReplaceReady]);
    const editor = React.useMemo(
      () => ({
        sourceUrl: source?.url,
        // Stands in for the persisted revisions a saved file carries: absent
        // until the source document has actually been opened.
        get revisions() {
          return OPEN_STATE.opened ? [{ id: 'rev-1' }] : [];
        }
      }),
      [source?.url]
    );
    React.useEffect(() => onEditorReady?.(editor), [editor, onEditorReady]);
    React.useEffect(() => {
      if (!source?.url) return;
      OPEN_STATE.opened = true;
      onReady?.();
    }, [editor, onReady, openNonce, source?.url]);
    return React.createElement(
      'div',
      {
        'data-testid': `editor:${source?.url ?? 'none'}`,
        'data-preview': String(!!preview),
        'data-review-changes': String(!!reviewChanges)
      },
      React.createElement('input', {
        'aria-label': `local:${source?.url}`,
        defaultValue: ''
      }),
      onSaveAll &&
        React.createElement('button', {
          'data-testid': `save-all:${source?.url}`,
          onClick: onSaveAll
        }),
      onDownloadAll &&
        React.createElement('button', {
          'data-testid': `download-all:${source?.url}`,
          onClick: onDownloadAll
        }),
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
        }),
      onChange &&
        React.createElement('button', {
          key: 'dirty',
          'data-testid': `dirty:${source?.url}`,
          onClick: () => onChange(true)
        }),
      onChange &&
        React.createElement('button', {
          key: 'clean',
          'data-testid': `clean:${source?.url}`,
          onClick: () => onChange(false)
        }),
      onSaved &&
        React.createElement('button', {
          key: 'saved',
          'data-testid': 'saved',
          onClick: () => onSaved({ file: 'saved-file-url' })
        }),
      onDownloaded &&
        React.createElement('button', {
          key: 'downloaded',
          'data-testid': 'downloaded',
          onClick: () => onDownloaded()
        }),
      onSave &&
        React.createElement('button', {
          key: 'save',
          'data-testid': `save:${source?.url}`,
          onClick: () =>
            onSave(new Blob(['docx']), {
              sessionId: 'sess-1',
              sessionStartedAt: '2026-09-02T00:00:00.000Z',
              authors: [{ kind: 'user', label: 'You' }],
              closeSession: true
            })
        }),
      React.createElement('button', {
        'data-testid': 'report-error',
        onClick: () => onError?.('Save failed; retry')
      }),
      history &&
        React.createElement('button', {
          key: 'restore',
          'data-testid': `restore:${source?.url}`,
          onClick: () => history.restoreVersion('version-1')
        })
    );
  };
});

const mockGetCurrentEnvelope = jest.fn().mockResolvedValue({});
const mockSubmitCustom = jest.fn().mockResolvedValue({});
const mockFinalizeEnvelope = jest.fn();
const mockFinalizeEnvelopeReview = jest.fn();
const mockSaveEnvelopeFile = jest
  .fn()
  .mockResolvedValue({ file: 'saved.docx' });
const mockRestoreEnvelopeVersion = jest
  .fn()
  .mockResolvedValue({ id: 'e', file: 'restored.docx', editor_file: null });
jest.mock('../../../utils/featheryClient', () => ({
  __esModule: true,
  API_URL: 'https://api.test/',
  default: jest.fn().mockImplementation(function (this: any, formKey: string) {
    this.formKey = formKey;
    this.finalizeEnvelope = (...args: any[]) => mockFinalizeEnvelope(...args);
    this.finalizeEnvelopeReview = (...args: any[]) =>
      mockFinalizeEnvelopeReview(...args);
    this.getCurrentEnvelope = (...args: any[]) =>
      mockGetCurrentEnvelope(...args);
    this.submitCustom = (...args: any[]) => mockSubmitCustom(...args);
    this.saveEnvelopeFile = (...args: any[]) => mockSaveEnvelopeFile(...args);
    this.restoreEnvelopeVersion = (...args: any[]) =>
      mockRestoreEnvelopeVersion(...args);
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

  it('shows a blank editor preview without connecting it to a generated envelope', () => {
    const { getByTestId } = render(
      <DocumentEditorContainer
        containerId='document-container-a'
        formId='form-1'
        editMode
      />
    );

    const preview = getByTestId('editor:none');
    expect(preview).toHaveAttribute('data-preview', 'true');
    expect(getDocxEditor('form-1')).toBeUndefined();
    expect(hasDirtyDocxEditors('form-1')).toBe(false);
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

  describe('dirty state tracking', () => {
    beforeEach(() => _clearDocxDirtyRegistry());
    afterEach(() => _clearDocxDirtyRegistry());

    const url = 'https://example.com/document-container-a.docx';

    it('mirrors editor onChange into the dirty registry', async () => {
      const { getByTestId } = render(
        <DocumentEditorContainer
          containerId='document-container-a'
          formId='form-1'
          stepId='step-a'
        />
      );
      await waitFor(() => getByTestId(`editor:${url}`));
      expect(hasDirtyDocxEditors('form-1')).toBe(false);

      fireEvent.click(getByTestId(`dirty:${url}`));
      expect(hasDirtyDocxEditors('form-1')).toBe(true);

      fireEvent.click(getByTestId(`clean:${url}`));
      expect(hasDirtyDocxEditors('form-1')).toBe(false);
    });

    it('clears dirty state when the editor unmounts', async () => {
      const view = render(
        <DocumentEditorContainer
          containerId='document-container-a'
          formId='form-1'
          stepId='step-a'
        />
      );
      await waitFor(() => view.getByTestId(`editor:${url}`));

      fireEvent.click(view.getByTestId(`dirty:${url}`));
      expect(hasDirtyDocxEditors('form-1')).toBe(true);

      view.unmount();
      expect(hasDirtyDocxEditors('form-1')).toBe(false);
    });

    it('never registers dirty state for readOnly (signed) envelopes', async () => {
      (featheryWindow() as any)[PENDING_DRAFTS_KEY][
        'document-container-a'
      ].envelopes[0].signed = true;

      const { getByTestId, queryByTestId } = render(
        <DocumentEditorContainer
          containerId='document-container-a'
          formId='form-1'
          stepId='step-a'
        />
      );
      await waitFor(() => getByTestId(`editor:${url}`));
      expect(queryByTestId(`dirty:${url}`)).toBeNull();
    });
  });
});

describe('DocumentEditorContainer revision group binding', () => {
  // How many revisions the document had at each rebind call. This is the
  // load-bearing signal: a rebind at `created` sees 0 and silently binds
  // nothing, which is exactly the bug being guarded against.
  let seenRevisionCounts: number[];

  beforeEach(() => {
    _clearDocxEditors();
    jest.clearAllMocks();
    OPEN_STATE.opened = false;
    seenRevisionCounts = [];
    (rebindRevisionGroups as jest.Mock).mockImplementation((editor: any) => {
      seenRevisionCounts.push(editor?.revisions?.length ?? 0);
      return editor?.revisions?.length ?? 0;
    });
    initState.formSchemas = {
      'form-key': schemaFor(['document-container-a'])
    };
    (featheryWindow() as any)[PENDING_DRAFTS_KEY] = {
      'document-container-a': draftFor('document-container-a')
    };
  });

  it('rebinds against an opened document, never the blank one at create', async () => {
    const view = render(
      <DocumentEditorContainer
        containerId='document-container-a'
        formId='form-1'
        stepId='step-1'
        assistantEnabled
      />
    );

    await waitFor(() => {
      expect(seenRevisionCounts.length).toBeGreaterThan(0);
    });
    // Every rebind must have observed the opened document's revisions. Rebinding
    // from onEditorReady instead records a 0 here and fails.
    expect(seenRevisionCounts).not.toContain(0);
    expect(rebindRevisionGroups).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrl: 'https://example.com/document-container-a.docx'
      })
    );
    view.unmount();
  });

  it('rebinds again when a regenerate reloads the document', async () => {
    const view = render(
      <DocumentEditorContainer
        containerId='document-container-a'
        formId='form-1'
        stepId='step-1'
        assistantEnabled
      />
    );
    await waitFor(() => {
      expect(seenRevisionCounts.length).toBeGreaterThan(0);
    });
    const afterFirstOpen = seenRevisionCounts.length;

    // The regenerate path: this event swaps the envelope and bumps reloadKey →
    // openNonce, so the source reopens. The in-memory group wrappers died with
    // the old document; the persisted customData tags did not, so this reopen
    // must rebind — otherwise a regenerated draft has no atomic accept groups.
    await act(async () => {
      featheryWindow().dispatchEvent(
        new CustomEvent('feathery-docx-editor-refresh', {
          detail: {
            containerId: 'document-container-a',
            documents: ['document-document-container-a'],
            envelopes: [
              {
                id: 'envelope-regenerated',
                document: 'document-document-container-a',
                file: 'https://example.com/regenerated.docx',
                type: 'docx',
                signed: false
              }
            ]
          }
        })
      );
    });

    await waitFor(() => {
      expect(seenRevisionCounts.length).toBeGreaterThan(afterFirstOpen);
    });
    expect(seenRevisionCounts).not.toContain(0);
    expect(rebindRevisionGroups).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrl: 'https://example.com/regenerated.docx'
      })
    );
    view.unmount();
  });

  it('survives a rebind failure without breaking registration', async () => {
    (rebindRevisionGroups as jest.Mock).mockImplementation(() => {
      throw new Error('grouping exploded');
    });

    const view = render(
      <DocumentEditorContainer
        containerId='document-container-a'
        formId='form-1'
        stepId='step-1'
        assistantEnabled
      />
    );

    await waitFor(() => {
      expect(getDocxEditor('form-1')).toMatchObject({
        sourceUrl: 'https://example.com/document-container-a.docx'
      });
    });
    view.unmount();
  });

  it('leaves assistant-off and read-only hosts outside review behavior', async () => {
    const assistantOff = render(
      <DocumentEditorContainer
        containerId='document-container-a'
        formId='form-1'
        stepId='step-1'
      />
    );
    const assistantOffEditor = await assistantOff.findByTestId(
      'editor:https://example.com/document-container-a.docx'
    );
    expect(assistantOffEditor).toHaveAttribute('data-review-changes', 'false');
    expect(rebindRevisionGroups).not.toHaveBeenCalled();
    assistantOff.unmount();

    jest.clearAllMocks();
    OPEN_STATE.opened = false;
    const action = (initState.formSchemas as any)['form-key'].steps[0]
      .buttons[0].properties.actions[0];
    action.editor_read_only = true;
    const readOnly = render(
      <DocumentEditorContainer
        containerId='document-container-a'
        formId='form-1'
        stepId='step-1'
        assistantEnabled
      />
    );
    const readOnlyEditor = await readOnly.findByTestId(
      'editor:https://example.com/document-container-a.docx'
    );
    expect(readOnlyEditor).toHaveAttribute('data-review-changes', 'false');
    expect(rebindRevisionGroups).not.toHaveBeenCalled();
    readOnly.unmount();
  });
});

describe('DocumentEditorContainer signing outcomes', () => {
  const CONTAINER = 'document-container-a';
  const showEnvelopeOutcome = jest.fn();

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
    mockFinalizeEnvelope
      .mockReset()
      .mockResolvedValue({ file: 'signable.pdf', type: 'pdf' });
    initState.sdkKey = 'test-sdk-key';
    mockFinalizeEnvelopeReview
      .mockReset()
      .mockResolvedValue({ docusign_envelope_id: 'ds-1', status: 'sent' });
    showEnvelopeOutcome.mockReset();
    setFormInternalState('form-1', { showEnvelopeOutcome });
  });

  afterEach(() => {
    _clearDocxEditors();
    initState.formSchemas = {};
    delete (featheryWindow() as any)[PENDING_DRAFTS_KEY];
    jest.restoreAllMocks();
  });

  it('forwards version-history save metadata to the client', async () => {
    mockSaveEnvelopeFile.mockClear();
    seed({});
    const { getByTestId } = mount();
    const saveId = `save:https://example.com/${CONTAINER}.docx`;
    await waitFor(() => expect(getByTestId(saveId)).toBeTruthy());

    await act(async () => {
      getByTestId(saveId).click();
    });

    await waitFor(() => expect(mockSaveEnvelopeFile).toHaveBeenCalled());
    const [envelopeId, , fileName, meta] = mockSaveEnvelopeFile.mock.calls[0];
    expect(envelopeId).toBe(`envelope-${CONTAINER}`);
    expect(fileName).toBe('document.docx');
    expect(meta).toMatchObject({
      sessionId: 'sess-1',
      closeSession: true,
      authors: [{ kind: 'user', label: 'You' }]
    });
  });

  it('keeps the editable document mounted when an operation fails', async () => {
    seed({});
    const { getByTestId, getByText } = mount();
    fireEvent.click(getByTestId('report-error'));
    expect(getByText('Save failed; retry')).toBeTruthy();
    expect(
      getByTestId(`editor:https://example.com/${CONTAINER}.docx`)
    ).toBeTruthy();
  });

  it('restores a version through the client', async () => {
    mockRestoreEnvelopeVersion.mockClear();
    seed({});
    const { getByTestId } = mount();
    const restoreId = `restore:https://example.com/${CONTAINER}.docx`;
    await waitFor(() => expect(getByTestId(restoreId)).toBeTruthy());

    await act(async () => {
      getByTestId(restoreId).click();
    });

    await waitFor(() => expect(mockRestoreEnvelopeVersion).toHaveBeenCalled());
    const [envelopeId, versionId, sessionId] =
      mockRestoreEnvelopeVersion.mock.calls[0];
    expect(envelopeId).toBe(`envelope-${CONTAINER}`);
    expect(versionId).toBe('version-1');
    expect(typeof sessionId).toBe('string'); // a fresh uuid
  });

  it('reopens the restored live DOCX, not the source version SFDT', async () => {
    seed({});
    const fetchSpy = jest.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy;
    mockRestoreEnvelopeVersion.mockClear().mockResolvedValueOnce({
      id: `envelope-${CONTAINER}`,
      file: 'restored.docx',
      editor_file: 'restored-editor.docx',
      version: { id: 'v-new', is_current: true, final_sfdt: 'old.sfdt.gz' }
    });
    const { getByTestId } = mount();
    await act(async () => {
      await mockHistory.restoreVersion('version-1');
    });
    expect(getByTestId('editor:restored-editor.docx')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    globalThis.fetch = originalFetch;
  });

  it('reuses the operation ID when a restore response is lost', async () => {
    seed({});
    const view = mount();
    mockRestoreEnvelopeVersion
      .mockClear()
      .mockRejectedValueOnce(new Error('lost response'));
    await act(async () => {
      await expect(mockHistory.restoreVersion('version-1')).rejects.toThrow(
        'lost response'
      );
    });
    await act(async () => {
      await mockHistory.restoreVersion('version-1');
    });
    expect(mockRestoreEnvelopeVersion.mock.calls[0][2]).toBe(
      mockRestoreEnvelopeVersion.mock.calls[1][2]
    );
    view.unmount();
  });

  it('keeps the old document when saving before regenerate fails', async () => {
    seed({});
    const view = mount();
    mockBeforeReplace.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      featheryWindow().dispatchEvent(
        new CustomEvent('feathery-docx-editor-refresh', {
          detail: {
            containerId: CONTAINER,
            documents: [`document-${CONTAINER}`],
            envelopes: [
              {
                id: 'replacement',
                document: `document-${CONTAINER}`,
                file: 'replacement.docx',
                type: 'docx'
              }
            ]
          }
        })
      );
    });
    expect(
      view.getByTestId(`editor:https://example.com/${CONTAINER}.docx`)
    ).toBeTruthy();
    expect(view.getByRole('alert').textContent).toContain(
      'current edits could not be saved'
    );
    view.unmount();
  });

  it('sends the reviewed docx to DocuSign instead of the Feathery sign page', async () => {
    Object.assign(fieldValues, {
      signer_field: 'filler@test.com',
      buyer_field: 'buyer@test.com'
    });
    seed({
      sign_method: 'docusign',
      editor_toolbar_actions: ['sign'],
      envelope_signer_field_key: 'signer_field',
      envelope_signers: [
        {
          document_id: `document-${CONTAINER}`,
          role_id: 'role-1',
          field_key: 'buyer_field'
        }
      ]
    });
    const { getByTestId } = mount();

    await waitFor(() => expect(getByTestId('terminal:sign')).toBeTruthy());
    getByTestId('terminal:sign').click();

    // The docx must be converted to a signable PDF before it is sent, and the
    // sign method goes with it so that conversion doesn't also mail a Feathery
    // invite on top of the DocuSign one.
    await waitFor(() => expect(mockFinalizeEnvelope).toHaveBeenCalled());
    expect(mockFinalizeEnvelope.mock.calls[0]).toEqual([
      `envelope-${CONTAINER}`,
      // Only the mapped role. Nobody signs inline on DocuSign, so the form
      // signer field routes to no one.
      [
        {
          document_id: `document-${CONTAINER}`,
          role_id: 'role-1',
          email: 'buyer@test.com',
          filler: false
        }
      ],
      'docusign'
    ]);
    await waitFor(() => expect(mockFinalizeEnvelopeReview).toHaveBeenCalled());
    const [action, params] = mockFinalizeEnvelopeReview.mock.calls[0];
    expect(action.sign_method).toBe('docusign');
    expect(params).toEqual({
      envelopes: [{ envelopeId: `envelope-${CONTAINER}` }],
      envelopeAction: 'sign',
      draft: false
    });
    // Nothing here navigates away, so the toast is the only confirmation.
    expect(showEnvelopeOutcome).toHaveBeenCalledWith('Sent for Signature', [
      `document-${CONTAINER}`
    ]);

    delete fieldValues.signer_field;
    delete fieldValues.buyer_field;
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
    expect(showEnvelopeOutcome).toHaveBeenCalledWith('Saved as Draft', [
      `document-${CONTAINER}`
    ]);
  });

  it('sends draft=true when Create Draft is the only signing outcome', async () => {
    seed({ sign_method: 'docusign', editor_toolbar_actions: ['draft'] });
    const { getByTestId } = mount();

    await waitFor(() => expect(getByTestId('terminal:draft')).toBeTruthy());
    getByTestId('terminal:draft').click();

    await waitFor(() => expect(mockFinalizeEnvelopeReview).toHaveBeenCalled());
    expect(mockFinalizeEnvelopeReview.mock.calls[0][1].draft).toBe(true);
  });

  it('fires document_review with action "download" after a container download', async () => {
    const runDocumentReviewLogic = jest.fn();
    setFormInternalState('form-1', {
      showEnvelopeOutcome,
      runDocumentReviewLogic
    });
    seed({ editor_toolbar_actions: ['download'] });
    const { getByTestId } = mount();

    await waitFor(() => expect(getByTestId('downloaded')).toBeTruthy());
    getByTestId('downloaded').click();

    await waitFor(() => expect(runDocumentReviewLogic).toHaveBeenCalled());
    const trigger = runDocumentReviewLogic.mock.calls[0][0];
    expect(trigger.type).toBe('document_review');
    expect(trigger.action).toBe('download');
    expect(trigger.envelopeIds).toEqual([`envelope-${CONTAINER}`]);
  });

  it('fires document_review with action "save" after a container save-to-field', async () => {
    const runDocumentReviewLogic = jest.fn();
    setFormInternalState('form-1', {
      showEnvelopeOutcome,
      runDocumentReviewLogic
    });
    seed({
      editor_toolbar_actions: ['save'],
      save_document_field_key: 'doc_url_field'
    });
    const { getByTestId } = mount();

    await waitFor(() => expect(getByTestId('saved')).toBeTruthy());
    getByTestId('saved').click();

    await waitFor(() => expect(runDocumentReviewLogic).toHaveBeenCalled());
    expect(runDocumentReviewLogic.mock.calls[0][0].action).toBe('save');
  });

  it('does not offer save/download review firing when the toolbar omits them', async () => {
    const runDocumentReviewLogic = jest.fn();
    setFormInternalState('form-1', {
      showEnvelopeOutcome,
      runDocumentReviewLogic
    });
    seed({ sign_method: 'feathery', editor_toolbar_actions: ['sign'] });
    const { queryByTestId } = mount();

    await waitFor(() => expect(queryByTestId('terminal:sign')).toBeTruthy());
    // Sign-only toolbar exposes no save/download review hooks.
    expect(queryByTestId('saved')).toBeNull();
    expect(queryByTestId('downloaded')).toBeNull();
  });

  it('keeps the Feathery eSign path when sign_method is not docusign', async () => {
    // Invited someone else, so the filler has no document to open and the
    // toast is all they get.
    mockFinalizeEnvelope.mockResolvedValue({
      file: 'signable.pdf',
      type: 'pdf',
      invited: true
    });
    seed({ sign_method: 'feathery', editor_toolbar_actions: ['sign'] });
    const { getByTestId } = mount();

    await waitFor(() => expect(getByTestId('terminal:sign')).toBeTruthy());
    getByTestId('terminal:sign').click();

    await waitFor(() => expect(mockFinalizeEnvelope).toHaveBeenCalled());
    expect(mockFinalizeEnvelopeReview).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(showEnvelopeOutcome).toHaveBeenCalledWith('Sent for Signature', [
        `document-${CONTAINER}`
      ])
    );
  });

  it('carries the signable file on the sign trigger (single file → files list)', async () => {
    const runDocumentReviewLogic = jest.fn();
    setFormInternalState('form-1', {
      showEnvelopeOutcome,
      runDocumentReviewLogic
    });
    // envelope_data returns a single `file`, not a `files` array like the
    // overlay's finalize — the trigger must still carry it.
    mockFinalizeEnvelope.mockResolvedValue({
      signer_id: null,
      invited: true,
      file: 'https://x/signable.pdf'
    });
    seed({ sign_method: 'feathery', editor_toolbar_actions: ['sign'] });
    const { getByTestId } = mount();

    await waitFor(() => expect(getByTestId('terminal:sign')).toBeTruthy());
    getByTestId('terminal:sign').click();

    await waitFor(() => expect(runDocumentReviewLogic).toHaveBeenCalled());
    const trigger = runDocumentReviewLogic.mock.calls[0][0];
    expect(trigger.action).toBe('sign');
    expect(trigger.files).toEqual(['https://x/signable.pdf']);
  });
});

describe('document tab navigation', () => {
  const containerId = 'packet-editor';
  const first = {
    id: 'env-a',
    document: 'doc-a',
    key: 'Agreement.docx',
    type: 'docx',
    file: 'a.docx',
    editor_file: 'a.editor.docx',
    signed: false
  };
  const second = {
    id: 'env-b',
    document: 'doc-b',
    key: 'Schedule.docx',
    type: 'docx',
    file: 'b.docx',
    signed: false
  };
  beforeEach(() => {
    mockBeforeReplace.mockReset().mockResolvedValue(undefined);
    mockGetCurrentEnvelope.mockReset().mockResolvedValue({});
    mockSaveEnvelopeFile.mockReset().mockResolvedValue({
      file: 'saved.docx',
      editor_file: 'saved.editor.docx'
    });
    mockSubmitCustom.mockClear();
    const schema = schemaFor([containerId]);
    schema.steps[0].buttons[0].properties.actions[0].documents = [
      'doc-a',
      'doc-b'
    ];
    initState.formSchemas = { 'form-key': schema };
    (featheryWindow() as any)[PENDING_DRAFTS_KEY] = {
      [containerId]: {
        documents: ['doc-a', 'doc-b'],
        envelopes: [first, second]
      }
    };
  });
  afterEach(() => {
    initState.formSchemas = {};
    delete (featheryWindow() as any)[PENDING_DRAFTS_KEY];
    _clearDocxEditors();
    _clearDocxDirtyRegistry();
  });

  it('retains the same live editor after saving and switching without crossing envelope history', async () => {
    const view = render(
      <DocumentEditorContainer containerId={containerId} formId='tabs-form' />
    );
    await view.findByTestId('editor:a.editor.docx');
    await act(async () => {
      fireEvent.click(view.getByTestId('save:a.editor.docx'));
    });
    await waitFor(() =>
      expect(mockSaveEnvelopeFile).toHaveBeenCalledWith(
        'env-a',
        expect.any(Blob),
        'document.docx',
        expect.any(Object)
      )
    );
    fireEvent.click(view.getByRole('tab', { name: 'Schedule.docx' }));
    await view.findByTestId('editor:b.docx');
    expect(mockBeforeReplace).not.toHaveBeenCalled();
    fireEvent.click(view.getByTestId('restore:b.docx'));
    await waitFor(() =>
      expect(mockRestoreEnvelopeVersion).toHaveBeenCalledWith(
        'env-b',
        'version-1',
        expect.any(String)
      )
    );
    fireEvent.click(view.getByRole('tab', { name: 'Agreement.docx' }));
    await view.findByTestId('editor:a.editor.docx');
    await waitFor(() =>
      expect(view.getByRole('tab', { name: 'Agreement.docx' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
    );
  });

  it('keeps local edits mounted across tab switches without saving', async () => {
    const view = render(
      <DocumentEditorContainer containerId={containerId} formId='tabs-form' />
    );
    const firstEditor = await view.findByTestId('editor:a.editor.docx');
    fireEvent.change(view.getByLabelText('local:a.editor.docx'), {
      target: { value: 'Unsaved A edit' }
    });
    fireEvent.click(view.getByTestId('dirty:a.editor.docx'));
    fireEvent.click(view.getByRole('tab', { name: 'Schedule.docx' }));
    await view.findByTestId('editor:b.docx');
    fireEvent.change(view.getByLabelText('local:b.docx'), {
      target: { value: 'Unsaved B edit' }
    });
    fireEvent.click(view.getByTestId('clean:b.docx'));
    expect(hasDirtyDocxEditors('tabs-form')).toBe(true);
    expect(getDocxEditor('tabs-form')).toMatchObject({ sourceUrl: 'b.docx' });
    fireEvent.click(view.getByRole('tab', { name: 'Agreement.docx' }));
    expect(view.getByTestId('editor:a.editor.docx')).toBe(firstEditor);
    expect(view.getByLabelText('local:a.editor.docx')).toHaveValue(
      'Unsaved A edit'
    );
    expect(view.getByLabelText('local:b.docx')).toHaveValue('Unsaved B edit');
    expect(mockBeforeReplace).not.toHaveBeenCalled();
    expect(mockSaveEnvelopeFile).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(getDocxEditor('tabs-form')).toMatchObject({
        sourceUrl: 'a.editor.docx'
      })
    );
  });

  it('reports failed Save all without losing either local editor and retries', async () => {
    const view = render(<DocumentEditorContainer containerId={containerId} />);
    await view.findByTestId('editor:a.editor.docx');
    fireEvent.click(view.getByRole('tab', { name: 'Schedule.docx' }));
    await view.findByTestId('editor:b.docx');
    mockBeforeReplace.mockRejectedValueOnce(new Error('Offline'));
    fireEvent.click(view.getByTestId('save-all:b.docx'));
    expect(await view.findByRole('alert')).toHaveTextContent('Offline');
    expect(view.getByTestId('editor:a.editor.docx')).toBeInTheDocument();
    expect(view.getByTestId('editor:b.docx')).toBeInTheDocument();
    fireEvent.click(view.getByTestId('save-all:b.docx'));
    await view.findByText('All documents saved');
    expect(mockBeforeReplace).toHaveBeenCalledTimes(3);
  });

  it('recovers each template after reload and retries a failed load without closing the active document', async () => {
    delete (featheryWindow() as any)[PENDING_DRAFTS_KEY];
    mockGetCurrentEnvelope
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error('Load failed'))
      .mockResolvedValueOnce(second);
    const view = render(<DocumentEditorContainer containerId={containerId} />);
    await view.findByTestId('editor:a.editor.docx');
    fireEvent.click(view.getByRole('tab', { name: 'Document 2' }));
    expect(await view.findByRole('alert')).toHaveTextContent('Load failed');
    expect(view.getByTestId('editor:a.editor.docx')).toBeInTheDocument();
    fireEvent.click(view.getByRole('tab', { name: 'Document 2' }));
    await view.findByTestId('editor:b.docx');
    expect(mockGetCurrentEnvelope.mock.calls.map((call) => call[0])).toEqual([
      'doc-a',
      'doc-b',
      'doc-b'
    ]);
  });

  it('replaces the whole packet on regeneration and keeps duplicate-template envelopes distinct', async () => {
    const view = render(<DocumentEditorContainer containerId={containerId} />);
    await view.findByTestId('editor:a.editor.docx');
    await act(async () =>
      featheryWindow().dispatchEvent(
        new CustomEvent('feathery-docx-editor-refresh', {
          detail: {
            containerId,
            envelopes: [
              { ...second, id: 'repeat-1', key: 'First instance' },
              {
                ...second,
                id: 'repeat-2',
                key: 'Second instance',
                file: 'repeat.docx'
              }
            ]
          }
        })
      )
    );
    await view.findByTestId('editor:b.docx');
    expect(view.queryByRole('tab', { name: 'Agreement.docx' })).toBeNull();
    fireEvent.click(view.getByRole('tab', { name: 'Second instance' }));
    await view.findByTestId('editor:repeat.docx');
    fireEvent.click(view.getByTestId('save:repeat.docx'));
    await waitFor(() =>
      expect(mockSaveEnvelopeFile).toHaveBeenCalledWith(
        'repeat-2',
        expect.any(Blob),
        'document.docx',
        expect.any(Object)
      )
    );
  });

  it('saves every document URL to the field in packet order', async () => {
    initState.sdkKey = 'test-sdk-key';
    const action = (initState.formSchemas as any)['form-key'].steps[0]
      .buttons[0].properties.actions[0];
    action.editor_toolbar_actions = ['save'];
    action.save_document_field_key = 'packet-files';
    const view = render(<DocumentEditorContainer containerId={containerId} />);
    await view.findByTestId('editor:a.editor.docx');
    await act(async () => {
      fireEvent.click(view.getByTestId('save:a.editor.docx'));
    });
    await waitFor(() => expect(mockSaveEnvelopeFile).toHaveBeenCalled());
    fireEvent.click(view.getByTestId('save-all:a.editor.docx'));
    await waitFor(() =>
      expect(mockSubmitCustom).toHaveBeenCalledWith({
        'packet-files': ['saved.docx', 'b.docx']
      })
    );
  });
  it('downloads the whole packet in order after flushing every visited editor', async () => {
    const action = (initState.formSchemas as any)['form-key'].steps[0]
      .buttons[0].properties.actions[0];
    action.editor_toolbar_actions = ['download'];
    mockDownloadAll.mockClear();
    const view = render(<DocumentEditorContainer containerId={containerId} />);
    await view.findByTestId('editor:a.editor.docx');
    fireEvent.click(view.getByRole('tab', { name: 'Schedule.docx' }));
    await view.findByTestId('editor:b.docx');
    fireEvent.click(view.getByTestId('download-all:b.docx'));
    await waitFor(() =>
      expect(mockDownloadAll).toHaveBeenCalledWith(
        ['a.docx', 'b.docx'],
        undefined,
        { cache: 'no-store' }
      )
    );
    expect(mockBeforeReplace).toHaveBeenCalledTimes(2);
  });

  it('saves only the chosen file to the field for an individual Save', async () => {
    initState.sdkKey = 'test-sdk-key';
    const action = (initState.formSchemas as any)['form-key'].steps[0]
      .buttons[0].properties.actions[0];
    action.editor_toolbar_actions = ['save'];
    action.save_document_field_key = 'packet-files';
    const view = render(<DocumentEditorContainer containerId={containerId} />);
    await view.findByTestId('editor:a.editor.docx');
    await act(async () => {
      fireEvent.click(view.getByTestId('save:a.editor.docx'));
    });
    await waitFor(() => expect(mockSaveEnvelopeFile).toHaveBeenCalled());
    fireEvent.click(view.getByTestId('saved'));
    await waitFor(() =>
      expect(mockSubmitCustom).toHaveBeenCalledWith({
        'packet-files': 'saved.docx'
      })
    );
    expect(mockSaveEnvelopeFile).toHaveBeenCalledTimes(1);
  });

  it('flushes all local documents before converting and sends every envelope to DocuSign', async () => {
    const action = (initState.formSchemas as any)['form-key'].steps[0]
      .buttons[0].properties.actions[0];
    action.editor_toolbar_actions = ['sign'];
    action.sign_method = 'docusign';
    const order: string[] = [];
    mockBeforeReplace.mockImplementation(async () => {
      order.push('save');
    });
    mockFinalizeEnvelope.mockReset().mockImplementation(async (id) => {
      order.push(id);
      return { file: id + '.pdf' };
    });
    mockFinalizeEnvelopeReview
      .mockReset()
      .mockResolvedValue({ status: 'sent' });
    const view = render(<DocumentEditorContainer containerId={containerId} />);
    await view.findByTestId('editor:a.editor.docx');
    fireEvent.click(view.getByRole('tab', { name: 'Schedule.docx' }));
    const secondEditor = await view.findByTestId('editor:b.docx');
    fireEvent.click(
      secondEditor.querySelector('[data-testid="terminal:sign"]')!
    );
    await waitFor(() => expect(mockFinalizeEnvelopeReview).toHaveBeenCalled());
    expect(order).toEqual(['save', 'save', 'env-a', 'env-b']);
    expect(mockFinalizeEnvelopeReview.mock.calls[0][1].envelopes).toEqual([
      { envelopeId: 'env-a' },
      { envelopeId: 'env-b' }
    ]);
    expect(view.getByTestId('editor:a.editor.docx')).toBeInTheDocument();
  });
});
