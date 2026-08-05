import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { initState } from '../../../utils/init';
import { ACTION_GENERATE_ENVELOPES } from '../../../utils/elementActions';
import { featheryWindow } from '../../../utils/browser';
import {
  _clearDocxEditors,
  getActiveDocxEditorEnvelopeTarget,
  getDocxEditor
} from '../../../assistant/tools/docx/docxEditorRegistry';
import {
  installRevisionGroupIsolation,
  rebindRevisionGroups
} from '../../../assistant/tools/docx/syncfusionDocumentOps';
import DocumentEditorContainer from './DocumentEditorContainer';

jest.mock('../../../assistant/tools/docx/syncfusionDocumentOps', () => ({
  installRevisionGroupIsolation: jest.fn(),
  rebindRevisionGroups: jest.fn()
}));

// Mirrors the real lifecycle in useDocxEditor: `onEditorReady` fires from
// SyncFusion's `created` callback against a BLANK default document, and `onReady`
// only after openAsync resolves — and again on every openNonce reload. The mock
// reflects that by exposing the document's revisions only once it has opened, so
// a rebind at create time observes an empty document and is detectably wrong.
const OPEN_STATE = { opened: false };

jest.mock('./index', () => {
  const React = jest.requireActual('react');

  return function MockDocxEditor({
    source,
    openNonce,
    onEditorReady,
    onReady
  }: {
    source?: { url?: string };
    openNonce?: number;
    onEditorReady?: (editor: any) => void;
    onReady?: () => void;
  }) {
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
    return React.createElement('div', {
      'data-testid': `editor:${source?.url ?? 'none'}`
    });
  };
});

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
              view_draft_container: containerId,
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
      />
    );

    // Isolation is document-independent, so it belongs at create time.
    await waitFor(() => {
      expect(installRevisionGroupIsolation).toHaveBeenCalled();
    });
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
      />
    );

    await waitFor(() => {
      expect(getDocxEditor('form-1')).toMatchObject({
        sourceUrl: 'https://example.com/document-container-a.docx'
      });
    });
    view.unmount();
  });
});
