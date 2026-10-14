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
      onTerminalAction &&
        React.createElement('button', {
          key: 'terminal',
          'data-testid': `terminal:${terminalAction}`,
          // DocxEditor routes a failed terminal action to onError.
          onClick: () =>
            Promise.resolve(onTerminalAction()).catch((e: Error) =>
              onError?.(e.message)
            )
        }),
      onTerminalActionDraft &&
        React.createElement('button', {
          key: 'draft',
          'data-testid': 'terminal:draft-menu',
          onClick: () =>
            Promise.resolve(onTerminalActionDraft()).catch((e: Error) =>
              onError?.(e.message)
            )
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

// Stands in for the pdf.js-backed signed-PDF view so these tests don't load
// pdf.js; exposes its props for assertion.
jest.mock('./SignedEnvelopeView', () => {
  const React = jest.requireActual('react');
  return function MockSignedEnvelopeView({
    pdfUrl,
    downloadUrl,
    signUrl,
    onOpenSigningPage,
    openingSigningPage,
    status
  }: any) {
    return React.createElement(
      'div',
      {
        'data-testid': `signed-view:${pdfUrl}`,
        'data-download': downloadUrl,
        'data-sign-url': signUrl ?? '',
        'data-status': String(status)
      },
      onOpenSigningPage &&
        React.createElement('button', {
          'data-testid': 'open-signing-page',
          disabled: openingSigningPage,
          onClick: onOpenSigningPage
        })
    );
  };
});

const mockFinalizeEnvelope = jest.fn();
const mockGetCurrentEnvelope = jest.fn().mockResolvedValue({});
const mockFinalizeEnvelopeReview = jest.fn();
const mockSaveEnvelopeFile = jest.fn().mockResolvedValue({});
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
    mockFinalizeEnvelope.mockReset().mockResolvedValue({});
    mockGetCurrentEnvelope.mockReset().mockResolvedValue({});
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
          email: 'buyer@test.com',
          signer_id: 'buyer',
          name: 'Buyer',
          phone: '+15551234567'
        }
      ]
    });
    const { getByTestId } = mount();

    await waitFor(() => expect(getByTestId('terminal:sign')).toBeTruthy());
    await act(async () => {
      getByTestId('terminal:sign').click();
    });

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
          signer_id: 'buyer',
          name: 'Buyer',
          phone: '+15551234567',
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
    await act(async () => {
      getByTestId('terminal:draft-menu').click();
    });

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
    mockFinalizeEnvelope.mockResolvedValue({ invited: true });
    seed({ sign_method: 'feathery', editor_toolbar_actions: ['sign'] });
    const { getByTestId } = mount();

    await waitFor(() => expect(getByTestId('terminal:sign')).toBeTruthy());
    await act(async () => {
      getByTestId('terminal:sign').click();
    });

    await waitFor(() => expect(mockFinalizeEnvelope).toHaveBeenCalled());
    expect(mockFinalizeEnvelopeReview).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(showEnvelopeOutcome).toHaveBeenCalledWith('Sent for Signature', [
        `document-${CONTAINER}`
      ])
    );
  });

  it('swaps the docx editor for the signed PDF view after a Feathery sign', async () => {
    const url = `https://example.com/${CONTAINER}.docx`;
    // Finalize converts the docx to a PDF envelope and discards the editable
    // copy; the container must render that PDF, not reopen the gone docx.
    mockFinalizeEnvelope.mockResolvedValue({
      id: `envelope-${CONTAINER}`,
      file: 'https://x/signed.pdf',
      editor_file: null,
      type: 'pdf',
      signed: false,
      signer_id: null,
      invited: true
    });
    seed({ sign_method: 'feathery', editor_toolbar_actions: ['sign'] });
    const { getByTestId, queryByTestId } = mount();

    await waitFor(() => expect(getByTestId(`editor:${url}`)).toBeTruthy());
    await act(async () => {
      getByTestId('terminal:sign').click();
    });

    await waitFor(() =>
      expect(getByTestId('signed-view:https://x/signed.pdf')).toBeTruthy()
    );
    // The editor is gone, so it can't re-fetch the deleted docx and fail.
    expect(queryByTestId(`editor:${url}`)).toBeNull();
    expect(getByTestId('signed-view:https://x/signed.pdf')).toHaveAttribute(
      'data-status',
      'awaiting'
    );
  });

  it('re-fetches on focus and flips the signed PDF view to Signed', async () => {
    const url = `https://example.com/${CONTAINER}.docx`;
    mockFinalizeEnvelope.mockResolvedValue({
      id: `envelope-${CONTAINER}`,
      file: 'https://x/signable.pdf',
      editor_file: null,
      type: 'pdf',
      signed: false,
      signer_id: null,
      invited: true
    });
    seed({ sign_method: 'feathery', editor_toolbar_actions: ['sign'] });
    const { getByTestId } = mount();

    await waitFor(() => expect(getByTestId(`editor:${url}`)).toBeTruthy());
    await act(async () => {
      getByTestId('terminal:sign').click();
    });

    // Finalized but not yet signed → awaiting-signature PDF view.
    await waitFor(() =>
      expect(getByTestId('signed-view:https://x/signable.pdf')).toHaveAttribute(
        'data-status',
        'awaiting'
      )
    );

    // The filler signs on the hosted page and returns; the next load reports a
    // fully-signed envelope with the signed PDF.
    mockGetCurrentEnvelope.mockResolvedValue({
      id: `envelope-${CONTAINER}`,
      file: 'https://x/signed.pdf',
      editor_file: null,
      type: 'pdf',
      signed: true
    });
    await act(async () => {
      featheryWindow().dispatchEvent(new Event('focus'));
    });

    await waitFor(() =>
      expect(getByTestId('signed-view:https://x/signed.pdf')).toHaveAttribute(
        'data-status',
        'signed'
      )
    );
  });

  const finalizedPdf = (file = 'https://x/signable.pdf') => ({
    id: `envelope-${CONTAINER}`,
    file,
    editor_file: null,
    type: 'pdf',
    signed: false,
    signer_id: null,
    invited: true
  });
  const focus = () =>
    act(async () => {
      featheryWindow().dispatchEvent(new Event('focus'));
    });

  it('keeps the editor and shows the error when the DocuSign send fails', async () => {
    const url = `https://example.com/${CONTAINER}.docx`;
    mockFinalizeEnvelope.mockResolvedValue(finalizedPdf());
    mockFinalizeEnvelopeReview.mockResolvedValue({
      status: 'error',
      message: 'DocuSign rejected the send'
    });
    seed({ sign_method: 'docusign', editor_toolbar_actions: ['sign'] });
    const { getByTestId, getByRole, queryByTestId } = mount();

    await waitFor(() => expect(getByTestId(`editor:${url}`)).toBeTruthy());
    await act(async () => {
      getByTestId('terminal:sign').click();
    });

    await waitFor(() =>
      expect(getByRole('alert')).toHaveTextContent('DocuSign rejected the send')
    );
    expect(getByTestId(`editor:${url}`)).toBeTruthy();
    expect(queryByTestId('signed-view:https://x/signable.pdf')).toBeNull();
  });

  it('keeps the editor and its Sign button after Save as Draft', async () => {
    const url = `https://example.com/${CONTAINER}.docx`;
    mockFinalizeEnvelope.mockResolvedValue(finalizedPdf());
    mockFinalizeEnvelopeReview.mockResolvedValue({ status: 'created' });
    seed({
      sign_method: 'docusign',
      editor_toolbar_actions: ['sign', 'draft']
    });
    const { getByTestId } = mount();

    await waitFor(() =>
      expect(getByTestId('terminal:draft-menu')).toBeTruthy()
    );
    await act(async () => {
      getByTestId('terminal:draft-menu').click();
    });

    await waitFor(() =>
      expect(showEnvelopeOutcome).toHaveBeenCalledWith('Saved as Draft', [
        `document-${CONTAINER}`
      ])
    );
    expect(getByTestId(`editor:${url}`)).toBeTruthy();
    expect(getByTestId('terminal:sign')).toBeTruthy();
  });

  it('labels a DocuSign send and does not poll it on focus', async () => {
    mockFinalizeEnvelope.mockResolvedValue(finalizedPdf());
    seed({ sign_method: 'docusign', editor_toolbar_actions: ['sign'] });
    const { getByTestId } = mount();

    await waitFor(() => expect(getByTestId('terminal:sign')).toBeTruthy());
    await act(async () => {
      getByTestId('terminal:sign').click();
    });

    await waitFor(() =>
      expect(getByTestId('signed-view:https://x/signable.pdf')).toHaveAttribute(
        'data-status',
        'docusign'
      )
    );
    mockGetCurrentEnvelope.mockClear();
    await focus();
    expect(mockGetCurrentEnvelope).not.toHaveBeenCalled();
  });

  it('keeps the awaiting-signature view when a focus refresh fails or comes back empty', async () => {
    mockFinalizeEnvelope.mockResolvedValue(finalizedPdf());
    seed({ sign_method: 'feathery', editor_toolbar_actions: ['sign'] });
    const { getByTestId, queryByRole } = mount();

    await waitFor(() => expect(getByTestId('terminal:sign')).toBeTruthy());
    await act(async () => {
      getByTestId('terminal:sign').click();
    });
    await waitFor(() =>
      expect(getByTestId('signed-view:https://x/signable.pdf')).toBeTruthy()
    );
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGetCurrentEnvelope.mockClear();

    mockGetCurrentEnvelope.mockRejectedValueOnce(new Error('Failed to fetch'));
    await focus();
    mockGetCurrentEnvelope.mockResolvedValueOnce(undefined);
    await focus();
    // Both refreshes ran, and failing them left the view in place.
    expect(mockGetCurrentEnvelope).toHaveBeenCalledTimes(2);

    expect(getByTestId('signed-view:https://x/signable.pdf')).toHaveAttribute(
      'data-status',
      'awaiting'
    );
    expect(queryByRole('alert')).toBeNull();
  });

  it('keeps the loaded PDF when only the presigned query changes', async () => {
    const presigned = (sig: string) =>
      `https://x/envelopes/e1/signable.pdf?X-Amz-Signature=${sig}`;
    mockFinalizeEnvelope.mockResolvedValue(finalizedPdf(presigned('first')));
    seed({ sign_method: 'feathery', editor_toolbar_actions: ['sign'] });
    const { getByTestId } = mount();

    await waitFor(() => expect(getByTestId('terminal:sign')).toBeTruthy());
    await act(async () => {
      getByTestId('terminal:sign').click();
    });
    await waitFor(() =>
      expect(getByTestId(`signed-view:${presigned('first')}`)).toBeTruthy()
    );

    mockGetCurrentEnvelope.mockResolvedValue({
      ...finalizedPdf(presigned('second'))
    });
    await focus();

    const view = getByTestId(`signed-view:${presigned('first')}`);
    await waitFor(() =>
      expect(view).toHaveAttribute('data-download', presigned('second'))
    );
  });

  it('reloads the PDF when signing overwrites the same stored file', async () => {
    const presigned = (sig: string) =>
      `https://x/envelopes/e1/signable.pdf?X-Amz-Signature=${sig}`;
    mockFinalizeEnvelope.mockResolvedValue(finalizedPdf(presigned('first')));
    seed({ sign_method: 'feathery', editor_toolbar_actions: ['sign'] });
    const { getByTestId } = mount();

    await waitFor(() => expect(getByTestId('terminal:sign')).toBeTruthy());
    await act(async () => {
      getByTestId('terminal:sign').click();
    });
    await waitFor(() =>
      expect(getByTestId(`signed-view:${presigned('first')}`)).toBeTruthy()
    );

    mockGetCurrentEnvelope.mockResolvedValue({
      ...finalizedPdf(presigned('signed')),
      signed: true
    });
    await focus();

    await waitFor(() =>
      expect(getByTestId(`signed-view:${presigned('signed')}`)).toHaveAttribute(
        'data-status',
        'signed'
      )
    );
  });

  it('reloads a plain URL with a version query when signing overwrites it', async () => {
    const plain = 'https://x/envelopes/e1/signable.pdf';
    mockFinalizeEnvelope.mockResolvedValue(finalizedPdf(plain));
    seed({ sign_method: 'feathery', editor_toolbar_actions: ['sign'] });
    const { getByTestId } = mount();

    await waitFor(() => expect(getByTestId('terminal:sign')).toBeTruthy());
    await act(async () => {
      getByTestId('terminal:sign').click();
    });
    await waitFor(() =>
      expect(getByTestId(`signed-view:${plain}`)).toBeTruthy()
    );

    mockGetCurrentEnvelope.mockResolvedValue({
      ...finalizedPdf(plain),
      signed: true
    });
    await focus();

    const versioned =
      /^signed-view:https:\/\/x\/envelopes\/e1\/signable\.pdf\?v=\d+$/;
    const view = await waitFor(() => getByTestId(versioned));
    expect(view).toHaveAttribute('data-status', 'signed');
    expect(view.getAttribute('data-download')).toMatch(/signable\.pdf\?v=\d+$/);
  });

  it('offers the signing page again while the filler’s signature is awaited', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    // The tab opened after finalize may be blocked, so the link stays on hand.
    mockFinalizeEnvelope.mockResolvedValue({
      ...finalizedPdf(),
      signer_id: 'signer-7',
      invited: false
    });
    seed({ sign_method: 'feathery', editor_toolbar_actions: ['sign'] });
    const { getByTestId } = mount();

    await waitFor(() => expect(getByTestId('terminal:sign')).toBeTruthy());
    await act(async () => {
      getByTestId('terminal:sign').click();
    });

    await waitFor(() =>
      expect(
        getByTestId('signed-view:https://x/signable.pdf').getAttribute(
          'data-sign-url'
        )
      ).toContain('signer-7')
    );
    expect(getByTestId('signed-view:https://x/signable.pdf')).toHaveAttribute(
      'data-status',
      'awaiting'
    );
  });

  it('shows a PDF it did not send without a status and without polling', async () => {
    seed({ sign_method: 'feathery', editor_toolbar_actions: ['sign'] });
    delete (featheryWindow() as any)[PENDING_DRAFTS_KEY];
    mockGetCurrentEnvelope.mockResolvedValue({
      id: `envelope-${CONTAINER}`,
      file: 'https://x/reopened.pdf',
      editor_file: null,
      type: 'pdf',
      signed: false
    });
    const { getByTestId } = mount();

    await waitFor(() =>
      expect(getByTestId('signed-view:https://x/reopened.pdf')).toHaveAttribute(
        'data-status',
        'null'
      )
    );
    mockGetCurrentEnvelope.mockClear();
    await focus();
    expect(mockGetCurrentEnvelope).not.toHaveBeenCalled();
  });

  describe('after a reload', () => {
    const reopened = (
      sent: Record<string, any>,
      toolbar: string[] = ['sign'],
      action: Record<string, any> = {}
    ) => {
      seed({
        sign_method: 'feathery',
        editor_toolbar_actions: toolbar,
        ...action
      });
      delete (featheryWindow() as any)[PENDING_DRAFTS_KEY];
      mockGetCurrentEnvelope.mockResolvedValue({
        id: `envelope-${CONTAINER}`,
        file: 'https://x/sent.pdf',
        editor_file: null,
        type: 'pdf',
        signed: false,
        ...sent
      });
      return mount();
    };

    it('still shows a Feathery send as awaiting and keeps polling it', async () => {
      const { getByTestId } = reopened({ sent: true, sent_via: 'feathery' });

      await waitFor(() =>
        expect(getByTestId('signed-view:https://x/sent.pdf')).toHaveAttribute(
          'data-status',
          'awaiting'
        )
      );
      // Let the focus listener bind before firing focus.
      await act(async () => {});
      mockGetCurrentEnvelope.mockClear();
      await focus();
      expect(mockGetCurrentEnvelope).toHaveBeenCalledTimes(1);
    });

    it('fetches the signing page again and opens it', async () => {
      const open = jest
        .spyOn(featheryWindow(), 'open')
        .mockImplementation(() => null);
      Object.assign(fieldValues, {
        signer_field: 'alice@test.com',
        client_field: 'bob@test.com'
      });
      mockFinalizeEnvelope.mockResolvedValue({
        ...finalizedPdf('https://x/sent.pdf'),
        signer_id: 'signer-9',
        invited: false
      });
      const { getByTestId } = reopened(
        { sent: true, sent_via: 'feathery' },
        ['sign'],
        {
          envelope_signer_field_key: 'signer_field',
          envelope_signers: [
            {
              document_id: `document-${CONTAINER}`,
              role_id: 'role-client',
              field_key: 'client_field'
            },
            {
              document_id: `document-${CONTAINER}`,
              role_id: 'role-advisor',
              field_key: 'signer_field'
            }
          ]
        }
      );

      await waitFor(() =>
        expect(getByTestId('open-signing-page')).toBeTruthy()
      );
      await act(async () => {
        getByTestId('open-signing-page').click();
      });

      expect(mockFinalizeEnvelope).toHaveBeenCalledWith(
        `envelope-${CONTAINER}`,
        [
          {
            document_id: `document-${CONTAINER}`,
            role_id: 'role-client',
            email: 'bob@test.com',
            filler: false
          },
          {
            document_id: `document-${CONTAINER}`,
            role_id: 'role-advisor',
            email: 'alice@test.com',
            filler: true
          }
        ],
        'feathery'
      );
      expect(open).toHaveBeenCalledWith(
        expect.stringContaining('signer-9'),
        '_blank',
        'noopener'
      );
      // Kept as a link in case that tab was blocked too.
      expect(
        getByTestId('signed-view:https://x/sent.pdf').getAttribute(
          'data-sign-url'
        )
      ).toContain('signer-9');
      delete fieldValues.signer_field;
      delete fieldValues.client_field;
    });

    it('fetches the page once however often the button is clicked', async () => {
      jest.spyOn(featheryWindow(), 'open').mockImplementation(() => null);
      let finish: (value: any) => void = () => undefined;
      mockFinalizeEnvelope.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        })
      );
      const { getByTestId } = reopened({ sent: true, sent_via: 'feathery' });

      await waitFor(() =>
        expect(getByTestId('open-signing-page')).toBeTruthy()
      );
      // Two clicks before any re-render, then one more once it's disabled.
      await act(async () => {
        getByTestId('open-signing-page').click();
        getByTestId('open-signing-page').click();
      });
      expect(getByTestId('open-signing-page')).toBeDisabled();
      await act(async () => {
        getByTestId('open-signing-page').click();
      });
      await act(async () => {
        finish({
          ...finalizedPdf('https://x/sent.pdf'),
          signer_id: 'signer-9'
        });
      });

      expect(mockFinalizeEnvelope).toHaveBeenCalledTimes(1);
    });

    it('shows the signed PDF when it was signed elsewhere in the meantime', async () => {
      mockFinalizeEnvelope.mockRejectedValue(
        new Error('Signed envelopes cannot be modified')
      );
      const { getByTestId, queryByRole } = reopened({
        sent: true,
        sent_via: 'feathery'
      });
      await waitFor(() =>
        expect(getByTestId('open-signing-page')).toBeTruthy()
      );
      mockGetCurrentEnvelope.mockResolvedValue({
        id: `envelope-${CONTAINER}`,
        file: 'https://x/sent.pdf',
        editor_file: null,
        type: 'pdf',
        signed: true,
        sent: true,
        sent_via: 'feathery'
      });

      await act(async () => {
        getByTestId('open-signing-page').click();
      });

      // The signed file reloads with a version query.
      await waitFor(() =>
        expect(
          getByTestId(/^signed-view:https:\/\/x\/sent\.pdf/)
        ).toHaveAttribute('data-status', 'signed')
      );
      expect(queryByRole('alert')).toBeNull();
    });

    it('says so when it is someone else’s turn to sign', async () => {
      mockFinalizeEnvelope.mockResolvedValue({
        ...finalizedPdf('https://x/sent.pdf'),
        signer_id: null
      });
      const { getByTestId, findByRole } = reopened({
        sent: true,
        sent_via: 'feathery'
      });

      await waitFor(() =>
        expect(getByTestId('open-signing-page')).toBeTruthy()
      );
      await act(async () => {
        getByTestId('open-signing-page').click();
      });

      expect((await findByRole('alert')).textContent).toContain(
        'waiting on another signer'
      );
    });

    it('labels a DocuSign send, offers no Feathery page and does not poll', async () => {
      const { getByTestId, queryByTestId } = reopened({
        sent: true,
        sent_via: 'docusign'
      });

      await waitFor(() =>
        expect(getByTestId('signed-view:https://x/sent.pdf')).toHaveAttribute(
          'data-status',
          'docusign'
        )
      );
      expect(queryByTestId('open-signing-page')).toBeNull();
      // Let the focus listener bind, so a wrongful poll would show.
      await act(async () => {});
      mockGetCurrentEnvelope.mockClear();
      await focus();
      expect(mockGetCurrentEnvelope).not.toHaveBeenCalled();
    });

    it('offers no signing page on a toolbar without Sign', async () => {
      const { getByTestId, queryByTestId } = reopened(
        { sent: true, sent_via: 'feathery' },
        ['download']
      );

      await waitFor(() =>
        expect(getByTestId('signed-view:https://x/sent.pdf')).toHaveAttribute(
          'data-status',
          'awaiting'
        )
      );
      expect(queryByTestId('open-signing-page')).toBeNull();
    });
  });

  it('offers no signing page after a send that only invited others', async () => {
    mockFinalizeEnvelope.mockResolvedValue({
      ...finalizedPdf(),
      signer_id: null,
      invited: true
    });
    seed({ sign_method: 'feathery', editor_toolbar_actions: ['sign'] });
    const { getByTestId, queryByTestId } = mount();

    await waitFor(() => expect(getByTestId('terminal:sign')).toBeTruthy());
    await act(async () => {
      getByTestId('terminal:sign').click();
    });

    await waitFor(() =>
      expect(getByTestId('signed-view:https://x/signable.pdf')).toHaveAttribute(
        'data-status',
        'awaiting'
      )
    );
    expect(queryByTestId('open-signing-page')).toBeNull();
    expect(mockFinalizeEnvelope).toHaveBeenCalledTimes(1);
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
    await act(async () => {
      getByTestId('terminal:sign').click();
    });

    await waitFor(() => expect(runDocumentReviewLogic).toHaveBeenCalled());
    const trigger = runDocumentReviewLogic.mock.calls[0][0];
    expect(trigger.action).toBe('sign');
    expect(trigger.files).toEqual(['https://x/signable.pdf']);
  });
});
