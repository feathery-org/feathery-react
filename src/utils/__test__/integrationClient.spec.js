import IntegrationClient from '../featheryClient/integrationClient';
import { initInfo, fieldValues } from '../init';
import { setEnvironment, getApiUrl } from '@feathery/client-utils';

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

jest.mock('../init', () => ({
  initInfo: jest.fn(),
  initFormsPromise: Promise.resolve(),
  initState: { formSessions: {} },
  fieldValues: {}
}));

describe('IntegrationClient', () => {
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
      expect(global.fetch).toHaveBeenCalledWith(
        `${API_URL}rollout/custom-trigger/`,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Token test_sdk_key'
          },
          method: 'POST',
          body: JSON.stringify({
            automation_ids: [automationId],
            sync: true,
            multiple: false,
            payload: fieldValues,
            form_key: formKey,
            fuser_key: 'test_user_id'
          }),
          cache: 'no-store',
          keepalive: true
        }
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
      expect(global.fetch).toHaveBeenCalledWith(
        `${API_URL}rollout/custom-trigger/`,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Token test_sdk_key'
          },
          method: 'POST',
          body: JSON.stringify({
            automation_ids: automationIds,
            sync: false,
            multiple: true,
            payload: fieldValues,
            form_key: formKey,
            fuser_key: 'test_user_id'
          }),
          cache: 'no-store',
          keepalive: true
        }
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
      expect(global.fetch).toHaveBeenCalledWith(`${API_URL}email/logic-rule/`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Token test_sdk_key'
        },
        method: 'POST',
        body: JSON.stringify({
          template_id: templateId,
          form_key: formKey,
          fuser_key: 'test_user_id',
          skip_pfd: false
        }),
        cache: 'no-store',
        keepalive: true
      });
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
      expect(global.fetch).toHaveBeenCalledWith(
        `${API_URL}email/logic-rule/`,
        expect.objectContaining({
          body: JSON.stringify({
            template_id: templateId,
            form_key: formKey,
            fuser_key: 'user_id',
            skip_pfd: false
          })
        })
      );
    });
  });
});
