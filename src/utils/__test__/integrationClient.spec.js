import IntegrationClient from '../featheryClient/integrationClient';
import { fieldValues, initInfo } from '../init';
import {
  getApiUrl,
  getStaticUrl,
  setEnvironment
} from '@feathery/client-utils';

// Mock the API_URL and STATIC_URL to avoid circular dependency issues
// since ../featheryClient/integrationClient imports them from ../featheryClient
// and jest tries to load featheryClient and extend IntegrationClient before
// IntegrationClient is defined
jest.mock('../featheryClient', () => ({
  API_URL: '',
  STATIC_URL: ''
}));

setEnvironment('production');
const API_URL = getApiUrl();
const STATIC_URL = getStaticUrl();

jest.mock('../init', () => ({
  initInfo: jest.fn(),
  initFormsPromise: Promise.resolve(),
  initState: { formSessions: {} },
  fieldValues: {}
}));

describe('IntegrationClient', () => {
  // Read a request off the fetch mock. Assert bodies against the parsed object
  // rather than a serialized string, so key order and unrelated added fields
  // don't matter.
  const requestUrl = (call = 0) => global.fetch.mock.calls[call][0];
  const requestMethod = (call = 0) => global.fetch.mock.calls[call][1].method;
  const requestBody = (call = 0) =>
    JSON.parse(global.fetch.mock.calls[call][1].body);

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    initInfo.mockReturnValue({
      sdkKey: 'test_sdk_key',
      userId: 'test_user_id'
    });
  });

  afterEach(() => {
    if (global.fetch && global.fetch.mockClear) {
      global.fetch.mockClear();
    }
  });

  describe('customRolloutAction', () => {
    it('calls rollout endpoint with single automation ID', async () => {
      // Arrange
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      const automationId = 'automation_1';
      const options = { waitForCompletion: true, multiple: false };

      Object.assign(fieldValues, { field1: 'value1', field2: 'value2' });

      global.fetch.mockResolvedValue({
        status: 200,
        json: jest.fn().mockResolvedValue({ result: 'success' })
      });

      // Act
      const result = await integrationClient.customRolloutAction(
        automationId,
        options
      );

      // Assert
      expect(requestUrl()).toBe(`${API_URL}rollout/custom-trigger/`);
      expect(requestMethod()).toBe('POST');
      // The one place the forwarded SDK key is pinned.
      expect(global.fetch.mock.calls[0][1].headers).toEqual(
        expect.objectContaining({ Authorization: 'Token test_sdk_key' })
      );
      expect(requestBody()).toEqual(
        expect.objectContaining({
          automation_ids: [automationId],
          sync: true,
          multiple: false,
          payload: fieldValues,
          form_key: formKey,
          fuser_key: 'test_user_id'
        })
      );
      expect(result).toEqual({ ok: true, payload: { result: 'success' } });
    });

    it('calls rollout endpoint with array of automation IDs', async () => {
      // Arrange
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      const automationIds = ['automation_1', 'automation_2', 'automation_3'];
      const options = { waitForCompletion: false, multiple: true };

      Object.assign(fieldValues, { field1: 'value1' });

      global.fetch.mockResolvedValue({
        status: 200,
        json: jest.fn().mockResolvedValue({ results: ['result1', 'result2'] })
      });

      // Act
      const result = await integrationClient.customRolloutAction(
        automationIds,
        options
      );

      // Assert
      expect(requestUrl()).toBe(`${API_URL}rollout/custom-trigger/`);
      expect(requestBody()).toEqual(
        expect.objectContaining({
          automation_ids: automationIds,
          sync: false,
          multiple: true,
          payload: fieldValues,
          form_key: formKey,
          fuser_key: 'test_user_id'
        })
      );
      expect(result).toEqual({
        ok: true,
        payload: { results: ['result1', 'result2'] }
      });
    });

    it('handles error response from rollout endpoint', async () => {
      // Arrange
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      const automationId = 'automation_1';
      const options = { waitForCompletion: true };

      global.fetch.mockResolvedValue({
        status: 400,
        text: jest.fn().mockResolvedValue('Automation failed')
      });

      // Act
      const result = await integrationClient.customRolloutAction(
        automationId,
        options
      );

      // Assert
      expect(result).toEqual({ ok: false, error: 'Automation failed' });
    });

    it('waits for submit queue before calling rollout endpoint', async () => {
      // Arrange
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      const automationId = 'automation_1';
      const options = { waitForCompletion: true };

      let queueResolved = false;
      integrationClient.submitQueue = new Promise((resolve) => {
        setTimeout(() => {
          queueResolved = true;
          resolve();
        }, 50);
      });

      global.fetch.mockResolvedValue({
        status: 200,
        json: jest.fn().mockResolvedValue({})
      });

      // Act
      await integrationClient.customRolloutAction(automationId, options);

      // Assert
      expect(queueResolved).toBe(true);
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('sendEmail', () => {
    it('calls email endpoint with correct parameters', async () => {
      // Arrange
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      const templateId = 'email_template_123';

      global.fetch.mockResolvedValue({
        status: 200
      });

      // Act
      await integrationClient.sendEmail(templateId);

      // Assert
      expect(requestUrl()).toBe(`${API_URL}email/logic-rule/`);
      expect(requestMethod()).toBe('POST');
      expect(requestBody()).toEqual(
        expect.objectContaining({
          template_id: templateId,
          form_key: formKey,
          fuser_key: 'test_user_id',
          skip_pfd: false
        })
      );
    });

    it('handles sendEmail when userId is undefined', async () => {
      // Arrange
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      const templateId = 'email_template_123';

      initInfo.mockReturnValue({
        sdkKey: 'test_sdk_key',
        userId: 'user_id'
      });

      global.fetch.mockResolvedValue({
        status: 200
      });

      // Act
      await integrationClient.sendEmail(templateId);

      // Assert
      expect(requestUrl()).toBe(`${API_URL}email/logic-rule/`);
      expect(requestBody()).toEqual(
        expect.objectContaining({
          template_id: templateId,
          form_key: formKey,
          fuser_key: 'user_id',
          skip_pfd: false
        })
      );
    });
  });

  describe('getQuikForms', () => {
    it('calls quik dealer endpoint with correct parameters', async () => {
      // Arrange
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      const dealerNames = ['dealer1', 'dealer2', 'dealer3'];

      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ forms: ['form1', 'form2'] })
      });

      // Act
      const result = await integrationClient.getQuikForms({ dealerNames });

      // Assert
      const dealerStr = encodeURIComponent(JSON.stringify(dealerNames));
      expect(global.fetch).toHaveBeenCalledWith(
        `${API_URL}quik/meta/dealer/?form_key=${formKey}&dealer=${dealerStr}`,
        {
          headers: {
            Authorization: 'Token test_sdk_key'
          },
          cache: 'no-store',
          keepalive: false
        }
      );
      expect(result).toEqual({ forms: ['form1', 'form2'] });
    });
  });

  describe('getQuikFormRoles', () => {
    it('calls quik form roles endpoint with correct parameters', async () => {
      // Arrange
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      const formIds = [123, 456, 789];

      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ roles: ['signer', 'reviewer'] })
      });

      // Act
      const result = await integrationClient.getQuikFormRoles({ formIds });

      // Assert
      expect(global.fetch).toHaveBeenCalledWith(
        `${API_URL}quik/meta/form-roles/?form_key=${formKey}&quik_form_ids=${formIds.join(
          ','
        )}`,
        {
          headers: {
            Authorization: 'Token test_sdk_key'
          },
          cache: 'no-store',
          keepalive: false
        }
      );
      expect(result).toEqual({ roles: ['signer', 'reviewer'] });
    });
  });

  describe('getQuikAccountForms', () => {
    it('calls quik form account forms endpoint with correct parameters', async () => {
      // Arrange
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      const custodian = 'custodian1';
      const accountType = 'account_type1';
      const isTransition = true;

      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ forms: ['form1', 'form2'] })
      });

      // Act
      const result = await integrationClient.getQuikAccountForms({
        custodian,
        accountType,
        isTransition
      });

      // Assert
      expect(global.fetch).toHaveBeenCalledWith(
        `${API_URL}quik/meta/account-forms/?form_key=${formKey}&custodian=${custodian}&account_type=${accountType}&is_transition=${isTransition}`,
        {
          headers: {
            Authorization: 'Token test_sdk_key'
          },
          cache: 'no-store',
          keepalive: false
        }
      );
      expect(result).toEqual({ forms: ['form1', 'form2'] });
    });
  });

  describe('generateQuikEnvelopes', () => {
    const createQuikClient = (formKey) => {
      const integrationClient = new IntegrationClient(formKey);
      integrationClient.QUIK_CHECK_INTERVAL = 1;
      integrationClient.QUIK_MAX_TIME = 10;
      return integrationClient;
    };

    beforeEach(() => {
      Object.keys(fieldValues).forEach((key) => delete fieldValues[key]);

      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ status: 'running' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ status: 'complete' })
        });
    });

    it('uses configured attachments without a dynamic field', async () => {
      const formKey = 'test_form_key';
      const integrationClient = createQuikClient(formKey);
      const staticAttachments = [{ id: 'static-id', position: 'before' }];
      Object.assign(fieldValues, {
        quik_attachment_ids: [{ id: 'dynamic-id', position: 'after' }]
      });

      const resultPromise = integrationClient.generateQuikEnvelopes({
        form_fill_type: 'pdf',
        attachments: staticAttachments
      });

      expect(global.fetch).toHaveBeenCalledWith(
        `${STATIC_URL}quik/document/`,
        expect.objectContaining({
          body: expect.any(String)
        })
      );
      expect(requestBody()).toEqual(
        expect.objectContaining({
          attachments: staticAttachments
        })
      );

      await resultPromise;
    });

    it('ignores action-level dynamic attachment fields without a configured row', async () => {
      const formKey = 'test_form_key';
      const integrationClient = createQuikClient(formKey);
      Object.assign(fieldValues, {
        quik_attachment_ids: ['document-id', 'envelope-id']
      });

      const resultPromise = integrationClient.generateQuikEnvelopes({
        form_fill_type: 'pdf',
        quik_attachments_field_key: 'quik_attachment_ids',
        quik_attachments_position: 'after',
        attachments: [{ id: 'static-id', position: 'before' }]
      });

      expect(requestBody()).toEqual(
        expect.objectContaining({
          attachments: [{ id: 'static-id', position: 'before' }]
        })
      );

      await resultPromise;
    });

    it('expands dynamic attachment placeholders in configured order', async () => {
      const formKey = 'test_form_key';
      const integrationClient = createQuikClient(formKey);
      Object.assign(fieldValues, {
        quik_attachment_ids: ['document-id', 'envelope-id']
      });

      const resultPromise = integrationClient.generateQuikEnvelopes({
        form_fill_type: 'pdf',
        attachments: [
          { id: 'before-static-id', position: 'before' },
          {
            id: '__quik_dynamic_attachments__',
            position: 'before',
            field_key: 'quik_attachment_ids'
          },
          { id: 'after-dynamic-static-id', position: 'before' }
        ]
      });

      expect(requestBody()).toEqual(
        expect.objectContaining({
          attachments: [
            { id: 'before-static-id', position: 'before' },
            { id: 'document-id', position: 'before' },
            { id: 'envelope-id', position: 'before' },
            { id: 'after-dynamic-static-id', position: 'before' }
          ]
        })
      );

      await resultPromise;
    });

    it('expands multiple dynamic attachment fields in configured order', async () => {
      const formKey = 'test_form_key';
      const integrationClient = createQuikClient(formKey);
      Object.assign(fieldValues, {
        first_quik_attachment_ids: ['first-document-id', 'first-envelope-id'],
        second_quik_attachment_ids: ['second-document-id']
      });

      const resultPromise = integrationClient.generateQuikEnvelopes({
        form_fill_type: 'pdf',
        attachments: [
          { id: 'before-static-id', position: 'before' },
          {
            id: '__quik_dynamic_attachments__:first-field-id',
            position: 'before',
            field_key: 'first_quik_attachment_ids'
          },
          { id: 'middle-static-id', position: 'before' },
          {
            id: '__quik_dynamic_attachments__:second-field-id',
            position: 'before',
            field_key: 'second_quik_attachment_ids'
          }
        ]
      });

      expect(requestBody()).toEqual(
        expect.objectContaining({
          attachments: [
            { id: 'before-static-id', position: 'before' },
            { id: 'first-document-id', position: 'before' },
            { id: 'first-envelope-id', position: 'before' },
            { id: 'middle-static-id', position: 'before' },
            { id: 'second-document-id', position: 'before' }
          ]
        })
      );

      await resultPromise;
    });

    it('ignores dynamic attachment objects', async () => {
      const formKey = 'test_form_key';
      const integrationClient = createQuikClient(formKey);
      Object.assign(fieldValues, {
        quik_attachment_ids: [{ id: 'document-id', position: 'before' }]
      });

      const resultPromise = integrationClient.generateQuikEnvelopes({
        form_fill_type: 'pdf',
        attachments: [
          { id: 'static-id', position: 'before' },
          {
            id: '__quik_dynamic_attachments__',
            position: 'before',
            field_key: 'quik_attachment_ids'
          }
        ]
      });

      expect(requestBody()).toEqual(
        expect.objectContaining({
          attachments: [{ id: 'static-id', position: 'before' }]
        })
      );

      await resultPromise;
    });
  });

  describe('generateEnvelopes', () => {
    it('calls document generate endpoint with correct parameters', async () => {
      // Arrange
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      const action = {
        envelope_signer_field_key: 'signer_field',
        documents: ['doc1', 'doc2'],
        repeatable: true,
        run_async: false,
        envelope_action: 'download'
      };

      Object.assign(fieldValues, { signer_field: 'test@example.com' });

      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ files: ['file1.pdf', 'file2.pdf'] })
      });

      // Act
      const result = await integrationClient.generateEnvelopes(action);

      // Assert
      expect(requestUrl()).toBe(`${API_URL}document/form/generate/`);
      expect(requestMethod()).toBe('POST');
      expect(requestBody()).toEqual(
        expect.objectContaining({
          form_key: formKey,
          fuser_key: 'test_user_id',
          documents: action.documents,
          run_async: false,
          // Anything other than "sign" fills instead.
          envelope_action: 'fill',
          // A document with no role falls back to the shared signer field,
          // and role_id is left off rather than nulled. That email is the
          // filler's own, so they sign it themselves.
          signers: [
            { document_id: 'doc1', email: 'test@example.com', filler: true },
            { document_id: 'doc2', email: 'test@example.com', filler: true }
          ],
          repeatable: true
        })
      );
      expect(result).toEqual({ files: ['file1.pdf', 'file2.pdf'] });
    });

    it('does not treat a plain action as an editor action (regression)', async () => {
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      const action = {
        documents: ['doc1'],
        run_async: false
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ files: ['file1.pdf'] })
      });

      await integrationClient.generateEnvelopes(action);

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.envelope_action).not.toBe('open_in_editor');
    });

    it('sends the open_in_editor action to the generate endpoint directly and returns the sync payload', async () => {
      // Arrange: client-utils' generateFormDocuments can't forward unknown
      // params, so the editor action must be sent via a direct call.
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      const action = {
        envelope_signer_field_key: 'signer_field',
        documents: ['doc1', 'doc2'],
        repeatable: true,
        run_async: false,
        envelope_action: 'open_in_editor'
      };

      Object.assign(fieldValues, { signer_field: 'test@example.com' });

      const documentsPayload = {
        documents: [
          { envelope_id: 'env-1', pdf_url: 'https://x/1.pdf', type: 'form' }
        ],
        expires_at: '2026-07-15T00:00:00Z'
      };
      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(documentsPayload)
      });

      // Act
      const result = await integrationClient.generateEnvelopes(action);

      // Assert
      expect(global.fetch).toHaveBeenCalledWith(
        `${API_URL}document/form/generate/`,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Token test_sdk_key'
          },
          method: 'POST',
          body: JSON.stringify({
            form_key: formKey,
            fuser_key: 'test_user_id',
            documents: action.documents,
            run_async: false,
            envelope_action: 'open_in_editor',
            merge_docs: false,
            editor_toolbar_actions: [],
            signers: [
              { document_id: 'doc1', email: 'test@example.com', filler: true },
              { document_id: 'doc2', email: 'test@example.com', filler: true }
            ],
            repeatable: true
          }),
          cache: 'no-store',
          keepalive: true
        }
      );
      expect(result).toEqual(documentsPayload);
    });

    it('polls until complete when open_in_editor runs async', async () => {
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      integrationClient.ENVELOPE_CHECK_INTERVAL = 1;
      integrationClient.ENVELOPE_MAX_TIME = 20;
      const action = {
        documents: ['doc1'],
        run_async: true,
        envelope_action: 'open_in_editor'
      };

      const completePayload = {
        documents: [{ envelope_id: 'env-1', pdf_url: 'https://x/1.pdf' }],
        expires_at: '2026-07-15T00:00:00Z',
        status: 'complete'
      };

      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ status: 'running' })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue(completePayload)
        });

      const result = await integrationClient.generateEnvelopes(action);

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch.mock.calls[1][0]).toBe(
        `${API_URL}document/form/generate/poll/?fid=test_user_id&dids=${action.documents}`
      );
      expect(result).toEqual(completePayload);
    });

    it('polls with canonical cache keys for a mixed template/quik array', async () => {
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      integrationClient.ENVELOPE_CHECK_INTERVAL = 1;
      integrationClient.ENVELOPE_MAX_TIME = 20;
      const action = {
        documents: ['doc1', { kind: 'quik' }, 'doc2'],
        run_async: true,
        envelope_action: 'open_in_editor'
      };

      const completePayload = {
        documents: [{ envelope_id: 'env-1', pdf_url: 'https://x/1.pdf' }],
        status: 'complete'
      };

      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ status: 'running' })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue(completePayload)
        });

      await integrationClient.generateEnvelopes(action);

      // Must mirror the backend document_cache_keys: quik -> "quik", not
      // "[object Object]".
      expect(global.fetch.mock.calls[1][0]).toBe(
        `${API_URL}document/form/generate/poll/?fid=test_user_id&dids=doc1,quik,doc2`
      );
    });

    it('surfaces an error response from the review generate endpoint', async () => {
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      const action = {
        documents: ['doc1'],
        run_async: false,
        envelope_action: 'open_in_editor'
      };

      global.fetch.mockResolvedValue({
        ok: false,
        json: jest.fn().mockResolvedValue({ error: 'Envelope limit exceeded' })
      });

      const result = await integrationClient.generateEnvelopes(action);

      expect(result).toEqual({
        status: 'error',
        message: 'Envelope limit exceeded'
      });
    });

    it('sends sign_method to the generate endpoint directly for a plain docusign sign', async () => {
      // client-utils' generateFormDocuments can't forward sign_method any
      // more than it can the editor action, so a docusign sign action must
      // also route through the direct call even outside the review flow.
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      const action = {
        documents: ['doc1'],
        run_async: false,
        sign_method: 'docusign'
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: jest
          .fn()
          .mockResolvedValue({ docusign_envelope_id: 'ds-1', status: 'sent' })
      });

      const result = await integrationClient.generateEnvelopes(action);

      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe(`${API_URL}document/form/generate/`);
      const body = JSON.parse(options.body);
      expect(body.sign_method).toBe('docusign');
      expect(body.envelope_action).toBe('sign');
      expect(body.editor_toolbar_actions).toBeUndefined();
      expect(result).toEqual({
        docusign_envelope_id: 'ds-1',
        status: 'sent'
      });
    });

    it('ignores the form signer field for a docusign sign, keeping the role mappings', async () => {
      // The field names whoever signs inline, in the form. Nobody does on
      // DocuSign - it mails every recipient itself, from the role mappings -
      // so routing to that field on top of the roles would send the documents
      // to someone the designer never listed as a signer.
      const integrationClient = new IntegrationClient('test_form_key');
      Object.assign(fieldValues, {
        signer_field: 'filler@example.com',
        buyer_field: 'buyer@example.com'
      });
      const base = {
        documents: ['doc1', 'doc2'],
        run_async: false,
        sign_method: 'docusign',
        envelope_signer_field_key: 'signer_field',
        envelope_signers: [
          { document_id: 'doc1', role_id: 'role-1', field_key: 'buyer_field' }
        ]
      };
      // Both shapes reach DocuSign: the direct sign, and the editor whose
      // envelope action carries no outcome of its own.
      const actions = [
        base,
        {
          ...base,
          envelope_action: 'open_in_editor',
          editor_toolbar_actions: ['draft']
        }
      ];

      for (const action of actions) {
        global.fetch.mockResolvedValue({
          ok: true,
          json: jest
            .fn()
            .mockResolvedValue({ docusign_envelope_id: 'ds-1', status: 'sent' })
        });

        await integrationClient.generateEnvelopes(action);

        const calls = global.fetch.mock.calls;
        const body = JSON.parse(calls[calls.length - 1][1].body);
        // Only the mapped role, and doc2 - which has no mapping - picks up
        // nobody rather than falling back to the form signer field.
        expect(body.signers).toEqual([
          {
            document_id: 'doc1',
            role_id: 'role-1',
            email: 'buyer@example.com',
            filler: false
          }
        ]);
      }

      // A caller naming an email outright still routes to them.
      global.fetch.mockResolvedValue({
        ok: true,
        json: jest
          .fn()
          .mockResolvedValue({ docusign_envelope_id: 'ds-2', status: 'sent' })
      });
      await integrationClient.generateEnvelopes(base, 'override@example.com');
      const calls = global.fetch.mock.calls;
      const body = JSON.parse(calls[calls.length - 1][1].body);
      expect(body.signers).toContainEqual({
        document_id: 'doc2',
        email: 'override@example.com',
        filler: true
      });

      delete fieldValues.signer_field;
      delete fieldValues.buyer_field;
    });

    it('sends sign_method alongside the editor action when both are present', async () => {
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      const action = {
        documents: ['doc1'],
        run_async: false,
        envelope_action: 'open_in_editor',
        editor_toolbar_actions: ['sign'],
        sign_method: 'docusign'
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          documents: [{ envelope_id: 'env-1', pdf_url: 'https://x/1.pdf' }],
          expires_at: '2026-07-15T00:00:00Z'
        })
      });

      await integrationClient.generateEnvelopes(action);

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.sign_method).toBe('docusign');
      expect(body.envelope_action).toBe('open_in_editor');
      expect(body.editor_toolbar_actions).toEqual(['sign']);
    });

    it('does not send sign_method when the action omits it (regression)', async () => {
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      const action = {
        documents: ['doc1'],
        run_async: false,
        envelope_action: 'open_in_editor'
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          documents: [{ envelope_id: 'env-1', pdf_url: 'https://x/1.pdf' }],
          expires_at: '2026-07-15T00:00:00Z'
        })
      });

      await integrationClient.generateEnvelopes(action);

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.sign_method).toBeUndefined();
    });

    it('routes a plain action with a quik document item through the direct call so the poll keys match', async () => {
      // client-utils' generateFormDocuments interpolates the raw documents
      // array into its poll URL, so {kind:'quik'} would become
      // "[object Object]" and never match the backend's cache keys — the
      // documents generate and then the first poll 400s. No review, no
      // docusign: this is the plain Feathery-sign / download / save path.
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      const action = {
        documents: ['doc1', { kind: 'quik' }],
        run_async: false,
        envelope_action: 'download'
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ files: ['merged.pdf'] })
      });

      await integrationClient.generateEnvelopes(action);

      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe(`${API_URL}document/form/generate/`);
      expect(JSON.parse(options.body).documents).toEqual([
        'doc1',
        { kind: 'quik' }
      ]);
    });

    it('routes a non-docusign sign_method through the library path, not the direct call (regression)', async () => {
      // Only sign_method: 'docusign' needs the direct call to carry the flag
      // through; other sign_method values (e.g. Feathery's own hosted eSign)
      // must still go through @feathery/client-utils' generateFormDocuments,
      // same as when sign_method is absent entirely.
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      const action = {
        envelope_signer_field_key: 'signer_field',
        documents: ['doc1', 'doc2'],
        repeatable: true,
        run_async: false,
        envelope_action: 'download',
        sign_method: 'feathery'
      };

      Object.assign(fieldValues, { signer_field: 'test@example.com' });

      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ files: ['file1.pdf', 'file2.pdf'] })
      });

      const result = await integrationClient.generateEnvelopes(action);

      expect(global.fetch).toHaveBeenCalledWith(
        `${API_URL}document/form/generate/`,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Token test_sdk_key'
          },
          method: 'POST',
          body: JSON.stringify({
            form_key: formKey,
            fuser_key: 'test_user_id',
            documents: action.documents,
            run_async: false,
            envelope_action: 'fill',
            merge_docs: false,
            signers: [
              { document_id: 'doc1', email: 'test@example.com', filler: true },
              { document_id: 'doc2', email: 'test@example.com', filler: true }
            ],
            repeatable: true
          }),
          cache: 'no-store',
          keepalive: true
        }
      );
      expect(result).toEqual({ files: ['file1.pdf', 'file2.pdf'] });
    });

    it('sends a mixed template/quik documents array verbatim on the direct path', async () => {
      // The unified Generate Documents action carries a polymorphic ordered
      // `documents` array: template UUID strings plus at most one
      // `{kind:'quik'}` dict. The direct (review/docusign) path must forward it
      // to the generate endpoint exactly as configured, without reshaping.
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      const mixedDocuments = ['uuid-1', { kind: 'quik' }, 'uuid-2'];
      const action = {
        documents: mixedDocuments,
        run_async: false,
        envelope_action: 'open_in_editor'
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          documents: [{ envelope_id: 'env-1', pdf_url: 'https://x/1.pdf' }],
          expires_at: '2026-07-15T00:00:00Z'
        })
      });

      await integrationClient.generateEnvelopes(action);

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.documents).toEqual(mixedDocuments);
    });

    it('sends a mixed template/quik documents array verbatim on the library path', async () => {
      // The library path (@feathery/client-utils generateFormDocuments) is used
      // when neither the review step nor a docusign sign_method is requested; it
      // must forward the same polymorphic array unchanged.
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      const mixedDocuments = ['uuid-1', { kind: 'quik' }, 'uuid-2'];
      const action = {
        documents: mixedDocuments,
        run_async: false
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ files: ['file1.pdf'] })
      });

      await integrationClient.generateEnvelopes(action);

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.documents).toEqual(mixedDocuments);
    });
  });

  describe('finalizeEnvelopeReview', () => {
    const baseAction = { form_key: 'test_form_key' };

    it('sends the reviewed envelopes to the finalize endpoint and returns files for download', async () => {
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      const action = { ...baseAction, run_async: false };

      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ files: ['merged.pdf'] })
      });

      const result = await integrationClient.finalizeEnvelopeReview(action, {
        envelopes: [{ envelopeId: 'env-1' }],
        envelopeAction: 'download'
      });

      expect(global.fetch).toHaveBeenCalledWith(
        `${API_URL}document/form/finalize/`,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Token test_sdk_key'
          },
          method: 'POST',
          body: JSON.stringify({
            form_key: formKey,
            fuser_key: 'test_user_id',
            envelopes: [{ envelope_id: 'env-1' }],
            envelope_action: 'download',
            merge_docs: false,
            draft: false,
            run_async: false
          }),
          cache: 'no-store',
          keepalive: true
        }
      );
      expect(result).toEqual({ files: ['merged.pdf'] });
    });

    it('never sends signer_email on finalize (removed from the final contract)', async () => {
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      const action = {
        ...baseAction,
        run_async: false,
        envelope_signer_field_key: 'signer_field'
      };
      Object.assign(fieldValues, { signer_field: 'signer@example.com' });

      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ files: ['signed.pdf'] })
      });

      await integrationClient.finalizeEnvelopeReview(action, {
        envelopes: [{ envelopeId: 'env-1' }],
        envelopeAction: 'sign'
      });

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.envelopes).toEqual([{ envelope_id: 'env-1' }]);
      expect(body.signer_email).toBeUndefined();
      expect(body.envelope_action).toBe('sign');
    });

    it('polls until complete when finalize runs async', async () => {
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      integrationClient.FINALIZE_CHECK_INTERVAL = 1;
      integrationClient.FINALIZE_MAX_TIME = 20;
      const action = { ...baseAction, run_async: true };

      const completePayload = { status: 'complete', files: ['merged.pdf'] };

      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: jest.fn().mockResolvedValue({})
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ status: 'incomplete' })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue(completePayload)
        });

      const result = await integrationClient.finalizeEnvelopeReview(action, {
        envelopes: [{ envelopeId: 'env-1' }],
        envelopeAction: 'save'
      });

      expect(global.fetch).toHaveBeenCalledTimes(3);
      expect(global.fetch.mock.calls[1][0]).toBe(
        `${API_URL}document/form/finalize/poll/?fid=test_user_id&eids=env-1`
      );
      expect(result).toEqual(completePayload);
    });

    it('always polls for async finalize even if the initial POST response already looks file-shaped', async () => {
      // Regression for the old `data.files` early-return heuristic: the
      // real contract's immediate async POST response is always `{}` — the
      // client must key completion off `run_async` + the poll's
      // `status: 'complete'`, never off the shape of an intermediate body.
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      integrationClient.FINALIZE_CHECK_INTERVAL = 1;
      integrationClient.FINALIZE_MAX_TIME = 20;
      const action = { ...baseAction, run_async: true };

      const completePayload = { status: 'complete', files: ['merged.pdf'] };

      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: jest.fn().mockResolvedValue({ files: ['stale.pdf'] })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue(completePayload)
        });

      const result = await integrationClient.finalizeEnvelopeReview(action, {
        envelopes: [{ envelopeId: 'env-1' }],
        envelopeAction: 'download'
      });

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual(completePayload);
    });

    it('rejects an empty envelopes list without making a network call (backend rejects [])', async () => {
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      const action = { ...baseAction, run_async: false };

      const result = await integrationClient.finalizeEnvelopeReview(action, {
        envelopes: [],
        envelopeAction: 'download'
      });

      expect(global.fetch).not.toHaveBeenCalled();
      expect(result).toEqual({
        status: 'error',
        message: 'No envelopes to finalize'
      });
    });

    it('surfaces an error response from the finalize endpoint', async () => {
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      const action = { ...baseAction, run_async: false };

      global.fetch.mockResolvedValue({
        ok: false,
        json: jest.fn().mockResolvedValue({ error: 'Envelope expired' })
      });

      const result = await integrationClient.finalizeEnvelopeReview(action, {
        envelopes: [{ envelopeId: 'env-1' }],
        envelopeAction: 'sign'
      });

      expect(result).toEqual({
        status: 'error',
        message: 'Envelope expired'
      });
    });

    it('resolves with a timeout error when a poll body is not JSON, instead of hanging forever', async () => {
      // A gateway HTML 502 page makes response.json() throw. The poll loop
      // runs from a setTimeout inside the promise executor, so an unguarded
      // throw leaves the promise permanently unsettled and the caller's
      // spinner running until the user reloads.
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      integrationClient.FINALIZE_CHECK_INTERVAL = 1;
      integrationClient.FINALIZE_MAX_TIME = 3;
      const action = { ...baseAction, run_async: true };

      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: jest.fn().mockResolvedValue({})
        })
        .mockResolvedValue({
          ok: false,
          status: 502,
          json: jest
            .fn()
            .mockRejectedValue(new SyntaxError('Unexpected token <'))
        });

      const result = await integrationClient.finalizeEnvelopeReview(action, {
        envelopes: [{ envelopeId: 'env-1' }],
        envelopeAction: 'download'
      });

      expect(result).toEqual({
        status: 'error',
        message: 'Document finalize took too long...'
      });
    });

    it('surfaces a failing poll response immediately instead of retrying to timeout', async () => {
      // The poll must run with parseResponse=false. With the default `true`,
      // client-utils' checkResponseSuccess throws on the 500, the loop's bare
      // catch swallows it as a "transient network error", and the caller waits
      // out FINALIZE_MAX_TIME only to be told it was slow rather than failed.
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      integrationClient.FINALIZE_CHECK_INTERVAL = 1;
      integrationClient.FINALIZE_MAX_TIME = 20;
      const action = { ...baseAction, run_async: true };

      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: jest.fn().mockResolvedValue({})
        })
        .mockResolvedValue({
          ok: false,
          status: 500,
          json: jest.fn().mockResolvedValue({ error: 'Worker exploded' })
        });

      const result = await integrationClient.finalizeEnvelopeReview(action, {
        envelopes: [{ envelopeId: 'env-1' }],
        envelopeAction: 'download'
      });

      expect(result).toEqual({
        status: 'error',
        message: 'Worker exploded'
      });
      // POST + exactly one poll — no retry storm.
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('sends sign_method in the payload when present', async () => {
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      const action = {
        ...baseAction,
        run_async: false,
        sign_method: 'docusign'
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: jest
          .fn()
          .mockResolvedValue({ docusign_envelope_id: 'ds-1', status: 'sent' })
      });

      const result = await integrationClient.finalizeEnvelopeReview(action, {
        envelopes: [{ envelopeId: 'env-1' }],
        envelopeAction: 'sign'
      });

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.sign_method).toBe('docusign');
      expect(result).toEqual({
        docusign_envelope_id: 'ds-1',
        status: 'sent'
      });
    });

    it('does not send sign_method when the action omits it (regression)', async () => {
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      const action = { ...baseAction, run_async: false };

      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ files: ['merged.pdf'] })
      });

      await integrationClient.finalizeEnvelopeReview(action, {
        envelopes: [{ envelopeId: 'env-1' }],
        envelopeAction: 'download'
      });

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.sign_method).toBeUndefined();
    });

    it('finalizes a quik-sourced review envelope with its envelope id unchanged', async () => {
      // Quik-sourced review documents produce real Envelope rows on the
      // backend, so their `envelope_id` is source-agnostic: finalize must send
      // it through verbatim, exactly like a template-sourced envelope.
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);
      const action = { ...baseAction, run_async: false };

      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ files: ['signed.pdf'] })
      });

      await integrationClient.finalizeEnvelopeReview(action, {
        envelopes: [{ envelopeId: 'quik-env-1' }, { envelopeId: 'tmpl-env-2' }],
        envelopeAction: 'sign'
      });

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.envelopes).toEqual([
        { envelope_id: 'quik-env-1' },
        { envelope_id: 'tmpl-env-2' }
      ]);
    });
  });

  describe('sendDocusignEnvelope', () => {
    it('forwards wet_sign without requiring signers', async () => {
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);

      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ docusign_envelope_id: 'wet-1' })
      });

      const result = await integrationClient.sendDocusignEnvelope({
        documents: ['doc-1'],
        wetSign: true,
        useDisclosure: true
      });

      const body = requestBody();
      expect(requestMethod()).toBe('POST');
      expect(body.wet_sign).toBe(true);
      expect(body.use_disclosure).toBe(true);
      expect(body.signers).toBeUndefined();
      expect(body.documents).toEqual(['doc-1']);
      expect(result).toEqual({ docusign_envelope_id: 'wet-1' });
    });

    it('forwards ignoreTemplateFieldMapping as ignore_template_field_mapping', async () => {
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);

      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ docusign_envelope_id: 'env-1' })
      });

      await integrationClient.sendDocusignEnvelope({
        documents: ['doc-1'],
        fillData: { some_field_key: 'a string' },
        ignoreTemplateFieldMapping: true
      });

      const body = requestBody();
      expect(body.ignore_template_field_mapping).toBe(true);
      expect(body.fill_data).toEqual({ some_field_key: 'a string' });
    });
  });

  describe('updateDocusignEnvelope', () => {
    it('sends a PUT with the envelope id and status', async () => {
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);

      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ status: 'sent' })
      });

      const result = await integrationClient.updateDocusignEnvelope({
        envelopeId: 'env-123',
        status: 'sent'
      });

      expect(requestUrl()).toEqual(
        expect.stringContaining('docusign/envelope/')
      );
      expect(requestMethod()).toBe('PATCH');
      expect(requestBody()).toEqual(
        expect.objectContaining({
          fuser_key: 'test_user_id',
          form_key: formKey,
          docusign_envelope_id: 'env-123',
          status: 'sent'
        })
      );
      expect(requestBody().voided_reason).toBeUndefined();
      expect(result).toEqual({ status: 'sent' });
    });

    it('includes voided_reason when voiding', async () => {
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);

      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ status: 'voided' })
      });

      await integrationClient.updateDocusignEnvelope({
        envelopeId: 'env-123',
        status: 'voided',
        voidedReason: 'Customer cancelled'
      });

      expect(requestBody()).toEqual(
        expect.objectContaining({
          fuser_key: 'test_user_id',
          form_key: formKey,
          docusign_envelope_id: 'env-123',
          status: 'voided',
          voided_reason: 'Customer cancelled'
        })
      );
    });
  });

  describe('updateDocusignEnvelope (discard)', () => {
    it('discards via PATCH with status discarded', async () => {
      const formKey = 'test_form_key';
      const integrationClient = new IntegrationClient(formKey);

      global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ status: 'discarded' })
      });

      const result = await integrationClient.updateDocusignEnvelope({
        envelopeId: 'env-123',
        status: 'discarded'
      });

      expect(requestUrl()).toEqual(
        expect.stringContaining('docusign/envelope/')
      );
      expect(requestMethod()).toBe('PATCH');
      expect(requestBody()).toEqual(
        expect.objectContaining({
          fuser_key: 'test_user_id',
          form_key: formKey,
          docusign_envelope_id: 'env-123',
          status: 'discarded'
        })
      );
      expect(requestBody().voided_reason).toBeUndefined();
      expect(result).toEqual({ status: 'discarded' });
    });
  });
});
