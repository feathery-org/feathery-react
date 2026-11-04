import { getFormContext } from '../formContext';
import { defaultClient, initState } from '../init';
import { setFormInternalState } from '../internalState';
import Field from '../entities/Field';
import { mountDocument, robinHostMounted } from '../../robin/document/mounts';
import { DocumentSession } from '../../robin/document/session';
import {
  ToyHost,
  makeToyPack,
  para,
  toyNative
} from '../../robin/document/tests/toyPack';
import { featheryWindow } from '../browser';
import { AnswersPendingError } from '../offlineRequestHandler';

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

  it('captures DocuSign metadata before saves and review', async () => {
    const customFields = {
      account_submission_id: 'original',
      accounts: { listItems: ['a', 'b'], value: 'a' }
    };
    client.flushCustomFields.mockImplementation(async () => {
      customFields.account_submission_id = 'changed';
      customFields.accounts.listItems.push('c');
    });
    await getFormContext(uuid).generateDocuments({
      documentIds: ['tpl-1'],
      signMethod: 'docusign',
      envelopeAction: 'open_in_editor',
      toolbarActions: ['draft'],
      customFields
    });
    expect(flow.mock.calls[0][0].custom_fields).toEqual({
      account_submission_id: 'original',
      accounts: { listItems: ['a', 'b'], value: 'a' }
    });
    await expect(
      getFormContext(uuid).generateDocuments({
        documentIds: ['tpl-1'],
        customFields
      })
    ).rejects.toThrow('customFields require');
  });

  it.each([undefined, 'sign'] as const)(
    'creates a DocuSign draft with envelopeAction %s and preserves signer roles',
    async (envelopeAction) => {
      flow.mockResolvedValue({
        docusign_envelope_id: 'ds-1',
        status: 'created'
      });
      const result = await getFormContext(uuid).generateDocuments({
        documentIds: ['tpl-1'],
        signMethod: 'docusign',
        draft: true,
        envelopeAction,
        signers: [{ documentId: 'tpl-1', roleId: 'owner', email: 'a@x.com' }]
      });
      expect(flow).toHaveBeenCalledWith(
        expect.objectContaining({
          envelope_action: 'sign',
          sign_method: 'docusign',
          draft: true,
          envelope_signers: [
            {
              document_id: 'tpl-1',
              role_id: 'owner',
              email: 'a@x.com',
              filler: false
            }
          ]
        })
      );
      expect(result).toEqual({
        docusign_envelope_id: 'ds-1',
        status: 'created'
      });
      expect(client.generateDocuments).not.toHaveBeenCalled();
    }
  );

  it.each([
    { signMethod: undefined },
    { signMethod: 'feathery' },
    { envelopeAction: 'fill' },
    { envelopeAction: 'download' },
    { envelopeAction: 'save' },
    { envelopeAction: 'open_in_editor' },
    { download: true },
    { toolbarActions: ['draft'] }
  ])(
    'rejects incompatible draft options before saving or generating: %j',
    async (options) => {
      await expect(
        getFormContext(uuid).generateDocuments({
          documentIds: ['tpl-1'],
          signMethod: 'docusign',
          draft: true,
          ...options
        } as any)
      ).rejects.toThrow('draft requires');
      expect(client.flushCustomFields).not.toHaveBeenCalled();
      expect(flow).not.toHaveBeenCalled();
      expect(client.generateDocuments).not.toHaveBeenCalled();
    }
  );

  it('rejects headless drafts instead of silently dropping the draft option', async () => {
    const headlessUuid = 'formContext-headless-draft';
    setFormInternalState(headlessUuid, { fields: {}, client } as any);
    await expect(
      getFormContext(headlessUuid).generateDocuments({
        documentIds: ['tpl-1'],
        signMethod: 'docusign',
        draft: true
      })
    ).rejects.toThrow('draft requires a mounted <Form />');
    expect(client.flushCustomFields).not.toHaveBeenCalled();
    expect(client.generateDocuments).not.toHaveBeenCalled();
  });

  it('keeps editor generation available when draft is explicitly false', async () => {
    await getFormContext(uuid).generateDocuments({
      documentIds: ['tpl-1'],
      signMethod: 'docusign',
      envelopeAction: 'open_in_editor',
      draft: false
    });
    expect(flow).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope_action: 'open_in_editor',
        draft: false
      })
    );
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

  it('maps closeOnAction to editor_close_on_action and omits it when unset', async () => {
    await getFormContext(uuid).generateDocuments({
      documentIds: ['tpl-1'],
      envelopeAction: 'open_in_editor',
      toolbarActions: ['sign'],
      closeOnAction: false
    });
    await getFormContext(uuid).generateDocuments({
      documentIds: ['tpl-1'],
      envelopeAction: 'open_in_editor',
      toolbarActions: ['sign']
    });

    expect(flow.mock.calls[0][0].editor_close_on_action).toBe(false);
    expect(flow.mock.calls[1][0]).not.toHaveProperty('editor_close_on_action');
  });

  it('captures independent Quik copies before flushing saved fields', async () => {
    const signerIds = { '1own': 'person-first' };
    const source = {
      kind: 'quik' as const,
      forms: [
        { id: 44249, fields: { '1own.FName': 'First' }, signerIds },
        { id: 44249, fields: { '1own.FName': 'Second' } }
      ]
    };
    let finishSave!: () => void;
    client.flushCustomFields.mockReturnValue(
      new Promise<void>((resolve) => {
        finishSave = resolve;
      })
    );
    const signers = [
      {
        documentId: 'tpl-1',
        email: 'first@example.com',
        signerId: 'person-first',
        name: 'First'
      }
    ];
    const pending = getFormContext(uuid).generateDocuments({
      signers,
      signMethod: 'docusign',
      documentIds: [source],
      envelopeAction: 'open_in_editor',
      toolbarActions: ['download', 'draft']
    });
    source.forms[0].fields['1own.FName'] = 'Changed later';
    signerIds['1own'] = 'person-second';
    signers[0].signerId = 'changed';
    signers[0].email = 'changed@example.com';
    finishSave();
    await pending;
    expect(flow.mock.calls[0][0].envelope_signers[0]).toEqual({
      document_id: 'tpl-1',
      email: 'first@example.com',
      signer_id: 'person-first',
      name: 'First',
      filler: false
    });
    expect(flow.mock.calls[0][0].documents[0].forms).toEqual([
      {
        id: 44249,
        fields: { '1own.FName': 'First' },
        signerIds: { '1own': 'person-first' }
      },
      { id: 44249, fields: { '1own.FName': 'Second' } }
    ]);
  });

  it('rejects native identities before saving and treats blank IDs as absent', async () => {
    for (const options of [
      {
        signers: [{ documentId: 'tpl-1', email: 'a@x.com', signerId: 'person' }]
      },
      {
        documentIds: [
          {
            kind: 'quik' as const,
            forms: [{ id: 44249, fields: {}, signerIds: { '1own': 'person' } }]
          }
        ]
      }
    ]) {
      await expect(
        getFormContext(uuid).generateDocuments({
          documentIds: ['tpl-1'],
          ...options
        })
      ).rejects.toThrow(/signer IDs require/);
    }
    expect(client.flushCustomFields).not.toHaveBeenCalled();
    await getFormContext(uuid).generateDocuments({
      documentIds: ['tpl-1'],
      signers: [{ documentId: 'tpl-1', email: 'a@x.com', signerId: '  ' }]
    });
    expect(flow.mock.calls[0][0].envelope_signers[0]).not.toHaveProperty(
      'signer_id'
    );
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

    // A call that signs keeps signing.
    for (const signing of [
      { signMethod: 'docusign' as const },
      { redirect: 'https://done.example.com' }
    ]) {
      flow.mockClear();
      await getFormContext(uuid).generateDocuments({
        documentIds: [{ kind: 'quik' }],
        download: true,
        ...signing
      });
      expect(flow.mock.calls[0][0].envelope_action).toBeUndefined();
    }
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

    // A file upload source must name its field.
    flow.mockClear();
    await expect(
      getFormContext(uuid).generateDocuments({
        documentIds: [{ kind: 'file_upload' } as any]
      })
    ).rejects.toThrow('a file upload source needs its field');
    expect(flow).not.toHaveBeenCalled();

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

  it('snapshots per-copy references before saving and rejects ambiguous merging', async () => {
    const references = ['account-a', 'account-b'];
    client.flushCustomFields.mockImplementation(async () => {
      references[0] = 'changed';
    });
    await getFormContext(uuid).generateDocuments({
      documentIds: [
        { kind: 'template', document_id: 'tpl-1', references },
        {
          kind: 'quik',
          forms: [{ id: 44252, fields: {}, reference: 'account-c' }]
        }
      ],
      signMethod: 'docusign',
      envelopeAction: 'open_in_editor',
      repeatable: true,
      toolbarActions: ['download', 'draft']
    });
    expect(flow.mock.calls[0][0].documents[0].references).toEqual([
      'account-a',
      'account-b'
    ]);
    expect(flow.mock.calls[0][0].documents[1].forms[0].reference).toBe(
      'account-c'
    );
    await expect(
      getFormContext(uuid).generateDocuments({
        documentIds: [{ kind: 'template', document_id: 'tpl-1', references }],
        signMethod: 'docusign',
        merge: true
      })
    ).rejects.toThrow('cannot be merged');
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

describe('requestIdentity', () => {
  const uuid = 'formContext-identity-test';

  beforeEach(() => {
    setFormInternalState(uuid, { fields: {} } as any);
    initState.userId = 'cookie-id';
    initState.linkToken = '';
    initState.collaboratorId = '';
  });

  it('reads the fuser the session resolved, not the id at mount', () => {
    const context = getFormContext(uuid);
    initState.userId = 'server-id';

    expect(context.requestIdentity().fuserKey).toBe('server-id');
  });

  it('names the collaborator a link-bound submission belongs to', () => {
    initState.collaboratorId = 'collab-1';

    expect(getFormContext(uuid).requestIdentity().headers).toEqual({
      'X-Feathery-Collaborator': 'collab-1'
    });
  });
});

describe('subscribe', () => {
  const uuid = 'formContext-subscribe-test';
  let originalUserId: string | undefined;

  beforeEach(() => {
    setFormInternalState(uuid, { fields: {} } as any);
    originalUserId = initState.userId;
    jest
      .spyOn(defaultClient, 'updateUserId')
      .mockResolvedValue(undefined as any);
  });

  afterEach(() => {
    initState.userId = originalUserId;
    jest.restoreAllMocks();
  });

  it('delivers runtime events until the host unsubscribes', async () => {
    const context = getFormContext(uuid);
    const listener = jest.fn();
    const unsubscribe = context.subscribe(listener);

    await context.updateUserId('merged-fuser', true);
    unsubscribe();
    await context.updateUserId('second-fuser', true);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('tells the host when a merge swaps the submission in place', async () => {
    const context = getFormContext(uuid);
    const listener = jest.fn();
    context.subscribe(listener);

    await context.updateUserId('merged-fuser', true);

    expect(listener).toHaveBeenCalledWith({ type: 'identity' });
    expect(context.requestIdentity().fuserKey).toBe('merged-fuser');
  });
});

describe('liveDocument', () => {
  const uuid = 'formContext-live-document';
  const session = () =>
    new DocumentSession({
      pack: makeToyPack(),
      host: new ToyHost(toyNative(para('Motor'))),
      target: { type: 'envelope', id: 'env-1' },
      editorId: 'ed-1'
    });

  it('describes nothing until a document mounts in this form', () => {
    expect(getFormContext(uuid).liveDocument.descriptor()).toBeNull();
  });

  it('describes, dispatches to and finishes the turn of the document mounted in this form', () => {
    const s = session();
    const unmount = mountDocument(uuid, 'container-1', s);
    const doc = getFormContext(uuid).liveDocument;
    const d = doc.descriptor();
    expect(d).toEqual(
      expect.objectContaining({
        protocolVersion: 2,
        editorId: 'ed-1',
        target: { type: 'envelope', id: 'env-1' },
        readOnly: false
      })
    );
    expect(typeof d?.outlineHash).toBe('string');
    const out = doc.write({
      turnId: 'turn-1',
      editorId: 'ed-1',
      target: { type: 'envelope', id: 'env-1' },
      input: { intent: 'Nothing.', scope: { ids: [] }, changes: [] }
    });
    expect(out.status).toBe('ok');
    expect(s.activeTurn).toBe('turn-1');
    doc.finishTurn();
    expect(s.activeTurn).toBeNull();
    expect(getFormContext('another-form').liveDocument.descriptor()).toBeNull();
    unmount();
  });
});

describe('liveDocument.hasDocumentElement', () => {
  it('is true when any step of the form has a document editor, the current step or not', () => {
    const uuid = 'formContext-has-document';
    setFormInternalState(uuid, {
      fields: {},
      currentStep: { key: 'intro', subgrids: [{ id: 'c0', properties: {} }] },
      steps: {
        intro: { key: 'intro', subgrids: [{ id: 'c0', properties: {} }] },
        review: {
          key: 'review',
          subgrids: [
            { id: 'c1', properties: {} },
            { id: 'c2', properties: { document_editor: true } }
          ]
        }
      }
    } as any);
    expect(getFormContext(uuid).liveDocument.hasDocumentElement()).toBe(true);
  });

  it('is false when no step has one, and before the form has loaded its steps', () => {
    const uuid = 'formContext-no-document';
    expect(getFormContext(uuid).liveDocument.hasDocumentElement()).toBe(false);
    setFormInternalState(uuid, {
      fields: {},
      steps: {
        only: { key: 'only', subgrids: [{ id: 'c0', properties: {} }] }
      }
    } as any);
    expect(getFormContext(uuid).liveDocument.hasDocumentElement()).toBe(false);
  });
});

describe('liveDocument.setHostMounted', () => {
  it("marks the form's Robin root mounted and gone, for this form only", () => {
    const uuid = 'formContext-robin-host';
    getFormContext(uuid).liveDocument.setHostMounted(true);
    expect(robinHostMounted(uuid)).toBe(true);
    expect(robinHostMounted('another-form')).toBe(false);
    getFormContext(uuid).liveDocument.setHostMounted(false);
    expect(robinHostMounted(uuid)).toBe(false);
  });
});

describe('feathery.setFormCompletion', () => {
  afterEach(() => jest.restoreAllMocks());

  it('tells the user and rejects when completion is refused while answers are still being saved', async () => {
    const refusal = new AnswersPendingError();
    setFormInternalState('formContext-completion', {
      fields: {},
      client: { registerEvent: jest.fn().mockRejectedValue(refusal) },
      currentStep: { key: 'last' }
    } as any);
    const alert = jest
      .spyOn(featheryWindow(), 'alert')
      .mockImplementation(() => {});

    await expect(
      getFormContext('formContext-completion').setFormCompletion()
    ).rejects.toBe(refusal);

    expect(alert).toHaveBeenCalledWith(refusal.message);
  });
});
