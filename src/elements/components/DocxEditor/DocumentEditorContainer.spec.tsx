import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { initState } from '../../../utils/init';
import { ACTION_GENERATE_ENVELOPES } from '../../../utils/elementActions';
import { featheryWindow } from '../../../utils/browser';
import {
  _clearDocxEditors,
  getActiveDocxEditorEnvelopeTarget,
  getDocxEditor
} from '../../../assistant/tools/docxEditorRegistry';
import DocumentEditorContainer from './DocumentEditorContainer';

jest.mock('./index', () => {
  const React = jest.requireActual('react');

  return function MockDocxEditor({
    source,
    onEditorReady
  }: {
    source?: { url?: string };
    onEditorReady?: (editor: any) => void;
  }) {
    const editor = React.useMemo(
      () => ({ sourceUrl: source?.url }),
      [source?.url]
    );
    React.useEffect(() => onEditorReady?.(editor), [editor, onEditorReady]);
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
