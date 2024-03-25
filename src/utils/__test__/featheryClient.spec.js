import FeatheryClient, { API_URL, CDN_URL } from '../featheryClient';
import { initInfo, initFormsPromise } from '../init';

jest.mock('../init', () => ({
  initInfo: jest.fn(),
  initFormsPromise: Promise.resolve(),
  initState: { formSessions: {} },
  fieldValues: {},
  filePathMap: {}
}));

describe('featheryClient', () => {
  describe('fetchForm', () => {
    it('fetches a form with the provided parameters', async () => {
      // Arrange
      const formExternalKey = 'form_external_key';
      const featheryClient = new FeatheryClient(formExternalKey);
      initInfo.mockReturnValue({
        sdkKey: 'sdkKey',
        userId: 'userId',
        formSessions: {},
        preloadForms: {},
        theme: ''
      });
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        json: jest
          .fn()
          .mockResolvedValue({ data: [], fonts: [], uploaded_fonts: {} })
      });

      // Act
      const response = await featheryClient.fetchForm();

      // Assert
      expect(global.fetch).toHaveBeenCalledWith(
        `${CDN_URL}panel/v20/?form_external_id=formId&draft=false&theme=`,
        {
          cache: 'no-store',
          keepalive: false,
          importance: 'high',
          headers: {
            Authorization: 'Token sdkKey',
            'Accept-Encoding': 'gzip'
          }
        }
      );
      expect(response).toEqual({ steps: [], fonts: [], uploaded_fonts: {} });
    });
  });

  describe('fetchSession', () => {
    it('fetches a session with the provided parameters', async () => {
      // Arrange
      const formExternalKey = 'form_external_key';
      const featheryClient = new FeatheryClient(formExternalKey);
      initInfo.mockReturnValue({
        sdkKey: 'sdkKey',
        userId: 'userId',
        formSessions: {},
        preloadForms: {},
        overrideUserId: true,
        fieldValuesInitialized: false
      });
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        json: jest.fn().mockResolvedValue({
          file_values: {},
          field_values: {},
          integrations: {}
        })
      });

      // Act
      const response = await featheryClient.fetchSession();

      // Assert
      expect(global.fetch).toHaveBeenCalledWith(
        `${API_URL}panel/session/v2/?form_external_id=formId&draft=false&override=true&fuser_key=userId`,
        {
          cache: 'no-store',
          keepalive: false,
          importance: 'high',
          headers: { Authorization: 'Token sdkKey' }
        }
      );
      expect(response).toEqual([
        { field_values: {}, file_values: {}, integrations: {} },
        undefined
      ]);
    });
  });

  describe('submitCustom', () => {
    it('fetches on submit', async () => {
      // Arrange
      const formExternalKey = 'form_external_key';
      const featheryClient = new FeatheryClient(formExternalKey);
      const customKeyValues = { foo: 'bar' };
      initInfo.mockReturnValue({ sdkKey: 'sdkKey', userId: 'userId' });
      global.fetch = jest.fn().mockResolvedValue({ status: 200 });

      // Act
      const response = await featheryClient.submitCustom(customKeyValues);

      // Assert
      expect(global.fetch).toHaveBeenCalledWith(
        `${API_URL}panel/custom/submit/v3/`,
        {
          cache: 'no-store',
          keepalive: true,
          headers: { Authorization: 'Token sdkKey' },
          method: 'POST',
          body: expect.any(FormData)
        }
      );
      const formData = Array.from(
        global.fetch.mock.calls[0][1].body.entries()
      ).reduce((acc, f) => ({ ...acc, [f[0]]: f[1] }), {});
      expect(formData).toMatchObject({
        custom_key_values: JSON.stringify(customKeyValues),
        fuser_key: 'userId',
        form_external_key: form_external_key
      });
      expect(response).toEqual({ status: 200 });
    });
  });

  describe('submitStep', () => {
    it('fetches on step submission', async () => {
      // Arrange
      const formExternalKey = 'form_external_key';
      const featheryClient = new FeatheryClient(formExternalKey);
      const servars = [
        {
          key: 'servar1',
          type: 'type1'
        }
      ];
      const body = {
        fuser_key: 'userId',
        step_key: 'stepKey',
        servars,
        panel_key: form_external_key
      };
      initInfo.mockReturnValue({ sdkKey: 'sdkKey', userId: 'userId' });
      global.fetch = jest.fn().mockResolvedValue({ status: 200 });

      // Act
      const response = await featheryClient.submitStep(servars, {
        key: 'stepKey',
        buttons: [],
        subgrids: []
      });

      // Assert
      expect(global.fetch).toHaveBeenCalledWith(
        `${API_URL}panel/step/submit/v3/`,
        {
          cache: 'no-store',
          keepalive: true,
          headers: {
            Authorization: 'Token sdkKey',
            'Content-Type': 'application/json'
          },
          method: 'POST',
          body: JSON.stringify(body)
        }
      );
      expect(response).toEqual([undefined, [undefined, { status: 200 }]]);
    });
  });

  describe('registerEvent', () => {
    it('registers an event', async () => {
      // Arrange
      const formExternalKey = 'form_external_key';
      const stepKey = 'stepKey';
      const event = { eventStuff: 'eventStuff' };
      const nextStepKey = '';
      const featheryClient = new FeatheryClient(formExternalKey);
      const body = {
        form_external_key: form_external_key,
        step_key: stepKey,
        next_step_key: nextStepKey,
        event,
        fuser_key: 'userId'
      };
      initInfo.mockReturnValue({ sdkKey: 'sdkKey', userId: 'userId' });
      global.fetch = jest.fn().mockResolvedValue({ status: 200 });

      // Act
      await initFormsPromise;
      await featheryClient.registerEvent({
        step_key: stepKey,
        next_step_key: nextStepKey,
        event
      });

      // Assert
      expect(global.fetch).toHaveBeenCalledWith(`${API_URL}event/`, {
        cache: 'no-store',
        keepalive: true,
        headers: {
          Authorization: 'Token sdkKey',
          'Content-Type': 'application/json'
        },
        method: 'POST',
        body: JSON.stringify(body)
      });
    });
  });

  describe('stripe', () => {
    initInfo.mockReturnValue({
      sdkKey: 'sdkKey',
      userId: 'userId',
      formSessions: {},
      preloadForms: {}
    });
    const formExternalKey = 'form_external_key';
    const userId = 'userId';
    const featheryClient = new FeatheryClient(formExternalKey);
    const mockFetch = (response) => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        json: jest.fn().mockResolvedValue(response)
      });
    };
    it('setupPaymentIntent sets up a payment intent and returns the intent secret', async () => {
      // Arrange
      const paymentMethodFieldId = 'payment_method_field_id';
      const body = {
        form_external_key: form_external_key,
        user_id: userId,
        field_id: paymentMethodFieldId
      };
      const intentSecret = 'intent_secret';
      mockFetch(intentSecret);

      // Act
      const response = await featheryClient.setupPaymentIntent(
        paymentMethodFieldId
      );

      // Assert
      expect(global.fetch).toHaveBeenCalledWith(
        `${API_URL}stripe/payment_method/`,
        {
          body: JSON.stringify(body),
          cache: 'no-store',
          keepalive: true,
          headers: {
            Authorization: 'Token sdkKey',
            'Content-Type': 'application/json'
          },
          method: 'POST'
        }
      );
      expect(response).toEqual(intentSecret);
    });
    it('retrievePaymentMethodData retrieves the payment method  info', async () => {
      // Arrange
      const stripePaymentMethodId = 'stripe_payment_method_id';
      const paymentMethodFieldId = 'payment_method_field_id';
      const paymentMethodData = {
        card_data: {
          brand: 'mastercard',
          last4: '6685',
          country: 'US',
          exp_year: 2024,
          exp_month: 4,
          postal_code: '46814'
        },
        stripe_customer_id: 'stripe_customer_id',
        stripe_payment_method_id: stripePaymentMethodId
      };
      mockFetch(paymentMethodData);

      // Act
      const result = await featheryClient.retrievePaymentMethodData(
        paymentMethodFieldId,
        stripePaymentMethodId
      );

      // Assert
      expect(global.fetch).toHaveBeenCalledWith(
        `${API_URL}stripe/payment_method/card/?field_id=${paymentMethodFieldId}&form_external_key=${form_external_key}&user_id=${userId}&stripe_payment_method_id=${stripePaymentMethodId}`,
        {
          cache: 'no-store',
          keepalive: false,
          headers: {
            Authorization: 'Token sdkKey',
            'Content-Type': 'application/json'
          }
        }
      );
      expect(result).toEqual(paymentMethodData);
    });
    it('createPayment properly calls the end point', async () => {
      // Arrange
      const body = {
        form_external_key: form_external_key,
        user_id: userId
      };
      const intentSecret = 'intent_secret';
      mockFetch(intentSecret);

      // Act
      const response = await featheryClient.createPayment();

      // Assert
      expect(global.fetch).toHaveBeenCalledWith(`${API_URL}stripe/payment/`, {
        body: JSON.stringify(body),
        cache: 'no-store',
        keepalive: true,
        headers: {
          Authorization: 'Token sdkKey',
          'Content-Type': 'application/json'
        },
        method: 'POST'
      });
      expect(response).toEqual(intentSecret);
    });
    it('createCheckoutSession properly calls the end point', async () => {
      // Arrange
      const successUrl = 'success';
      const cancelUrl = 'cancel';
      const body = {
        form_external_key: form_external_key,
        user_id: userId,
        success_url: successUrl,
        cancel_url: cancelUrl
      };
      const expectedResponse = { checkout_url: 'checkoutUrl' };
      mockFetch(expectedResponse);

      // Act
      const response = await featheryClient.createCheckoutSession(
        successUrl,
        cancelUrl
      );

      // Assert
      expect(global.fetch).toHaveBeenCalledWith(`${API_URL}stripe/checkout/`, {
        body: JSON.stringify(body),
        cache: 'no-store',
        keepalive: true,
        headers: {
          Authorization: 'Token sdkKey',
          'Content-Type': 'application/json'
        },
        method: 'POST'
      });
      expect(response).toEqual(expectedResponse);
    });
  });
});
