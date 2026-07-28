import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { initState } from '../../../utils/init';
import { ACTION_GENERATE_ENVELOPES } from '../../../utils/elementActions';
import { featheryWindow } from '../../../utils/browser';
import {
  _clearDocxEditors,
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
  steps: [
    {
      buttons: containerIds.map((containerId) => ({
        properties: {
          actions: [
            {
              type: ACTION_GENERATE_ENVELOPES,
              view_draft_container: containerId,
              documents: [`document-${containerId}`]
            }
          ]
        }
      }))
    }
  ]
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

  it('rejects a second mounted editor and its unmount cannot clear the first', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const first = render(
      <DocumentEditorContainer containerId='document-container-a' />
    );

    await waitFor(() =>
      expect(getDocxEditor()).toMatchObject({
        sourceUrl: 'https://example.com/document-container-a.docx'
      })
    );

    const second = render(
      <DocumentEditorContainer containerId='document-container-b' />
    );

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        'Feathery: only one document editor is supported per form. ' +
          'Ignored "document-container-b" because ' +
          '"document-container-a" is already registered.'
      )
    );
    expect(getDocxEditor()).toMatchObject({
      sourceUrl: 'https://example.com/document-container-a.docx'
    });

    second.unmount();
    expect(getDocxEditor()).toMatchObject({
      sourceUrl: 'https://example.com/document-container-a.docx'
    });

    first.unmount();
    expect(getDocxEditor()).toBeUndefined();
  });
});
