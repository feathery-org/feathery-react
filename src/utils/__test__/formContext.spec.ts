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
      signers: [
        {
          documentId: 'tpl-1',
          roleId: 'role-1',
          email: 'a@x.com',
          filler: true
        },
        { documentId: 'tpl-2', email: 'b@x.com' }
      ],
      envelopeAction: 'open_in_editor',
      toolbarActions: ['sign', 'download'],
      zipName: 'docs',
      saveDocumentFieldKey: 'saved_files',
      redirect: 'https://done.example.com'
    });

    expect(flow).toHaveBeenCalledTimes(1);
    const [action] = flow.mock.calls[0];
    expect(action).toMatchObject({
      type: 'open_fuser_envelopes',
      documents: ['tpl-1'],
      envelope_action: 'open_in_editor',
      editor_toolbar_actions: ['sign', 'download'],
      envelope_zip_name: 'docs',
      save_document_field_key: 'saved_files',
      redirect: 'https://done.example.com',
      run_async: true
    });
    // role_id is left off entirely for a document-wide signer, not nulled.
    expect(action.envelope_signers).toEqual([
      {
        document_id: 'tpl-1',
        role_id: 'role-1',
        email: 'a@x.com',
        filler: true
      },
      { document_id: 'tpl-2', email: 'b@x.com', filler: false }
    ]);
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
      mergedFileName: 'out',
      download: true,
      zipName: 'bundle'
    });

    expect(client.generateDocuments).toHaveBeenCalledWith({
      documentIds: ['tpl-1'],
      download: true,
      merge: true,
      mergedFileName: 'out',
      zipName: 'bundle'
    });
    expect(flow).not.toHaveBeenCalled();
  });

  it('routes per-role signers through the flow even with no other options', () => {
    getFormContext(uuid).generateDocuments({
      documentIds: ['tpl-1'],
      signers: [{ documentId: 'tpl-1', roleId: 'role-1', email: 'a@x.com' }]
    });

    expect(flow).toHaveBeenCalledTimes(1);
    expect(client.generateDocuments).not.toHaveBeenCalled();
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

  it('rejects options the headless path cannot honor instead of dropping them', async () => {
    // A source object stringifies to "[object Object]" in the client path's
    // poll URL and never matches the cache key the backend wrote, so the poll
    // just spun until it timed out. Per-role signers have nowhere to go there
    // at all — generating an envelope nobody is asked to sign.
    const headlessUuid = 'formContext-test-headless-quik';
    setFormInternalState(headlessUuid, { fields: {}, client } as any);
    const headless = getFormContext(headlessUuid);

    await expect(
      headless.generateDocuments({ documentIds: [{ kind: 'quik' }] })
    ).rejects.toThrow(/require a mounted <Form \/>/);
    await expect(
      headless.generateDocuments({
        documentIds: ['tpl-1'],
        signers: [{ documentId: 'tpl-1', email: 'a@x.com' }]
      })
    ).rejects.toThrow(/per-role signers require a mounted <Form \/>/);
    expect(client.generateDocuments).not.toHaveBeenCalled();
  });
});

describe('feathery.runComputerAgent return shape', () => {
  const uuid = 'formContext-computer-agent';
  const payload = { run_id: 'run_1', run_url: 'https://app/runs/run_1' };
  let runComputerAgent: jest.Mock;

  beforeEach(() => {
    runComputerAgent = jest.fn().mockResolvedValue({ ok: true, payload });
    setFormInternalState(uuid, { fields: {}, runComputerAgent } as any);
  });

  it('returns the poll error shape when the trigger fails', async () => {
    runComputerAgent.mockResolvedValue({ ok: false, error: 'nope' });
    await expect(
      getFormContext(uuid).runComputerAgent('agent_1')
    ).resolves.toEqual({ status: 'error', message: 'nope' });
  });
});
