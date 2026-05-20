import { getABVariant, httpHelpers } from '../formHelperFunctions';
import { initInfo, setFieldValues } from '../init';
import FeatheryClient, { STATIC_URL } from '../featheryClient';

jest.mock('../init');

describe('formHelperFunctions', () => {
  describe('getABVariant', () => {
    const baseStepRes = () => ({
      variant_id: 'variant-id',
      variant_name: 'Variant Name',
      variant_version: 'variant-version',
      variant: 'variant',
      variant_logic_rules: 'variant-logic-rules',
      variant_shared_codes: 'variant-shared-codes',
      variant_connector_fields: 'variant-connector-fields',
      form_name: 'Form Name',
      data: 'data'
    });

    const baseABTestStepResponse = ({
      dataVariant,
      formName,
      variantName,
      data,
      variant
    }) => ({
      ...baseStepRes(),
      ab_test_id: 'ab-test-id',
      ab_test_variant_a_weight: 70,
      ab_test_data_variant: dataVariant,
      form_name: formName,
      variant_name: variantName,
      data,
      variant
    });

    it('returns the same variant for the same information', () => {
      // Arrange
      const stepRes = {
        variant: 'variant',
        form_name: 'Form Name',
        data: 'data'
      };
      initInfo.mockReturnValue({
        sdkKey: 'sdkKey',
        userId: 'userId'
      });

      // Act
      const actual1 = getABVariant(stepRes);
      const actual2 = getABVariant(stepRes);

      // Assert
      expect(actual1).toEqual(actual2);
    });

    it('uses the same AB test assignment from either variant link', () => {
      const variantAResponse = baseABTestStepResponse({
        dataVariant: 'variant_a',
        formName: 'Variant A',
        variantName: 'Variant B',
        data: 'variant-a-data',
        variant: 'variant-b-data'
      });
      const variantBResponse = baseABTestStepResponse({
        dataVariant: 'variant_b',
        formName: 'Variant B',
        variantName: 'Variant A',
        data: 'variant-b-data',
        variant: 'variant-a-data'
      });
      initInfo.mockReturnValue({
        sdkKey: 'sdkKey',
        userId: 'a'
      });

      const variantAResult = getABVariant(variantAResponse);
      const variantBResult = getABVariant(variantBResponse);

      expect(variantAResult.form_name).toEqual('Variant B');
      expect(variantAResult.steps).toEqual('variant-b-data');
      expect(variantBResult.form_name).toEqual('Variant B');
      expect(variantBResult.steps).toEqual('variant-b-data');
      expect(variantAResult.ab_test_id).toBeUndefined();
      expect(variantAResult.ab_test_variant_a_weight).toBeUndefined();
      expect(variantAResult.ab_test_data_variant).toBeUndefined();
    });

    it('falls back to 50 for invalid data weights', () => {
      const stepRes = {
        ...baseStepRes(),
        ab_test_data_weight: 500
      };
      initInfo.mockReturnValue({
        sdkKey: 'sdkKey',
        userId: 'a'
      });

      const actual = getABVariant(stepRes);

      expect(actual.form_name).toEqual('Form Name');
      expect(actual.steps).toEqual('data');
      expect(actual.ab_test_data_weight).toBeUndefined();
    });
  });

  describe('httpHelpers', () => {
    const formKey = 'test_form_key';
    const userId = 'test_user_id';
    const sdkKey = 'test_sdk_key';
    let featheryClient;

    beforeEach(() => {
      jest.clearAllMocks();
      initInfo.mockReturnValue({
        sdkKey,
        userId
      });
      featheryClient = new FeatheryClient(formKey);
      global.fetch = jest.fn();
    });

    afterEach(() => {
      global.fetch.mockClear();
    });

    it('makes a GET request using http.get()', async () => {
      // Arrange
      const mockResponse = {
        status: 200,
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: { result: 'success' },
          status_code: 200
        })
      };
      global.fetch.mockResolvedValue(mockResponse);

      // Act
      const helpers = httpHelpers(featheryClient);
      const response = await helpers.get(
        'https://api.example.com/data',
        { key: 'value' },
        { 'X-Custom-Header': 'test' }
      );

      // Assert
      expect(global.fetch).toHaveBeenCalledWith(
        `${STATIC_URL}custom_request/`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Token test_sdk_key'
          },
          body: JSON.stringify({
            fuser_key: userId,
            form_key: formKey,
            name: undefined,
            method: 'GET',
            url: 'https://api.example.com/data',
            user_data: { key: 'value' },
            headers: { 'X-Custom-Header': 'test' },
            field_values: { feathery_user_id: '' }
          }),
          cache: 'no-store',
          keepalive: false
        }
      );
      expect(response).toEqual(
        expect.objectContaining({
          data: { result: 'success' },
          statusCode: 200
        })
      );
    });

    it('makes a POST request using http.post()', async () => {
      // Arrange
      const mockResponse = {
        status: 200,
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: { id: '123' },
          status_code: 201
        })
      };
      global.fetch.mockResolvedValue(mockResponse);

      // Act
      const helpers = httpHelpers(featheryClient);
      const response = await helpers.post(
        'https://api.example.com/items',
        { name: 'test' },
        { Authorization: 'Bearer token' }
      );

      // Assert
      expect(global.fetch).toHaveBeenCalledWith(
        `${STATIC_URL}custom_request/`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Token test_sdk_key'
          },
          body: JSON.stringify({
            fuser_key: userId,
            form_key: formKey,
            name: undefined,
            method: 'POST',
            url: 'https://api.example.com/items',
            user_data: { name: 'test' },
            headers: { Authorization: 'Bearer token' },
            field_values: { feathery_user_id: '' }
          }),
          cache: 'no-store',
          keepalive: false
        }
      );
      expect([201, undefined]).toContain(response.status_code);
      expect(response).toEqual(
        expect.objectContaining({
          data: { id: '123' },
          statusCode: 201
        })
      );
    });

    it('makes a connect request using http.connect() and updates field data', async () => {
      // Arrange
      const mockResponse = {
        status: 200,
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: { result: 'connected' },
          status_code: 200,
          field_values: { field3: 'newValue', field4: 'anotherValue' }
        })
      };
      global.fetch.mockResolvedValue(mockResponse);

      // Act
      const helpers = httpHelpers(featheryClient);
      const response = await helpers.connect(
        'my-connector',
        { input: 'data' },
        { Authorization: 'Bearer token' }
      );

      // Assert
      expect(global.fetch).toHaveBeenCalledWith(
        `${STATIC_URL}custom_request/`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Token test_sdk_key'
          },
          body: JSON.stringify({
            fuser_key: userId,
            form_key: formKey,
            name: 'my-connector',
            method: undefined,
            url: undefined,
            user_data: { input: 'data' },
            headers: { Authorization: 'Bearer token' },
            field_values: { feathery_user_id: '' }
          }),
          cache: 'no-store',
          keepalive: false
        }
      );
      expect(response).toEqual({
        data: { result: 'connected' },
        statusCode: 200
      });

      // Verify field values were updated via the callback
      expect(setFieldValues).toHaveBeenCalledWith(
        { field3: 'newValue', field4: 'anotherValue' },
        true,
        true
      );
    });

    it('handles connector fields correctly', async () => {
      // Arrange
      const connectorFields = ['field1', 'field2'];
      const mockResponse = {
        status: 200,
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: { result: 'success' },
          status_code: 200
        })
      };
      global.fetch.mockResolvedValue(mockResponse);

      // Act
      const helpers = httpHelpers(featheryClient, connectorFields);
      await helpers.get('https://api.example.com/data', {}, {});

      // Assert
      expect(global.fetch).toHaveBeenCalledWith(
        `${STATIC_URL}custom_request/`,
        expect.objectContaining({
          body: expect.stringContaining('field_values')
        })
      );
    });

    it('saves request when fetch fails', async () => {
      // Arrange
      global.fetch = jest
        .fn()
        .mockRejectedValue(new TypeError('Network error'));
      featheryClient.offlineRequestHandler.saveRequest = jest.fn();

      // Act
      const helpers = httpHelpers(featheryClient);
      await expect(
        helpers.connect(
          'my-connector',
          { input: 'data' },
          { Authorization: 'Bearer token' }
        )
      ).rejects.toThrow('Network error');

      // Assert
      expect(
        featheryClient.offlineRequestHandler.saveRequest
      ).toHaveBeenCalled();
    });
  });
});
