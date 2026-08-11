import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DocumentViewer, { closesEditor } from './index';

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
      envelopeAction: 'download',
      draft: false
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
      envelopeAction: 'sign',
      draft: false
    });
  });

  it('offers Create Draft alongside Sign when the toolbar configures both', async () => {
    const onFinalize = jest.fn().mockResolvedValue({
      docusign_envelope_id: 'ds-draft',
      status: 'created'
    });
    render(
      <DocumentViewer
        payload={basePayload}
        action={{
          envelope_action: 'open_in_editor',
          editor_toolbar_actions: ['sign', 'draft'],
          sign_method: 'docusign'
        }}
        setShow={jest.fn()}
        onComplete={jest.fn()}
        onFinalize={onFinalize}
      />
    );

    // Both buttons render; Create Draft finalizes as a sign with draft:true.
    expect(screen.getByRole('button', { name: 'Sign' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create Draft' }));

    await waitFor(() => expect(onFinalize).toHaveBeenCalledTimes(1));
    expect(onFinalize).toHaveBeenCalledWith({
      envelopes: [{ envelopeId: 'env-1' }],
      envelopeAction: 'sign',
      draft: true
    });
  });

  it('offers only Create Draft when the toolbar configures draft alone', async () => {
    const onFinalize = jest.fn().mockResolvedValue({
      docusign_envelope_id: 'ds-draft2',
      status: 'created'
    });
    render(
      <DocumentViewer
        payload={basePayload}
        action={{
          envelope_action: 'open_in_editor',
          editor_toolbar_actions: ['draft'],
          sign_method: 'docusign'
        }}
        setShow={jest.fn()}
        onComplete={jest.fn()}
        onFinalize={onFinalize}
      />
    );

    expect(
      screen.queryByRole('button', { name: 'Sign' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create Draft' }));

    await waitFor(() => expect(onFinalize).toHaveBeenCalledTimes(1));
    expect(onFinalize).toHaveBeenCalledWith({
      envelopes: [{ envelopeId: 'env-1' }],
      envelopeAction: 'sign',
      draft: true
    });
  });

  // The editor must not close on a non-conclusive action, or pressing Download
  // would strand a configured Sign the filler never got to press.
  describe('exit behaviour', () => {
    const renderWith = (toolbarActions: string[], onComplete: jest.Mock) => {
      const onFinalize = jest.fn().mockResolvedValue({ files: ['f.pdf'] });
      render(
        <DocumentViewer
          payload={basePayload}
          action={{
            envelope_action: 'open_in_editor',
            editor_toolbar_actions: toolbarActions,
            sign_method: 'docusign'
          }}
          setShow={jest.fn()}
          onComplete={onComplete}
          onFinalize={onFinalize}
        />
      );
      return onFinalize;
    };

    it('keeps the editor open on Download when Sign is also offered', async () => {
      const onComplete = jest.fn();
      const onFinalize = renderWith(['sign', 'download'], onComplete);

      fireEvent.click(screen.getByRole('button', { name: 'Download' }));

      await waitFor(() => expect(onFinalize).toHaveBeenCalledTimes(1));
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('keeps the editor open on Save when Sign is also offered', async () => {
      const onComplete = jest.fn();
      const onFinalize = renderWith(['sign', 'save'], onComplete);

      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(onFinalize).toHaveBeenCalledTimes(1));
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('closes on Create Draft even though Sign outranks it', async () => {
      const onComplete = jest.fn();
      renderWith(['sign', 'draft'], onComplete);

      fireEvent.click(screen.getByRole('button', { name: 'Create Draft' }));

      await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    });

    it('closes on Download when it is the only action', async () => {
      const onComplete = jest.fn();
      renderWith(['download'], onComplete);

      fireEvent.click(screen.getByRole('button', { name: 'Download' }));

      await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    });
  });

  describe('closesEditor', () => {
    it('closes for the conclusive signing actions regardless of what else is offered', () => {
      expect(closesEditor('sign', ['sign', 'download', 'save'])).toBe(true);
      // Draft is a peer of sign, not merely lower priority.
      expect(closesEditor('draft', ['sign', 'draft'])).toBe(true);
    });

    it('does not close for download or save whenever a signing action is offered', () => {
      expect(closesEditor('download', ['sign', 'download'])).toBe(false);
      expect(closesEditor('save', ['sign', 'save'])).toBe(false);
      expect(closesEditor('download', ['draft', 'download'])).toBe(false);
      expect(closesEditor('save', ['draft', 'save'])).toBe(false);
    });

    it('closes for download only when it stands alone', () => {
      expect(closesEditor('download', ['download'])).toBe(true);
      expect(closesEditor('download', ['download', 'save'])).toBe(false);
    });

    it('closes for save when it is the highest offered', () => {
      expect(closesEditor('save', ['save'])).toBe(true);
      expect(closesEditor('save', ['save', 'download'])).toBe(true);
    });

    it('closes for the unconfigured Continue button', () => {
      expect(closesEditor('fill', [])).toBe(true);
    });
  });
});
