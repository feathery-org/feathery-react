import {
  buildReviewFinalize,
  dispatchEditorRefresh,
  runEnvelopeOutcome,
  EDITOR_REFRESH_EVENT,
  PENDING_EDITOR_DRAFTS_KEY
} from '../envelopeActions';

jest.mock('../../utils/browser', () => ({
  ...jest.requireActual('../../utils/browser'),
  openTab: jest.fn(),
  downloadAllFileUrls: jest.fn()
}));
jest.mock('../../utils/document', () => ({
  ...jest.requireActual('../../utils/document'),
  getSignUrl: jest.fn((token: string) => `https://sign.test/${token}`)
}));

import { downloadAllFileUrls, openTab } from '../../utils/browser';
import { getSignUrl } from '../../utils/document';

const makeDeps = (overrides: Record<string, any> = {}) => ({
  client: {
    submitCustom: jest.fn(),
    finalizeEnvelopeReview: jest.fn()
  },
  updateFieldValues: jest.fn(),
  showOutcome: jest.fn(),
  ...overrides
});

afterEach(() => {
  jest.clearAllMocks();
  delete (window as any)[PENDING_EDITOR_DRAFTS_KEY];
});

describe('runEnvelopeOutcome', () => {
  it('opens the sign page in a new tab for the matched signer', async () => {
    const deps = makeDeps();
    await runEnvelopeOutcome(
      { envelope_action: 'sign' },
      { signers: [{ invited: true }, { signer_id: 'tok-1' }] },
      deps
    );
    expect(getSignUrl).toHaveBeenCalledWith('tok-1', undefined);
    expect(openTab).toHaveBeenCalledWith('https://sign.test/tok-1');
  });

  it('uses the redirect navigation hook when the action redirects', async () => {
    const navigateToSignUrl = jest.fn();
    const deps = makeDeps({ navigateToSignUrl });
    await runEnvelopeOutcome(
      { envelope_action: 'sign', redirect: true },
      { signers: [{ signer_id: 'tok-2' }] },
      deps
    );
    expect(navigateToSignUrl).toHaveBeenCalledWith('https://sign.test/tok-2');
    expect(openTab).not.toHaveBeenCalled();
  });

  it('falls back to a new tab on redirect when no navigation hook exists', async () => {
    // The logic-rule flow has no step to complete, so it passes no hook.
    const deps = makeDeps();
    await runEnvelopeOutcome(
      { envelope_action: 'sign', redirect: true },
      { signers: [{ signer_id: 'tok-3' }] },
      deps
    );
    expect(openTab).toHaveBeenCalledWith('https://sign.test/tok-3');
  });

  it('announces an invited batch the filler cannot sign themselves', async () => {
    const deps = makeDeps();
    await runEnvelopeOutcome(
      { envelope_action: 'sign', documents: ['doc-1'] },
      { signers: [{ invited: true }] },
      deps
    );
    expect(deps.showOutcome).toHaveBeenCalledWith('Sent for Signature', [
      'doc-1'
    ]);
    expect(openTab).not.toHaveBeenCalled();
  });

  it('announces a DocuSign sign instead of opening a sign page', async () => {
    const deps = makeDeps();
    await runEnvelopeOutcome(
      {
        envelope_action: 'sign',
        sign_method: 'docusign',
        documents: ['doc-1']
      },
      { docusign_envelope_id: 'env' },
      deps
    );
    expect(deps.showOutcome).toHaveBeenCalledWith('Sent for Signature', [
      'doc-1'
    ]);
    expect(openTab).not.toHaveBeenCalled();
  });

  it('labels a DocuSign draft as saved rather than sent', async () => {
    const deps = makeDeps();
    await runEnvelopeOutcome(
      { envelope_action: 'open_in_editor', sign_method: 'docusign' },
      {},
      deps,
      'sign',
      true
    );
    expect(deps.showOutcome).toHaveBeenCalledWith(
      'Saved as Draft',
      undefined
    );
  });

  it('downloads the generated files', async () => {
    const deps = makeDeps();
    await runEnvelopeOutcome(
      { envelope_action: 'download', envelope_zip_name: 'zip' },
      { files: ['a.pdf', 'b.pdf'] },
      deps
    );
    expect(downloadAllFileUrls).toHaveBeenCalledWith(
      ['a.pdf', 'b.pdf'],
      'zip'
    );
  });

  it('saves files to the configured field, unwrapping a single file', async () => {
    const deps = makeDeps();
    await runEnvelopeOutcome(
      { envelope_action: 'save', save_document_field_key: 'doc_field' },
      { files: ['only.pdf'] },
      deps
    );
    expect(deps.updateFieldValues).toHaveBeenCalledWith({
      doc_field: 'only.pdf'
    });
    expect(deps.client.submitCustom).toHaveBeenCalledWith({
      doc_field: 'only.pdf'
    });
  });

  it('lets the toolbar action override the configured envelope action', async () => {
    const deps = makeDeps();
    await runEnvelopeOutcome(
      { envelope_action: 'open_in_editor', envelope_zip_name: '' },
      { files: ['a.pdf'] },
      deps,
      'download'
    );
    expect(downloadAllFileUrls).toHaveBeenCalled();
  });

  it('does nothing for a container-bound editor action', async () => {
    // The container consumes the generate response itself.
    const deps = makeDeps();
    await runEnvelopeOutcome(
      { envelope_action: 'open_in_editor', editor_mode: 'container-abc' },
      { signers: [{ signer_id: 'tok' }] },
      deps,
      'sign'
    );
    expect(openTab).not.toHaveBeenCalled();
    expect(deps.showOutcome).not.toHaveBeenCalled();
  });
});

describe('buildReviewFinalize', () => {
  const params = {
    envelopes: [{ envelopeId: 'env-1' }],
    envelopeAction: 'download' as const,
    draft: false
  };

  it('treats a missing finalize response as an error, not a success', async () => {
    const deps = makeDeps();
    deps.client.finalizeEnvelopeReview.mockResolvedValue(undefined);
    const finalize = buildReviewFinalize({ action: {}, deps });
    await expect(finalize(params)).resolves.toEqual({
      status: 'error',
      message: 'Failed to finalize documents. Please try again.'
    });
    expect(downloadAllFileUrls).not.toHaveBeenCalled();
  });

  it('returns backend errors without running the outcome', async () => {
    const deps = makeDeps();
    const error = { status: 'error', message: 'expired' };
    deps.client.finalizeEnvelopeReview.mockResolvedValue(error);
    const finalize = buildReviewFinalize({ action: {}, deps });
    await expect(finalize(params)).resolves.toBe(error);
    expect(downloadAllFileUrls).not.toHaveBeenCalled();
  });

  it('runs the pressed outcome on success and reports the result', async () => {
    const deps = makeDeps();
    const result = { files: ['a.pdf'] };
    deps.client.finalizeEnvelopeReview.mockResolvedValue(result);
    const onFinalized = jest.fn();
    const finalize = buildReviewFinalize({
      action: { envelope_action: 'open_in_editor' },
      deps,
      onFinalized
    });
    await expect(finalize(params)).resolves.toBe(result);
    expect(downloadAllFileUrls).toHaveBeenCalled();
    expect(onFinalized).toHaveBeenCalledWith(result);
  });
});

describe('dispatchEditorRefresh', () => {
  it('stores the draft for unmounted editors and notifies mounted ones', () => {
    const listener = jest.fn();
    window.addEventListener(EDITOR_REFRESH_EVENT, listener);
    try {
      const detail = dispatchEditorRefresh(
        'container-abc',
        { documents: ['doc-1'] },
        { envelopes: [{ id: 'env-1' }] }
      );
      expect(detail).toEqual({
        containerId: 'container-abc',
        documents: ['doc-1'],
        envelopes: [{ id: 'env-1' }]
      });
      expect((window as any)[PENDING_EDITOR_DRAFTS_KEY]['container-abc']).toBe(
        detail
      );
      expect(listener).toHaveBeenCalledTimes(1);
      expect((listener.mock.calls[0][0] as CustomEvent).detail).toBe(detail);
    } finally {
      window.removeEventListener(EDITOR_REFRESH_EVENT, listener);
    }
  });

  it('keeps drafts for other containers', () => {
    dispatchEditorRefresh('container-a', {}, {});
    dispatchEditorRefresh('container-b', {}, {});
    const drafts = (window as any)[PENDING_EDITOR_DRAFTS_KEY];
    expect(Object.keys(drafts)).toEqual(['container-a', 'container-b']);
  });
});
