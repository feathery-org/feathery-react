import {
  setupPaymentMethodAndPay,
  toggleProductSelection,
  isProductSelected,
  getFlatStripeCustomerFieldValues
} from '../stripe';

const mockStripeConfig = () => ({
  metadata: {
    customer_field_mappings: {
      name: 'customer-name',
      description: 'customer-description-hidden',
      address: {
        line1: 'addr_line1',
        line2: 'addr_line2',
        city: 'addr_city',
        state: 'addr_state',
        country: 'addr_country',
        postal_code: 'addr_postal'
      },
      shipping: {
        address: {
          line1: 'ship_line1',
          line2: 'ship_line2',
          city: 'ship_city',
          state: 'ship_state',
          country: 'ship_country',
          postal_code: 'ship_postal'
        },
        name: 'ship_name'
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

describe('Stripe integration helper', () => {
  describe('getFlatStripeCustomerFieldValues', () => {
    it('retrieves no customer fields when no field values', () => {
      const result = getFlatStripeCustomerFieldValues(mockStripeConfig(), {});
      expect(result).toStrictEqual({});
    });
    it('retrieves only customer fields', () => {
      const result = getFlatStripeCustomerFieldValues(
        mockStripeConfig(),
        mockFieldValues
      );
      expect(result).toStrictEqual({
        'customer-name': 'customer name value',
        'customer-description-hidden': 'customer description',
        addr_country: 'customer address country',
        ship_line1: 'customer shipping line 1'
      });
    });
  });

  describe('setupPaymentMethodAndPay', () => {
    const paymentMethodFieldKey = 'payment-method-1';
    const mockServar = {
      id: 'some id',
      key: paymentMethodFieldKey,
      type: 'payment_method'
    };

    const mockStripe: any = {};
    mockStripe.confirmCardSetup = jest.fn().mockResolvedValue({
      setupIntent: { payment_method: '' }
    });

    const mockTargetElement = {};

    it('returns null if no card element', async () => {
      const mockClient = {};
      const mockFormattedFields = {};
      const mockUpdateFieldValues = jest.fn();

      // act
      const result = await setupPaymentMethodAndPay(
        {
          servar: mockServar,
          client: mockClient,
          formattedFields: mockFormattedFields,
          updateFieldValues: mockUpdateFieldValues,
          integrationData: mockStripeConfig,
          targetElement: mockTargetElement
        },
        mockStripe
      );

      // Assert
      expect(result).toBeNull();
    });
    it('returns payment method data', async () => {
      const mockStripe: any = {};
      mockStripe.confirmCardSetup = jest.fn().mockResolvedValue({
        setupIntent: { payment_method: '' }
      });
      mockStripe.confirmCardPayment = jest.fn().mockResolvedValue({
        paymentIntent: {}
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

      const mockClient: any = {};
      mockClient.setupPaymentIntent = jest
        .fn()
        .mockResolvedValue({ intent_secret: 'test_secret' });
      mockClient.retrievePaymentMethodData = jest
        .fn()
        .mockResolvedValue(paymentMethodData);
      mockClient.submitCustom = jest.fn().mockResolvedValue({});
      mockClient.createPayment = jest
        .fn()
        .mockResolvedValue({ intent_secret: 'payment_intent_secret' });
      mockClient.paymentComplete = jest.fn().mockResolvedValue({
        product_fields_to_clear: ['field_key_1', 'field_key_2']
      });

      const mockFormattedFields = {};
      mockFormattedFields[mockServar.key] = { value: { complete: true } };
      const mockUpdateFieldValues = jest.fn();

      // act
      const result = await setupPaymentMethodAndPay(
        {
          servar: mockServar,
          client: mockClient,
          formattedFields: mockFormattedFields,
          updateFieldValues: mockUpdateFieldValues,
          integrationData: mockStripeConfig(),
          targetElement: mockTargetElement
        },
        mockStripe
      );

      // Assert
      expect(mockClient.setupPaymentIntent).toHaveBeenCalled();
      expect(mockStripe.confirmCardSetup).toHaveBeenCalled();
      expect(mockClient.retrievePaymentMethodData).toHaveBeenCalled();
      expect(mockClient.createPayment).toHaveBeenCalledWith(
        paymentMethodFieldKey
      );
      expect(mockClient.paymentComplete).toHaveBeenCalled();
      expect(mockUpdateFieldValues).toHaveBeenCalled();
      expect(result).toBeNull();
      expect(mockFormattedFields[mockServar.key].value).toEqual(
        paymentMethodData
      );
    });
  });

  describe('toggleProductSelection', () => {
    it('sets the product select hidden field and the total cost hidden field', async () => {
      // Arrange
      const selectedProductIdFieldKey = 'some_key'; // hidden field key
      const selectedProductIdFieldId = 'some_id'; // hidden field id
      const totalField = 'some_other_key'; // hidden field key
      const productId = 'pr_PcVyovGHZVpxSo';
      const mockTotal = '112.99';
      const mockClient: any = {};
      mockClient.updateProductSelection = jest.fn().mockResolvedValue({
        field_values: {
          [selectedProductIdFieldKey]: {
            [productId]: 1
          },
          [totalField]: mockTotal
        }
      });
      const mockUpdateFieldValues = jest.fn();
      const fieldValues = {
        [selectedProductIdFieldKey]: {
          [productId]: 0
        }
      };
      const integrations = {
        stripe: {
          metadata: {
            payment_field_mappings: {
              total: totalField
            }
          }
        }
      };

      // Act
      await toggleProductSelection({
        productId,
        selectedProductIdFieldId,
        selectedProductIdFieldKey,
        fieldValues,
        updateFieldValues: mockUpdateFieldValues,
        client: mockClient,
        integrations
      });

      // Assert
      expect(mockClient.updateProductSelection).toHaveBeenCalledWith(
        productId,
        1,
        selectedProductIdFieldKey
      );
      const expectedVal1 = {
        [selectedProductIdFieldKey]: {
          [productId]: 1
        }
      };
      const expectedVal2 = Object.assign({}, expectedVal1, {
        [totalField]: mockTotal
      });
      expect(mockUpdateFieldValues).toHaveBeenNthCalledWith(1, expectedVal1);
      expect(mockUpdateFieldValues).toHaveBeenNthCalledWith(2, expectedVal2);
    });
  });
  describe('isProductSelected', () => {
    const productId = 'pr_PcVyovGHZVpxSo';
    const selectedProductIdFieldKey = 'some_key'; // hidden field key
    it('properly determines the product is selected', async () => {
      // Arrange, Act & Assert
      expect(
        isProductSelected({
          productId,
          selectedProductIdField: selectedProductIdFieldKey,
          fieldValues: {
            [selectedProductIdFieldKey]: {
              [productId]: 1
            }
          }
        })
      ).toEqual(true);
    });
    it('properly determines the product is not-selected if qty is 0', async () => {
      // Arrange, Act & Assert
      expect(
        isProductSelected({
          productId,
          selectedProductIdField: selectedProductIdFieldKey,
          fieldValues: {
            [selectedProductIdFieldKey]: {
              [productId]: 0
            }
          }
        })
      ).toEqual(false);
    });
    it('properly determines the product is not-selected if hidden field has some other id', async () => {
      // Arrange, Act & Assert
      expect(
        isProductSelected({
          productId,
          selectedProductIdField: selectedProductIdFieldKey,
          fieldValues: {
            [selectedProductIdFieldKey]: {
              'some non-matching product id': 1
            }
          }
        })
      ).toEqual(false);
    });
    it('properly determines the product is not-selected if hidden field has has no value', async () => {
      // Arrange, Act & Assert
      expect(
        isProductSelected({
          productId,
          selectedProductIdField: selectedProductIdFieldKey,
          fieldValues: {}
        })
      ).toEqual(false);
    });
  });
});
