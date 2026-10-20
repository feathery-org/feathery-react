import { buildDocumentReviewTrigger } from '../document';

describe('buildDocumentReviewTrigger', () => {
  const action = { documents: ['tpl-1', { kind: 'quik' }] };
  const envelopes = [{ envelopeId: 'env-1' }, { envelopeId: 'env-2' }];

  it('describes the toolbar action and what it acted on', () => {
    expect(
      buildDocumentReviewTrigger({
        action,
        elementId: 'button-1',
        envelopes,
        envelopeAction: 'download',
        draft: false,
        result: { files: ['https://f/1.pdf', 'https://f/2.pdf'] }
      })
    ).toEqual({
      id: 'button-1',
      type: 'document_review',
      action: 'download',
      envelopeIds: ['env-1', 'env-2'],
      documentIds: ['tpl-1', { kind: 'quik' }],
      files: ['https://f/1.pdf', 'https://f/2.pdf']
    });
  });

  it('reports a DocuSign draft as its own action with the envelope id', () => {
    const trigger = buildDocumentReviewTrigger({
      action,
      elementId: '',
      envelopes,
      envelopeAction: 'sign',
      draft: true,
      result: { docusign_envelope_id: 'ds-9', status: 'complete' }
    });
    expect(trigger.action).toBe('draft');
    expect(trigger.docusignEnvelopeId).toBe('ds-9');
    expect(trigger.files).toBeUndefined();
  });

  it('copes with no documents and no finalize result', () => {
    expect(
      buildDocumentReviewTrigger({
        action: {},
        elementId: 'c-1',
        envelopes: [],
        envelopeAction: 'sign',
        draft: false,
        result: undefined
      })
    ).toEqual({
      id: 'c-1',
      type: 'document_review',
      action: 'sign',
      envelopeIds: [],
      documentIds: []
    });
  });
});
