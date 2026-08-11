import { getFormContext } from '../formContext';
import { setFormInternalState } from '../internalState';

describe('feathery.generateDocuments logic-rule method routing', () => {
  const uuid = 'formContext-test';
  let client: any;
  let flow: jest.Mock;

  beforeEach(() => {
    client = {
      generateDocuments: jest.fn().mockResolvedValue({ files: [] })
    };
    flow = jest.fn().mockResolvedValue({ files: [] });
    setFormInternalState(uuid, {
      fields: {},
      client,
      generateEnvelopeFlow: flow
    } as any);
  });

  it('routes the editor + signer options through the form flow with a built action', () => {
    getFormContext(uuid).generateDocuments({
      documentIds: ['tpl-1'],
      signerEmail: 'signer@x.com',
      envelopeAction: 'open_in_editor',
      toolbarActions: ['sign', 'download'],
      zipName: 'docs',
      saveDocumentFieldKey: 'saved_files'
    });

    expect(flow).toHaveBeenCalledTimes(1);
    const [action, signerEmail] = flow.mock.calls[0];
    expect(signerEmail).toBe('signer@x.com');
    expect(action).toMatchObject({
      type: 'open_fuser_envelopes',
      documents: ['tpl-1'],
      envelope_action: 'open_in_editor',
      editor_toolbar_actions: ['sign', 'download'],
      envelope_zip_name: 'docs',
      save_document_field_key: 'saved_files',
      run_async: true
    });
    expect(client.generateDocuments).not.toHaveBeenCalled();
  });

  it('routes a bare sign envelope action through the flow', () => {
    getFormContext(uuid).generateDocuments({
      documentIds: ['tpl-1'],
      envelopeAction: 'sign'
    });

    expect(flow).toHaveBeenCalledTimes(1);
    expect(flow.mock.calls[0][0]).toMatchObject({ envelope_action: 'sign' });
    expect(client.generateDocuments).not.toHaveBeenCalled();
  });

  it('routes a quik-only document list through the flow even with no other options', () => {
    getFormContext(uuid).generateDocuments({ documentIds: [{ kind: 'quik' }] });

    expect(flow).toHaveBeenCalledTimes(1);
    expect(flow.mock.calls[0][0]).toMatchObject({
      documents: [{ kind: 'quik' }]
    });
    expect(client.generateDocuments).not.toHaveBeenCalled();
  });

  it('keeps the simple client path for plain template fill/merge (no rich options)', () => {
    getFormContext(uuid).generateDocuments({
      documentIds: ['tpl-1'],
      merge: true,
      mergedFileName: 'out'
    });

    expect(client.generateDocuments).toHaveBeenCalledWith({
      documentIds: ['tpl-1'],
      download: undefined,
      merge: true,
      mergedFileName: 'out'
    });
    expect(flow).not.toHaveBeenCalled();
  });

  it('falls back to the client path when no flow is registered (headless)', () => {
    // A separate form uuid: setFormInternalState overlays onto existing state
    // and never clears keys, so the flow registered in beforeEach would survive.
    const headlessUuid = 'formContext-test-headless';
    setFormInternalState(headlessUuid, { fields: {}, client } as any);

    getFormContext(headlessUuid).generateDocuments({
      documentIds: ['tpl-1'],
      envelopeAction: 'sign'
    });

    expect(client.generateDocuments).toHaveBeenCalledTimes(1);
  });

  it('rejects a source object on the headless path instead of polling forever', async () => {
    // The client path interpolates documentIds into its poll URL, so a source
    // object stringifies to "[object Object]" and never matches the cache key
    // the backend wrote — the poll just spun until it timed out.
    const headlessUuid = 'formContext-test-headless-quik';
    setFormInternalState(headlessUuid, { fields: {}, client } as any);

    await expect(
      getFormContext(headlessUuid).generateDocuments({
        documentIds: [{ kind: 'quik' }]
      })
    ).rejects.toThrow(/require a mounted <Form \/>/);
    expect(client.generateDocuments).not.toHaveBeenCalled();
  });
});
