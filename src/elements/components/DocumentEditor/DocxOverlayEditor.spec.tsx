import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import DocxOverlayEditor from './DocxOverlayEditor';
import { featheryWindow } from '../../../utils/browser';
import {
  _clearDocxDirtyRegistry,
  setDocxEditorDirty
} from '../DocxEditor/docxDirtyRegistry';

// Emulates the docx envelope editor: reports which envelope/registry key it
// mounted with and exposes its callbacks as buttons.
jest.mock('./DocxEnvelopeEditor', () => {
  const React = jest.requireActual('react');
  return {
    __esModule: true,
    envelopeSourceUrl: (env: any) => env?.editor_file ?? env?.file ?? undefined,
    default: function MockDocxEnvelopeEditor({
      envelope,
      source,
      registryKey,
      onTerminalOutcome,
      onError
    }: any) {
      return React.createElement(
        'div',
        {
          'data-testid': `docx:${envelope.id}`,
          'data-source': source?.url ?? 'none',
          'data-registry-key': registryKey
        },
        React.createElement('button', {
          key: 'terminal',
          'data-testid': 'terminal',
          onClick: () => onTerminalOutcome?.()
        }),
        React.createElement('button', {
          key: 'error',
          'data-testid': 'fail',
          onClick: () => onError('send failed')
        })
      );
    }
  };
});

const envelopes = [
  {
    id: 'env-1',
    file: 'https://files.test/a.docx',
    editor_file: null,
    document: 'doc-1',
    type: 'docx',
    key: 'agreement.docx'
  },
  {
    id: 'env-2',
    file: 'https://files.test/b.docx',
    editor_file: 'https://files.test/b-editor.docx',
    document: 'doc-2',
    type: 'docx',
    key: 'rider.docx'
  }
];

const renderOverlay = (props: Record<string, any> = {}) => {
  const setShow = jest.fn();
  const onComplete = jest.fn();
  render(
    <DocxOverlayEditor
      envelopes={envelopes as any}
      action={{ envelope_action: 'open_in_editor' }}
      client={{} as any}
      formId='form-1'
      setShow={setShow}
      onComplete={onComplete}
      {...props}
    />
  );
  return { setShow, onComplete };
};

afterEach(() => {
  _clearDocxDirtyRegistry();
  jest.restoreAllMocks();
});

describe('DocxOverlayEditor', () => {
  it('mounts one editor at a time and switches documents through the tabs', () => {
    renderOverlay();
    const first = screen.getByTestId('docx:env-1');
    expect(first.getAttribute('data-registry-key')).toBe('overlay:env-1');
    expect(first.getAttribute('data-source')).toBe('https://files.test/a.docx');
    expect(screen.queryByTestId('docx:env-2')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'rider.docx' }));
    // The control-bearing editor copy wins when the envelope has one.
    expect(screen.getByTestId('docx:env-2').getAttribute('data-source')).toBe(
      'https://files.test/b-editor.docx'
    );
    expect(screen.queryByTestId('docx:env-1')).toBeNull();
  });

  it('confirms before a switch discards unsaved changes', () => {
    renderOverlay();
    setDocxEditorDirty('form-1', 'overlay:env-1', true);
    const confirm = jest
      .spyOn(featheryWindow(), 'confirm')
      .mockReturnValue(false);

    fireEvent.click(screen.getByRole('tab', { name: 'rider.docx' }));
    expect(confirm).toHaveBeenCalled();
    // Declined: the dirty editor stays mounted.
    expect(screen.getByTestId('docx:env-1')).toBeTruthy();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('tab', { name: 'rider.docx' }));
    expect(screen.getByTestId('docx:env-2')).toBeTruthy();
  });

  it('confirms before closing over unsaved changes', () => {
    const { setShow } = renderOverlay();
    setDocxEditorDirty('form-1', 'overlay:env-1', true);
    const confirm = jest
      .spyOn(featheryWindow(), 'confirm')
      .mockReturnValue(false);

    fireEvent.click(screen.getByLabelText('Back'));
    expect(setShow).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByLabelText('Back'));
    expect(setShow).toHaveBeenCalledWith(false);
  });

  it('closes without a prompt when nothing is unsaved', () => {
    const { setShow } = renderOverlay();
    const confirm = jest.spyOn(featheryWindow(), 'confirm');
    fireEvent.click(screen.getByLabelText('Back'));
    expect(confirm).not.toHaveBeenCalled();
    expect(setShow).toHaveBeenCalledWith(false);
  });

  it('resumes the flow when a signing terminal action concludes', () => {
    const { onComplete } = renderOverlay();
    fireEvent.click(screen.getByTestId('terminal'));
    expect(onComplete).toHaveBeenCalled();
  });

  it('surfaces editor errors in a banner and keeps the editor mounted', () => {
    renderOverlay();
    fireEvent.click(screen.getByTestId('fail'));
    expect(screen.getByText('send failed')).toBeTruthy();
    expect(screen.getByTestId('docx:env-1')).toBeTruthy();
  });

  it('hides the document tabs for a single-envelope packet', () => {
    render(
      <DocxOverlayEditor
        envelopes={[envelopes[0]] as any}
        action={{}}
        client={{} as any}
        formId='form-1'
        setShow={jest.fn()}
        onComplete={jest.fn()}
      />
    );
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByTestId('docx:env-1')).toBeTruthy();
  });
});
