import { getFormContext } from '../formContext';
import { setFormInternalState } from '../internalState';
import Field from '../entities/Field';

describe('feathery.generateDocuments logic-rule method routing', () => {
  const uuid = 'formContext-test';
  let client: any;
  let flow: jest.Mock;

  beforeEach(() => {
    client = {
      generateDocuments: jest.fn().mockResolvedValue({ files: [] }),
      flushCustomFields: jest.fn().mockResolvedValue(undefined)
    };
    flow = jest.fn().mockResolvedValue({ files: [] });
    setFormInternalState(uuid, {
      fields: {},
      client,
      generateEnvelopeFlow: flow
    } as any);
  });

  it('routes the editor + signer options through the form flow with a built action', async () => {
    await getFormContext(uuid).generateDocuments({
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
      redirect: 'https://done.example.com',
      emailSubject: 'Please sign this',
      emailBlurb: 'Two signatures needed.'
    });

    expect(client.flushCustomFields).toHaveBeenCalledTimes(1);
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
      email_subject: 'Please sign this',
      email_blurb: 'Two signatures needed.',
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

  it('captures independent Quik copies before flushing saved fields', async () => {
    const source = {
      kind: 'quik' as const,
      forms: [
        { id: 44249, fields: { '1own.FName': 'First' } },
        { id: 44249, fields: { '1own.FName': 'Second' } }
      ]
    };
    let finishSave!: () => void;
    client.flushCustomFields.mockReturnValue(
      new Promise<void>((resolve) => {
        finishSave = resolve;
      })
    );
    const pending = getFormContext(uuid).generateDocuments({
      documentIds: [source],
      envelopeAction: 'open_in_editor',
      toolbarActions: ['download', 'draft']
    });
    source.forms[0].fields['1own.FName'] = 'Changed later';
    finishSave();
    await pending;
    expect(flow.mock.calls[0][0].documents[0].forms).toEqual([
      { id: 44249, fields: { '1own.FName': 'First' } },
      { id: 44249, fields: { '1own.FName': 'Second' } }
    ]);
  });

  it('routes a bare sign envelope action through the flow', async () => {
    await getFormContext(uuid).generateDocuments({
      documentIds: ['tpl-1'],
      envelopeAction: 'sign'
    });

    expect(client.flushCustomFields).toHaveBeenCalledTimes(1);
    expect(flow).toHaveBeenCalledTimes(1);
    expect(flow.mock.calls[0][0]).toMatchObject({ envelope_action: 'sign' });
    expect(client.generateDocuments).not.toHaveBeenCalled();
  });

  it('keeps zero-based copy indices and omits them for all-copy signers', async () => {
    await getFormContext(uuid).generateDocuments({
      documentIds: ['tpl-1'],
      repeatable: true,
      signMethod: 'docusign',
      envelopeAction: 'open_in_editor',
      signers: [
        {
          documentId: 'tpl-1',
          roleId: 'client',
          repeatIndex: 0,
          email: 'john@example.com',
          name: 'John Smith',
          phone: '+15551234567'
        },
        {
          documentId: 'tpl-1',
          roleId: 'client',
          repeatIndex: 1,
          email: 'mary@example.com',
          filler: true
        },
        { documentId: 'tpl-1', roleId: 'advisor', email: 'advisor@example.com' }
      ]
    });
    expect(flow.mock.calls[0][0].envelope_signers).toEqual([
      {
        document_id: 'tpl-1',
        role_id: 'client',
        repeat_index: 0,
        email: 'john@example.com',
        name: 'John Smith',
        phone: '+15551234567',
        filler: false
      },
      {
        document_id: 'tpl-1',
        role_id: 'client',
        repeat_index: 1,
        email: 'mary@example.com',
        filler: true
      },
      {
        document_id: 'tpl-1',
        role_id: 'advisor',
        email: 'advisor@example.com',
        filler: false
      }
    ]);
  });

  it('routes a source-object-only document list through the flow even with no other options', async () => {
    for (const source of [
      { kind: 'quik' as const },
      { kind: 'file_upload' as const, field_id: 'f1' }
    ]) {
      flow.mockClear();
      await getFormContext(uuid).generateDocuments({ documentIds: [source] });

      expect(flow).toHaveBeenCalledTimes(1);
      expect(flow.mock.calls[0][0]).toMatchObject({ documents: [source] });
    }
    expect(client.generateDocuments).not.toHaveBeenCalled();
  });

  it('treats download as the envelope action for source objects', async () => {
    await getFormContext(uuid).generateDocuments({
      documentIds: [{ kind: 'quik' }],
      download: true
    });
    expect(flow.mock.calls[0][0].envelope_action).toBe('download');

    // A file upload source must name its field.
    flow.mockClear();
    await expect(
      getFormContext(uuid).generateDocuments({
        documentIds: [{ kind: 'file_upload' } as any]
      })
    ).rejects.toThrow('a file upload source needs its field');
    expect(flow).not.toHaveBeenCalled();
  });

  it('resolves a file upload field key to its field id', async () => {
    setFormInternalState(uuid, {
      fields: {},
      client,
      generateEnvelopeFlow: flow,
      steps: {
        s1: {
          servar_fields: [
            { servar: { id: 'id-name', key: 'Name', type: 'text_field' } },
            { servar: { id: 'id-up', key: 'IdUpload', type: 'file_upload' } }
          ]
        }
      }
    } as any);

    // By key, or by passing the field itself as a logic rule sees it.
    for (const source of [
      { kind: 'file_upload' as const, field_key: 'IdUpload' },
      new Field('IdUpload', uuid)
    ]) {
      flow.mockClear();
      await getFormContext(uuid).generateDocuments({
        documentIds: ['tpl-1', source]
      });
      expect(flow.mock.calls[0][0].documents).toEqual([
        'tpl-1',
        { kind: 'file_upload', field_id: 'id-up' }
      ]);
    }

    // Unknown keys and non-upload fields fail before anything is generated.
    flow.mockClear();
    await expect(
      getFormContext(uuid).generateDocuments({
        documentIds: [
          { kind: 'file_upload', field_key: 'Missing' },
          { kind: 'file_upload', field_key: 'Name' }
        ]
      })
    ).rejects.toThrow(
      'generateDocuments: no file upload field with key Missing, Name'
    );
    expect(flow).not.toHaveBeenCalled();
  });

  it('keeps the simple client path for plain template fill/merge (no rich options)', async () => {
    await getFormContext(uuid).generateDocuments({
      documentIds: ['tpl-1'],
      merge: true,
      mergedFileName: 'out',
      download: true,
      zipName: 'bundle'
    });

    expect(client.flushCustomFields).toHaveBeenCalledTimes(1);
    expect(client.generateDocuments).toHaveBeenCalledWith({
      documentIds: ['tpl-1'],
      download: true,
      merge: true,
      mergedFileName: 'out',
      zipName: 'bundle'
    });
    expect(flow).not.toHaveBeenCalled();
  });

  it('routes per-role signers through the flow even with no other options', async () => {
    await getFormContext(uuid).generateDocuments({
      documentIds: ['tpl-1'],
      signers: [{ documentId: 'tpl-1', roleId: 'role-1', email: 'a@x.com' }]
    });

    expect(flow).toHaveBeenCalledTimes(1);
    expect(client.generateDocuments).not.toHaveBeenCalled();
  });

  it('falls back to the client path when no flow is registered (headless)', async () => {
    // A separate form uuid: setFormInternalState overlays onto existing state
    // and never clears keys, so the flow registered in beforeEach would survive.
    const headlessUuid = 'formContext-test-headless';
    setFormInternalState(headlessUuid, { fields: {}, client } as any);

    await getFormContext(headlessUuid).generateDocuments({
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
