import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DocumentViewer, {
  closesEditor,
  deferCompletion,
  finalizeOutcome,
  isToolbarActionDisabled,
  MAX_ATTACHMENT_BYTES,
  needsDraftRefresh,
  recordAttempt,
  ReviewSession
} from './index';
import { featheryDoc } from '../../../utils/browser';

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
        payload={{
          ...basePayload,
          // The filler's own token on one document only — finalize needs it to
          // open that one inline rather than emailing them an invite to it.
          documents: [
            { ...basePayload.documents[0], signer_id: 'signer-1' },
            {
              type: 'form' as const,
              pdf_url: 'http://x/b.pdf',
              envelope_id: 'env-2'
            }
          ]
        }}
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
      envelopes: [
        { envelopeId: 'env-1', signerId: 'signer-1' },
        { envelopeId: 'env-2', signerId: undefined }
      ],
      envelopeAction: 'download',
      draft: false,
      refreshDraft: false,
      completes: true
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
      draft: false,
      refreshDraft: false,
      completes: true
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
      draft: true,
      refreshDraft: false,
      completes: true
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
      draft: true,
      refreshDraft: false,
      completes: true
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

  describe('with editor_close_on_action false', () => {
    const renderKeepOpen = (
      toolbarActions: string[],
      result: Record<string, any> = { status: 'created' }
    ) => {
      const onFinalize = jest.fn().mockResolvedValue(result);
      const onComplete = jest.fn();
      const setShow = jest.fn();
      render(
        <DocumentViewer
          payload={basePayload}
          action={{
            envelope_action: 'open_in_editor',
            editor_toolbar_actions: toolbarActions,
            sign_method: 'docusign',
            editor_close_on_action: false
          }}
          setShow={setShow}
          onComplete={onComplete}
          onFinalize={onFinalize}
        />
      );
      return { onFinalize, onComplete, setShow };
    };
    const button = (name: string) => screen.getByRole('button', { name });
    // Every button is disabled while an action runs, Back included, so Back
    // turning enabled again marks the action as settled.
    const press = async (name: string) => {
      fireEvent.click(button(name));
      await waitFor(() => expect(button('Back')).toBeEnabled());
    };

    it('stays open after Create Draft and disables it', async () => {
      const { onFinalize, onComplete } = renderKeepOpen(['sign', 'draft']);

      await press('Create Draft');

      expect(button('Create Draft')).toBeDisabled();
      expect(onFinalize).toHaveBeenCalledTimes(1);
      expect(onComplete).not.toHaveBeenCalled();
      expect(button('Sign')).toBeEnabled();
    });

    it('lets Sign follow a draft, then disables Sign and Create Draft', async () => {
      const { onFinalize, onComplete } = renderKeepOpen(['sign', 'draft']);

      await press('Create Draft');
      await press('Sign');

      expect(button('Sign')).toBeDisabled();
      expect(onFinalize).toHaveBeenLastCalledWith({
        envelopes: [{ envelopeId: 'env-1' }],
        envelopeAction: 'sign',
        draft: false,
        refreshDraft: false,
        completes: true
      });
      expect(button('Create Draft')).toBeDisabled();
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('keeps Download available after Sign', async () => {
      const { onFinalize } = renderKeepOpen(['sign', 'download'], {
        status: 'sent'
      });

      await press('Sign');
      expect(button('Download')).toBeEnabled();
      await press('Download');

      expect(onFinalize).toHaveBeenCalledTimes(2);
      expect(onFinalize).toHaveBeenLastCalledWith(
        expect.objectContaining({ envelopeAction: 'download' })
      );
    });

    it('completes instead of cancelling on Back after a draft', async () => {
      const { onComplete, setShow } = renderKeepOpen(['sign', 'draft']);

      await press('Create Draft');
      fireEvent.click(button('Back'));

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(setShow).not.toHaveBeenCalled();
    });

    it('completes instead of cancelling on Escape after a draft', async () => {
      const { onComplete, setShow } = renderKeepOpen(['sign', 'draft']);

      await press('Create Draft');
      fireEvent.keyDown(featheryDoc(), { key: 'Escape' });

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(setShow).not.toHaveBeenCalled();
    });

    it('still completes on close when a later action failed', async () => {
      const { onFinalize, onComplete } = renderKeepOpen(['sign', 'draft']);

      await press('Create Draft');
      onFinalize.mockResolvedValueOnce({ status: 'error', message: 'Boom' });
      await press('Sign');
      expect(screen.getByRole('alert')).toHaveTextContent('Boom');
      fireEvent.click(button('Back'));

      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('lets the filler close again when the flow fails after a close', async () => {
      const { onComplete, setShow } = renderKeepOpen(['sign', 'draft']);
      onComplete
        .mockRejectedValueOnce(new Error('Flow failed'))
        .mockResolvedValueOnce(undefined);

      await press('Create Draft');
      fireEvent.click(button('Back'));

      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent('Flow failed')
      );
      expect(button('Back')).toBeEnabled();
      fireEvent.click(button('Back'));

      expect(onComplete).toHaveBeenCalledTimes(2);
      expect(setShow).not.toHaveBeenCalled();
    });

    it('cancels on Back when nothing completed yet', () => {
      const { onComplete, setShow } = renderKeepOpen(['sign', 'draft']);

      fireEvent.click(button('Back'));

      expect(setShow).toHaveBeenCalledWith(false);
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('closes on Continue for an unconfigured toolbar', async () => {
      const { onComplete } = renderKeepOpen([], { files: ['f.pdf'] });

      fireEvent.click(button('Continue'));

      await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    });

    it('completes once and freezes the screen when closed twice', async () => {
      const { onComplete, setShow } = renderKeepOpen([
        'sign',
        'draft',
        'download'
      ]);

      await press('Create Draft');
      fireEvent.click(button('Back'));
      fireEvent.click(button('Back'));
      fireEvent.keyDown(featheryDoc(), { key: 'Escape' });

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(setShow).not.toHaveBeenCalled();
      ['Back', 'Download', 'Sign', 'Create Draft'].forEach((name) =>
        expect(button(name)).toBeDisabled()
      );
    });

    it('completes once on Escape then Back', async () => {
      const { onComplete } = renderKeepOpen(['sign', 'draft']);

      await press('Create Draft');
      fireEvent.keyDown(featheryDoc(), { key: 'Escape' });
      fireEvent.click(button('Back'));

      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('stays open after Download when it is the only action', async () => {
      const { onFinalize, onComplete } = renderKeepOpen(['download'], {
        files: ['f.pdf']
      });

      await press('Download');
      expect(onComplete).not.toHaveBeenCalled();
      expect(onFinalize).toHaveBeenLastCalledWith(
        expect.objectContaining({ completes: true })
      );
      fireEvent.click(button('Back'));

      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('stays open after Save when it is the highest action', async () => {
      const { onFinalize, onComplete } = renderKeepOpen(['save', 'download'], {
        files: ['f.pdf']
      });

      await press('Save');
      await press('Download');
      expect(onComplete).not.toHaveBeenCalled();
      expect(onFinalize.mock.calls.map(([p]) => p.completes)).toEqual([
        true,
        false
      ]);
      fireEvent.click(button('Back'));

      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('still completes on close after the session expired', async () => {
      const { onFinalize, onComplete, setShow } = renderKeepOpen([
        'sign',
        'draft'
      ]);

      await press('Create Draft');
      onFinalize.mockResolvedValueOnce({
        status: 'error',
        message: 'Session expired'
      });
      await press('Sign');
      expect(screen.getByRole('alert')).toHaveTextContent(/expired/);
      fireEvent.click(button('Back'));

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(setShow).not.toHaveBeenCalled();
    });
  });

  it('leaves Create Draft enabled when the editor closes on action', async () => {
    const onComplete = jest.fn();
    render(
      <DocumentViewer
        payload={basePayload}
        action={{
          envelope_action: 'open_in_editor',
          editor_toolbar_actions: ['sign', 'draft'],
          sign_method: 'docusign',
          editor_close_on_action: true
        }}
        setShow={jest.fn()}
        onComplete={onComplete}
        onFinalize={jest.fn().mockResolvedValue({ status: 'created' })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create Draft' }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Create Draft' })).toBeEnabled();
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

  describe('review session', () => {
    const fresh: ReviewSession = {
      pendingCompletion: false,
      sent: false,
      editRevision: 0,
      draftedRevision: null,
      draftAttempted: false
    };
    const pressed = (
      session: ReviewSession,
      action: 'draft' | 'sign',
      docusignStatus?: string
    ) =>
      deferCompletion(recordAttempt(session, action), action, docusignStatus);

    it('completes a closing action at once unless the screen stays open', () => {
      expect(finalizeOutcome('sign', ['sign'], false)).toBe('complete');
      expect(finalizeOutcome('sign', ['sign'], true)).toBe('defer');
      expect(finalizeOutcome('download', ['download'], true)).toBe('defer');
      expect(finalizeOutcome('save', ['save', 'download'], true)).toBe('defer');
    });

    it('never keeps the screen open on Continue', () => {
      expect(finalizeOutcome('fill', [], true)).toBe('complete');
    });

    it('leaves the filler on a non-closing action either way', () => {
      expect(finalizeOutcome('download', ['sign', 'download'], true)).toBe(
        'stay'
      );
      expect(finalizeOutcome('download', ['sign', 'download'], false)).toBe(
        'stay'
      );
    });

    it('marks the draft current until the next edit', () => {
      const drafted = pressed({ ...fresh, editRevision: 3 }, 'draft');
      expect(drafted).toEqual({
        pendingCompletion: true,
        sent: false,
        editRevision: 3,
        draftedRevision: 3,
        draftAttempted: true
      });
      expect(isToolbarActionDisabled(drafted, 'draft')).toBe(true);
      expect(needsDraftRefresh(drafted, 'sign')).toBe(false);

      const edited = { ...drafted, editRevision: 4 };
      expect(isToolbarActionDisabled(edited, 'draft')).toBe(false);
      expect(needsDraftRefresh(edited, 'draft')).toBe(true);
      expect(needsDraftRefresh(edited, 'sign')).toBe(true);
      expect(needsDraftRefresh(edited, 'download')).toBe(false);
    });

    it('never refreshes before a Draft or Sign was pressed', () => {
      const edited = { ...fresh, editRevision: 2 };
      expect(needsDraftRefresh(edited, 'sign')).toBe(false);
      expect(needsDraftRefresh(recordAttempt(edited, 'download'), 'sign')).toBe(
        false
      );
      expect(isToolbarActionDisabled(fresh, 'draft')).toBe(false);
    });

    it('refreshes after a Draft or Sign whose outcome never arrived', () => {
      ['draft', 'sign'].forEach((first) => {
        const attempted = recordAttempt(fresh, first as 'draft' | 'sign');
        expect(needsDraftRefresh(attempted, 'draft')).toBe(true);
        expect(needsDraftRefresh(attempted, 'sign')).toBe(true);
        expect(needsDraftRefresh(attempted, 'download')).toBe(false);
        // A failed draft leaves Create Draft available to retry.
        expect(isToolbarActionDisabled(attempted, 'draft')).toBe(false);
      });
    });

    it('treats a Sign held as a DocuSign draft as a draft', () => {
      const held = pressed({ ...fresh, editRevision: 2 }, 'sign', 'created');
      expect(held.sent).toBe(false);
      expect(isToolbarActionDisabled(held, 'sign')).toBe(false);
      expect(isToolbarActionDisabled(held, 'draft')).toBe(true);
      expect(needsDraftRefresh(held, 'sign')).toBe(false);
      expect(needsDraftRefresh({ ...held, editRevision: 3 }, 'sign')).toBe(
        true
      );
      expect(pressed(fresh, 'sign', 'sent').sent).toBe(true);
    });

    it('locks a retried Draft that finds the envelope already sent', () => {
      // Sign reached DocuSign but its response was lost, so the filler retried
      // with Create Draft and the backend reported the envelope as sent.
      const lostSign = recordAttempt(fresh, 'sign');
      const retried = pressed(lostSign, 'draft', 'sent');
      expect(retried.sent).toBe(true);
      expect(retried.draftedRevision).toBeNull();
      expect(isToolbarActionDisabled(retried, 'sign')).toBe(true);
      expect(isToolbarActionDisabled(retried, 'draft')).toBe(true);
    });

    it('falls back to the press when the backend reports no status', () => {
      expect(pressed(fresh, 'draft').sent).toBe(false);
      expect(pressed(fresh, 'sign').sent).toBe(true);
    });

    it('ends signing and drafting once sent', () => {
      const sent = pressed(fresh, 'sign');
      expect(sent.sent).toBe(true);
      expect(isToolbarActionDisabled(sent, 'sign')).toBe(true);
      expect(isToolbarActionDisabled(sent, 'draft')).toBe(true);
      expect(isToolbarActionDisabled(sent, 'download')).toBe(false);
      expect(isToolbarActionDisabled(sent, 'save')).toBe(false);
    });
  });
});

describe('DocumentViewer — packet editing (editor_allow_attachments)', () => {
  const twoDocs = {
    ...basePayload,
    documents: [
      { ...basePayload.documents[0], name: 'A' },
      {
        type: 'form' as const,
        pdf_url: 'http://x/b.pdf',
        envelope_id: 'env-2',
        name: 'B'
      }
    ]
  };
  const attachment = {
    type: 'attachment' as const,
    envelope_id: 'att-1',
    name: 'bundle',
    file_name: 'bundle.zip',
    file_url: 'http://x/bundle.zip',
    size: 2048
  };
  const action = {
    envelope_action: 'open_in_editor',
    editor_toolbar_actions: ['download'],
    editor_allow_attachments: true
  };

  const renderViewer = (overrides: Record<string, any> = {}) => {
    const props = {
      payload: twoDocs,
      action,
      setShow: jest.fn(),
      onComplete: jest.fn(),
      onFinalize: jest.fn().mockResolvedValue({ files: [] }),
      onUploadAttachment: jest.fn().mockResolvedValue(attachment),
      ...overrides
    };
    render(<DocumentViewer {...props} />);
    return props;
  };

  const attach = async (name = 'bundle.zip') => {
    fireEvent.change(screen.getByTestId('attachment-input'), {
      target: { files: [new File(['zip'], name)] }
    });
    await screen.findByText('Attachment');
  };

  const finalizedIds = (onFinalize: jest.Mock) =>
    onFinalize.mock.calls[0][0].envelopes.map((e: any) => e.envelopeId);

  it('offers no packet editing unless the action enables it', () => {
    renderViewer({ action: { ...action, editor_allow_attachments: false } });
    expect(
      screen.queryByRole('button', { name: 'Add attachment' })
    ).not.toBeInTheDocument();
  });

  it('shows an unrenderable attachment as a file card and finalizes it in the chosen order', async () => {
    const { onFinalize, onUploadAttachment } = renderViewer();

    await attach();
    expect(onUploadAttachment).toHaveBeenCalledWith(expect.any(File));
    expect(screen.getByText('ZIP file · 2 KB — no preview available'));
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      'http://x/bundle.zip'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Move bundle up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move A down' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    await waitFor(() => expect(onFinalize).toHaveBeenCalledTimes(1));
    expect(finalizedIds(onFinalize)).toEqual(['att-1', 'env-1', 'env-2']);
  });

  it('drops a removed attachment from finalize', async () => {
    const { onFinalize } = renderViewer();

    await attach();
    fireEvent.click(screen.getByRole('button', { name: 'Remove bundle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    await waitFor(() => expect(onFinalize).toHaveBeenCalledTimes(1));
    expect(finalizedIds(onFinalize)).toEqual(['env-1', 'env-2']);
  });

  it('surfaces a failed upload', async () => {
    renderViewer({
      onUploadAttachment: jest
        .fn()
        .mockRejectedValue(new Error('Attachments can be at most 20MB.'))
    });

    fireEvent.change(screen.getByTestId('attachment-input'), {
      target: { files: [new File(['x'], 'big.zip')] }
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't attach big.zip: Attachments can be at most 20MB."
    );
  });

  it('rejects an oversized file without uploading it', async () => {
    const { onUploadAttachment } = renderViewer();
    const big = new File(['x'], 'huge.zip');
    Object.defineProperty(big, 'size', { value: MAX_ATTACHMENT_BYTES + 1 });

    fireEvent.change(screen.getByTestId('attachment-input'), {
      target: { files: [big] }
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't attach huge.zip: Attachments can be at most 20MB."
    );
    expect(onUploadAttachment).not.toHaveBeenCalled();
  });

  it('keeps a file dropped outside the documents list from leaving the form', () => {
    renderViewer();
    // fireEvent returns false once a handler prevented the default.
    expect(fireEvent.dragOver(screen.getByRole('dialog'))).toBe(false);
    expect(fireEvent.drop(screen.getByRole('dialog'))).toBe(false);
  });

  describe('with editor_close_on_action false', () => {
    const keepOpen = (toolbarActions: string[]) => ({
      ...action,
      editor_toolbar_actions: toolbarActions,
      sign_method: 'docusign',
      editor_close_on_action: false
    });
    const settle = () =>
      waitFor(() =>
        expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled()
      );

    it('finalizes the edited packet on a second press', async () => {
      const { onFinalize } = renderViewer({ action: keepOpen(['download']) });

      fireEvent.click(screen.getByRole('button', { name: 'Download' }));
      await settle();
      await attach();
      fireEvent.click(screen.getByRole('button', { name: 'Move bundle up' }));
      fireEvent.click(screen.getByRole('button', { name: 'Download' }));
      await settle();

      expect(
        onFinalize.mock.calls[1][0].envelopes.map((e: any) => e.envelopeId)
      ).toEqual(['env-1', 'att-1', 'env-2']);
    });

    it('locks the packet once DocuSign holds a draft of it', async () => {
      renderViewer({
        action: keepOpen(['sign', 'draft']),
        onFinalize: jest.fn().mockResolvedValue({ status: 'created' })
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create Draft' }));
      await settle();

      expect(
        screen.getByRole('button', { name: 'Add attachment' })
      ).toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'Move A down' })
      ).toBeDisabled();
    });
  });

  it('keeps the files that uploaded when another fails', async () => {
    const { onFinalize } = renderViewer({
      onUploadAttachment: jest
        .fn()
        .mockRejectedValueOnce(new Error('Upload failed'))
        .mockResolvedValueOnce(attachment)
    });

    fireEvent.change(screen.getByTestId('attachment-input'), {
      target: { files: [new File(['x'], 'bad.zip'), new File(['y'], 'ok.zip')] }
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('bad.zip');
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(onFinalize).toHaveBeenCalledTimes(1));
    expect(finalizedIds(onFinalize)).toEqual(['env-1', 'env-2', 'att-1']);
  });
});
