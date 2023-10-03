import Client, { API_URL, CDN_URL } from '../client';
import { initInfo, initFormsPromise } from '../init';

jest.mock('../init', () => ({
  initInfo: jest.fn(),
  initFormsPromise: Promise.resolve(),
  initState: { formSessions: {} },
  fieldValues: {},
  filePathMap: {}
}));

describe('client', () => {
  describe('fetchForm', () => {
    it('fetches a form with the provided parameters', async () => {
      // Arrange
      const formKey = 'formKey';
      const client = new Client(formKey);
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
      const response = await client.fetchForm();

      // Assert
      expect(global.fetch).toHaveBeenCalledWith(
        `${CDN_URL}panel/v19/?form_key=formKey&draft=false&theme=`,
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
      const formKey = 'formKey';
      const client = new Client(formKey);
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
      const response = await client.fetchSession();

      // Assert
      expect(global.fetch).toHaveBeenCalledWith(
        `${API_URL}panel/session/v2/?form_key=formKey&draft=false&override=true&fuser_key=userId`,
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
      const formKey = 'formKey';
      const client = new Client(formKey);
      const customKeyValues = { foo: 'bar' };
      initInfo.mockReturnValue({ sdkKey: 'sdkKey', userId: 'userId' });
      global.fetch = jest.fn().mockResolvedValue({ status: 200 });

      // Act
      const response = await client.submitCustom(customKeyValues);

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
        form_key: formKey
      });
      expect(response).toEqual({ status: 200 });
    });
  });

  describe('submitStep', () => {
    it('fetches on step submission', async () => {
      // Arrange
      const formKey = 'formKey';
      const client = new Client(formKey);
      const servars = [
        {
          key: 'servar1',
          type: 'type1'
        }
      ];
      const body = {
        fuser_key: 'userId',
        servars,
        panel_key: formKey,
        draft: false
      };
      initInfo.mockReturnValue({ sdkKey: 'sdkKey', userId: 'userId' });
      global.fetch = jest.fn().mockResolvedValue({ status: 200 });

      // Act
      const response = await client.submitStep(servars);

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
      expect(response).toEqual([{ status: 200 }]);
    });
  });

  describe('registerEvent', () => {
    it('registers an event', async () => {
      // Arrange
      const formKey = 'formKey';
      const stepKey = 'stepKey';
      const event = { eventStuff: 'eventStuff' };
      const nextStepKey = '';
      const client = new Client(formKey);
      const body = {
        form_key: formKey,
        step_key: stepKey,
        next_step_key: nextStepKey,
        event,
        fuser_key: 'userId'
      };
      initInfo.mockReturnValue({ sdkKey: 'sdkKey', userId: 'userId' });
      global.fetch = jest.fn().mockResolvedValue({ status: 200 });

      // Act
      await initFormsPromise;
      const response = await client.registerEvent({
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
      expect(response).toEqual({ status: 200 });
    });
  });

  describe('stripe', () => {
    initInfo.mockReturnValue({
      sdkKey: 'sdkKey',
      userId: 'userId',
      formSessions: {},
      preloadForms: {}
    });
    const formKey = 'formKey';
    const userId = 'userId';
    const client = new Client(formKey);
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
        form_key: formKey,
        user_id: userId,
        field_id: paymentMethodFieldId
      };
      const intentSecret = 'intent_secret';
      mockFetch(intentSecret);

      // Act
      const response = await client.setupPaymentIntent(paymentMethodFieldId);

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
      const result = await client.retrievePaymentMethodData(
        paymentMethodFieldId,
        stripePaymentMethodId
      );

      // Assert
      expect(global.fetch).toHaveBeenCalledWith(
        `${API_URL}stripe/payment_method/card/?field_id=${paymentMethodFieldId}&form_key=${formKey}&user_id=${userId}&stripe_payment_method_id=${stripePaymentMethodId}`,
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
        form_key: formKey,
        user_id: userId
      };
      const intentSecret = 'intent_secret';
      mockFetch(intentSecret);

      // Act
      const response = await client.createPayment();

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
        form_key: formKey,
        user_id: userId,
        success_url: successUrl,
        cancel_url: cancelUrl
      };
      const expectedResponse = { checkout_url: 'checkoutUrl' };
      mockFetch(expectedResponse);

      // Act
      const response = await client.createCheckoutSession(
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
