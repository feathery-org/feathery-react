import {
  setupPaymentMethod,
  getFlatStripeCustomerFieldValues
} from '../stripe';

const mockStripeConfig = () => ({
  metadata: {
    customer_field_mappings: {
      name: { id: 'customer-name-id', type: 'servar' },
      description: {
        id: 'customer-description-hidden',
        type: 'hidden'
      },
      address: {
        line1: { id: 'addr_line1-id', type: 'servar' },
        line2: { id: 'addr_line2-id', type: 'servar' },
        city: { id: 'addr_city-id', type: 'servar' },
        state: { id: 'addr_state-id', type: 'servar' },
        country: { id: 'addr_country-id', type: 'servar' },
        postal_code: { id: 'addr_postal-id', type: 'servar' }
      },
      shipping: {
        address: {
          line1: { id: 'ship_line1-id', type: 'servar' },
          line2: { id: 'ship_line2-id', type: 'servar' },
          city: { id: 'ship_city-id', type: 'servar' },
          state: { id: 'ship_state-id', type: 'servar' },
          country: { id: 'ship_country-id', type: 'servar' },
          postal_code: { id: 'ship_postal-id', type: 'servar' }
        },
        name: { id: 'ship_name-id', type: 'servar' }
      }
    }
  }
});
const mockFieldValues = {
  'customer-name': { value: 'customer name value' },
  'customer-description-hidden': { value: 'customer description' },
  addr_country: { value: 'customer address country' },
  ship_line1: { value: 'customer shipping line 1' },
  otherNonCustomerField: { value: 'blaa' }
};
const mockServarFields = [
  { servar: { id: 'customer-name-id', key: 'customer-name' } },
  { servar: { id: 'addr_country-id', key: 'addr_country' } },
  { servar: { id: 'ship_line1-id', key: 'ship_line1' } },
  { servar: { id: 'otherNonCustomerFieldId', key: 'otherNonCustomerField' } }
];

describe('Stripe integration helper', () => {
  describe('getStripeCustomerFieldValues', () => {
    it('retrieves no customer fields when no field values', () => {
      const result = getFlatStripeCustomerFieldValues(
        mockStripeConfig(),
        {},
        mockServarFields
      );
      expect(result).toStrictEqual({});
    });
    it('retrieves only customer fields', () => {
      const result = getFlatStripeCustomerFieldValues(
        mockStripeConfig(),
        mockFieldValues,
        mockServarFields
      );
      expect(result).toStrictEqual({
        'customer-name': 'customer name value',
        'customer-description-hidden': 'customer description',
        addr_country: 'customer address country',
        ship_line1: 'customer shipping line 1'
      });
    });
  });

  describe('setupPaymentMethod', () => {
    const mockServar = {
      id: 'some id',
      key: 'payment-method-1',
      type: 'payment_method'
    };
    const mockStep = { servar_fields: [] };

    const mockStripe = {};
    mockStripe.confirmCardSetup = jest.fn().mockResolvedValue({
      setupIntent: { payment_method: '' }
    });

    const mockTargetElement = {};

    it('returns null if no card element', async () => {
      const mockClient = {};
      const mockFormattedFields = {};
      const mockUpdateFieldValues = jest.fn();

      // act
      const result = await setupPaymentMethod(
        {
          servar: mockServar,
          client: mockClient,
          formattedFields: mockFormattedFields,
          updateFieldValues: mockUpdateFieldValues,
          integrationData: mockStripeConfig,
          step: mockStep,
          targetElement: mockTargetElement
        },
        mockStripe
      );

      // Assert
      expect(result).toBeNull();
    });
    it('returns payment method data', async () => {
      const mockStripe = {};
      mockStripe.confirmCardSetup = jest.fn().mockResolvedValue({
        setupIntent: { payment_method: '' }
      });

      const stripePaymentMethodId = 'stripe_payment_method_id';
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

      const mockClient = {};
      mockClient.setupPaymentIntent = jest
        .fn()
        .mockResolvedValue({ intent_secret: 'test_secret' });
      mockClient.retrievePaymentMethodData = jest
        .fn()
        .mockResolvedValue(paymentMethodData);
      mockClient.submitCustom = jest.fn().mockResolvedValue({});

      const mockFormattedFields = {};
      mockFormattedFields[mockServar.key] = { value: { complete: true } };
      const mockUpdateFieldValues = jest.fn();

      // act
      const result = await setupPaymentMethod(
        {
          servar: mockServar,
          client: mockClient,
          formattedFields: mockFormattedFields,
          updateFieldValues: mockUpdateFieldValues,
          integrationData: mockStripeConfig(),
          step: mockStep,
          targetElement: mockTargetElement
        },
        mockStripe
      );

      // Assert
      expect(mockClient.setupPaymentIntent).toHaveBeenCalled();
      expect(mockStripe.confirmCardSetup).toHaveBeenCalled();
      expect(mockClient.retrievePaymentMethodData).toHaveBeenCalled();
      expect(result).toBeNull();
      expect(mockFormattedFields[mockServar.key].value).toEqual(
        paymentMethodData
      );
    });
  });
});
