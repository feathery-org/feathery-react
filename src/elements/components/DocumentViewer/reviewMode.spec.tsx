import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DocumentViewer from './index';

// The viewer lazily loads pdf.js via this module; keep it pending so
// DocumentCanvas just shows its loading skeleton — these tests only care
// about toolbar mode + finalize plumbing, not rendered PDF content (that's
// covered by DocumentCanvas.spec.tsx and NativeFieldLayer.spec.ts).
jest.mock('./pdfjsLoader', () => ({
  loadPdfjs: jest.fn(() => new Promise(() => {}))
}));

const basePayload = {
  documents: [
    { type: 'form' as const, pdf_url: 'http://x/a.pdf', envelope_id: 'env-1' }
  ],
  expires_at: '2999-01-01T00:00:00Z'
};

const baseClient = {
  uploadQuikAttachment: jest.fn(),
  finalizeQuikViewer: jest.fn()
};

afterEach(() => {
  jest.clearAllMocks();
});

describe('DocumentViewer — generic Generate Documents review mode', () => {
  it('renders a single primary action labeled per envelope_action, hiding the Quik Download/Save Draft toolbar', () => {
    render(
      <DocumentViewer
        payload={basePayload}
        action={{ review_documents: true, envelope_action: 'download' }}
        client={baseClient}
        setShow={jest.fn()}
        onComplete={jest.fn()}
      />
    );

    expect(
      screen.getByRole('button', { name: 'Download' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Save Draft' })
    ).not.toBeInTheDocument();
    // Only one button should be named "Download" (the single primary
    // action) — the Quik-only secondary Download button must not render.
    expect(screen.getAllByRole('button', { name: 'Download' })).toHaveLength(1);
  });

  it('labels the primary action "Sign" when envelope_action is sign/absent, and "Save" for save', () => {
    const { rerender } = render(
      <DocumentViewer
        payload={basePayload}
        action={{ review_documents: true }}
        client={baseClient}
        setShow={jest.fn()}
        onComplete={jest.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Sign' })).toBeInTheDocument();

    rerender(
      <DocumentViewer
        payload={basePayload}
        action={{ review_documents: true, envelope_action: 'save' }}
        client={baseClient}
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
        action={{ review_documents: true, envelope_action: 'download' }}
        client={baseClient}
        setShow={jest.fn()}
        onComplete={onComplete}
        onFinalize={onFinalize}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    await waitFor(() => expect(onFinalize).toHaveBeenCalledTimes(1));
    expect(onFinalize).toHaveBeenCalledWith({
      envelopes: [],
      attachments: [],
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
        action={{ review_documents: true, envelope_action: 'save' }}
        client={baseClient}
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

  it('does not call client.finalizeQuikViewer when a review onFinalize is provided', async () => {
    const onFinalize = jest.fn().mockResolvedValue({ files: ['out.pdf'] });
    render(
      <DocumentViewer
        payload={basePayload}
        action={{ review_documents: true, envelope_action: 'download' }}
        client={baseClient}
        setShow={jest.fn()}
        onComplete={jest.fn()}
        onFinalize={onFinalize}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(onFinalize).toHaveBeenCalledTimes(1));
    expect(baseClient.finalizeQuikViewer).not.toHaveBeenCalled();
  });
});

describe('DocumentViewer — Quik path stays unchanged (regression)', () => {
  it('still renders the Download + Save Draft + primary toolbar for a non-review payload', () => {
    render(
      <DocumentViewer
        payload={basePayload}
        action={{ review_action: 'sign' }}
        client={baseClient}
        setShow={jest.fn()}
        onComplete={jest.fn()}
      />
    );

    expect(screen.getAllByRole('button', { name: /Download/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Sign' })).toBeInTheDocument();
  });
});
