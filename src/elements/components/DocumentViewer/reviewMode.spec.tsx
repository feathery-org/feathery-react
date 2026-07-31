import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DocumentViewer from './index';

// The viewer lazily loads pdf.js via this module; keep it pending so
// DocumentCanvas just shows its loading skeleton — these tests only care
// about toolbar mode + finalize plumbing, not rendered PDF content (that's
// covered by DocumentCanvas.spec.tsx).
jest.mock('./pdfjsLoader', () => ({
  loadPdfjs: jest.fn(() => new Promise(() => {}))
}));

const basePayload = {
  documents: [
    { type: 'form' as const, pdf_url: 'http://x/a.pdf', envelope_id: 'env-1' }
  ],
  expires_at: '2999-01-01T00:00:00Z'
};

afterEach(() => {
  jest.clearAllMocks();
});

describe('DocumentViewer — generic Generate Documents review mode', () => {
  it('renders a single primary action labeled per envelope_action', () => {
    render(
      <DocumentViewer
        payload={basePayload}
        action={{
          envelope_action: 'open_in_editor',
          editor_toolbar_actions: ['download']
        }}
        setShow={jest.fn()}
        onComplete={jest.fn()}
      />
    );

    expect(
      screen.getByRole('button', { name: 'Download' })
    ).toBeInTheDocument();
    // Only one button should be named "Download": the single primary action.
    expect(screen.getAllByRole('button', { name: 'Download' })).toHaveLength(1);
  });

  it('labels the primary action "Sign" when envelope_action is sign/absent, and "Save" for save', () => {
    const { rerender } = render(
      <DocumentViewer
        payload={basePayload}
        action={{
          envelope_action: 'open_in_editor',
          editor_toolbar_actions: ['sign']
        }}
        setShow={jest.fn()}
        onComplete={jest.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Sign' })).toBeInTheDocument();

    rerender(
      <DocumentViewer
        payload={basePayload}
        action={{
          envelope_action: 'open_in_editor',
          editor_toolbar_actions: ['save']
        }}
        setShow={jest.fn()}
        onComplete={jest.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('calls onFinalize with the generic envelopes/attachments/envelopeAction shape and onComplete on success', async () => {
    const onFinalize = jest.fn().mockResolvedValue({ files: ['out.pdf'] });
    const onComplete = jest.fn();
    render(
      <DocumentViewer
        payload={basePayload}
        action={{
          envelope_action: 'open_in_editor',
          editor_toolbar_actions: ['download']
        }}
        setShow={jest.fn()}
        onComplete={onComplete}
        onFinalize={onFinalize}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    await waitFor(() => expect(onFinalize).toHaveBeenCalledTimes(1));
    expect(onFinalize).toHaveBeenCalledWith({
      envelopes: [{ envelopeId: 'env-1' }],
      envelopeAction: 'download'
    });
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });

  it('surfaces a finalize error without calling onComplete', async () => {
    const onFinalize = jest.fn().mockResolvedValue({
      status: 'error',
      message: 'Envelope limit exceeded'
    });
    const onComplete = jest.fn();
    render(
      <DocumentViewer
        payload={basePayload}
        action={{
          envelope_action: 'open_in_editor',
          editor_toolbar_actions: ['save']
        }}
        setShow={jest.fn()}
        onComplete={onComplete}
        onFinalize={onFinalize}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Envelope limit exceeded'
    );
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('finalizes a docusign sign review with an empty attachments list', async () => {
    const onFinalize = jest.fn().mockResolvedValue({
      docusign_envelope_id: 'ds-1',
      status: 'sent'
    });
    render(
      <DocumentViewer
        payload={basePayload}
        action={{
          envelope_action: 'open_in_editor',
          editor_toolbar_actions: ['sign']
        }}
        setShow={jest.fn()}
        onComplete={jest.fn()}
        onFinalize={onFinalize}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign' }));
    await waitFor(() => expect(onFinalize).toHaveBeenCalledTimes(1));
    expect(onFinalize).toHaveBeenCalledWith({
      envelopes: [{ envelopeId: 'env-1' }],
      envelopeAction: 'sign'
    });
  });
});
