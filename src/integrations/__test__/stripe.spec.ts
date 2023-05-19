import { featheryWindow } from '../../utils/browser';
import {
  setupPaymentMethod,
  purchaseCart,
  getFlatStripeCustomerFieldValues,
  getPaymentsReservedFieldValues,
  addToCart,
  removeFromCart
} from '../stripe';
import { fieldValues } from '../../utils/init';

const mockStripeConfig = (checkoutType: 'custom' | 'stripe' = 'custom') => ({
  metadata: {
    checkout_type: checkoutType,
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

const paymentMethodFieldKey = 'payment-method-1';
const mockServar = {
  id: 'some id',
  key: paymentMethodFieldKey,
  type: 'payment_method'
};
const mockPmField = { servar: mockServar };
const paymentMethodFieldKey2 = 'payment-method-2';
const mockServarNotFilled = {
  id: 'some id 2',
  key: paymentMethodFieldKey2,
  type: 'payment_method'
};
const mockPmNotFilledField = { servar: mockServarNotFilled };

const mockCartSelections = { 'stripe-prod-1': 1, 'stripe-prod-2': 2 };

jest.mock('../../utils/init', () => ({
  fieldValues: {
    'customer-name': 'customer name value',
    'customer-description-hidden': 'customer description',
    addr_country: 'customer address country',
    ship_line1: 'customer shipping line 1',
    otherNonCustomerField: 'blaa',
    payment_product_1_quantity: 1,
    payment_product_2_quantity: 2,
    'payment-method-1': { complete: true },
    'feathery.payments.selections': {
      'stripe-prod-1': 1,
      'stripe-prod-2': 2
    }
  }
}));

const mockFormattedFieldValues = {
  'customer-name': { value: 'customer name value' },
  'customer-description-hidden': { value: 'customer description' },
  addr_country: { value: 'customer address country' },
  ship_line1: { value: 'customer shipping line 1' },
  otherNonCustomerField: { value: 'blaa' },
  payment_product_1_quantity: { value: 1 },
  payment_product_2_quantity: { value: 2 }
};

const _mockStripe = () => {
  const mockObj: any = {};
  mockObj.confirmCardSetup = jest.fn().mockResolvedValue({
    setupIntent: { payment_method: '' }
  });
  mockObj.confirmCardPayment = jest.fn().mockResolvedValue({
    paymentIntent: {}
  });
  return mockObj;
};

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

const _mockClient = () => {
  const mockObj: any = {};
  mockObj.setupPaymentIntent = jest
    .fn()
    .mockResolvedValue({ intent_secret: 'test_secret' });
  mockObj.retrievePaymentMethodData = jest
    .fn()
    .mockResolvedValue(paymentMethodData);
  mockObj.submitCustom = jest.fn().mockResolvedValue({});
  mockObj.createPayment = jest
    .fn()
    .mockResolvedValue({ intent_secret: 'payment_intent_secret' });
  mockObj.createCheckoutSession = jest.fn().mockResolvedValue({
    checkout_url: 'mock_checkout_url'
  });

  return mockObj;
};

describe('Stripe integration helper', () => {
  describe('getFlatStripeCustomerFieldValues', () => {
    it('retrieves only customer fields', () => {
      const result = getFlatStripeCustomerFieldValues(mockStripeConfig());
      expect(result).toStrictEqual({
        'customer-name': 'customer name value',
        'customer-description-hidden': 'customer description',
        addr_country: 'customer address country',
        ship_line1: 'customer shipping line 1'
      });
    });
  });
  describe('getPaymentsReservedFieldValues', () => {
    it('retrieves feathery.payments.selections', () => {
      const result = getPaymentsReservedFieldValues();
      expect(result).toStrictEqual({
        'feathery.payments.selections': mockCartSelections
      });
    });
  });

  describe('setupPaymentMethod', () => {
    const mockTargetElement = {};

    it('returns null if no card element', async () => {
      const mockClient = {};
      const mockFormattedFields = {};
      const mockUpdateFieldValues = jest.fn();

      // act
      const result = await setupPaymentMethod(
        {
          pmField: mockPmNotFilledField,
          client: mockClient,
          formattedFields: mockFormattedFields,
          updateFieldValues: mockUpdateFieldValues,
          integrationData: mockStripeConfig(),
          targetElement: mockTargetElement
        },
        true,
        _mockStripe()
      );

      // Assert
      expect(result).toBeNull();
    });
    it('returns payment method data', async () => {
      const mockClient = _mockClient();
      const mockFormattedFields: Record<string, any> = {};
      mockFormattedFields[mockServar.key] = { value: { complete: true } };
      const mockUpdateFieldValues = jest.fn();

      const mockStripe = _mockStripe();

      // act
      const result = await setupPaymentMethod(
        {
          pmField: mockPmField,
          client: mockClient,
          formattedFields: mockFormattedFields,
          updateFieldValues: mockUpdateFieldValues,
          integrationData: mockStripeConfig(),
          targetElement: mockTargetElement
        },
        true,
        mockStripe
      );

      // Assert
      expect(mockClient.setupPaymentIntent).toHaveBeenCalled();
      expect(mockStripe.confirmCardSetup).toHaveBeenCalled();
      expect(mockClient.retrievePaymentMethodData).toHaveBeenCalled();
      expect(mockUpdateFieldValues).toHaveBeenCalled();
      expect(result).toBeNull();
      expect(mockFormattedFields[mockServar.key].value).toEqual(
        paymentMethodData
      );
    });
  });

  describe('cart functions', () => {
    const mockProdId = 'stripe-prod-1';
    const mockProdId2 = 'stripe-prod-2';
    const mockProdIdNew = 'stripe-prod-new';
    const mockAction = () => ({
      type: 'add_to_cart',
      product_id: mockProdId,
      quantity_field: 'payment_product_1_quantity',
      toggle: true,
      clear_cart: true
    });

    beforeEach(() => {
      fieldValues['feathery.payments.selections'] = {
        'stripe-prod-1': 1,
        'stripe-prod-2': 2
      };
    });
    describe('addToCart', () => {
      it('adds to cart', () => {
        // arrange
        const _mockAction = mockAction();
        _mockAction.product_id = mockProdIdNew;
        _mockAction.toggle = false;
        _mockAction.clear_cart = false;
        const mockUpdateFieldValues = jest.fn();

        // act
        const cartSelections = addToCart(_mockAction, mockUpdateFieldValues);

        // Assert
        // expect cartSelections to not be null
        expect(cartSelections).not.toBeNull();
        if (cartSelections) {
          expect(cartSelections[mockProdId]).toEqual(1);
          expect(cartSelections[mockProdId2]).toEqual(2);
          expect(cartSelections[mockProdIdNew]).toEqual(1);
        }
      });
      it('toggles off a selection', () => {
        const mockUpdateFieldValues = jest.fn();

        // arrange
        const _mockAction = mockAction();
        _mockAction.clear_cart = false;
        // act
        const cartSelections = addToCart(_mockAction, mockUpdateFieldValues);

        // Assert
        expect(cartSelections).not.toBeNull();
        if (cartSelections) {
          // expect cartSelections[mockProdId] to be undefined
          expect(cartSelections[mockProdId]).toBeUndefined();
          expect(cartSelections[mockProdId2]).toEqual(2);
        }
      });
      it('toggles off and clears cart', () => {
        const mockUpdateFieldValues = jest.fn();

        // act
        const cartSelections = addToCart(mockAction(), mockUpdateFieldValues);

        // Assert
        expect(cartSelections).toBeNull();
      });
    });
    describe('removeFromCart', () => {
      it('removes from cart', () => {
        const mockUpdateFieldValues = jest.fn();

        // arrange
        const _mockAction = mockAction();
        _mockAction.product_id = mockProdId;
        _mockAction.clear_cart = false;

        // act
        const cartSelections = removeFromCart(
          _mockAction,
          mockUpdateFieldValues
        );

        // Assert
        expect(cartSelections).not.toBeNull();
        if (cartSelections) {
          // expect cartSelections[mockProdId] to be undefined
          expect(cartSelections[mockProdId]).toBeUndefined();
          expect(cartSelections[mockProdId2]).toEqual(2);
        }
      });
      it('clears cart', () => {
        const mockUpdateFieldValues = jest.fn();
        // act
        const cartSelections = removeFromCart(
          mockAction(),
          mockUpdateFieldValues
        );

        // Assert
        expect(cartSelections).toBeNull();
      });
    });
  });

  describe('purchaseProducts', () => {
    delete featheryWindow().location;
    featheryWindow().location = {}; // get rid of jest warning

    const buttonId = 'button_id';
    const successUrl = 'http://www.example.com';
    const cancelUrl = 'http://www.example.com';
    const mockButton = {
      id: buttonId,
      properties: {
        actions: [
          {
            success_url: successUrl,
            cancel_url: cancelUrl,
            type: 'purchase_products'
          }
        ]
      }
    };

    it('sets up payment method for a card element', async () => {
      const mockTargetElement = {};

      const mockFormattedFields: Record<string, any> = {};
      mockFormattedFields[mockServar.key] = { value: { complete: true } };
      const mockUpdateFieldValues = jest.fn();

      const mockClient = _mockClient();
      const mockStripe = _mockStripe();

      // act
      await purchaseCart(
        {
          pmField: mockPmField,
          client: mockClient,
          formattedFields: mockFormattedFields,
          updateFieldValues: mockUpdateFieldValues,
          integrationData: mockStripeConfig(),
          targetElement: mockTargetElement,
          triggerElement: mockButton,
          triggerElementType: 'button'
        },
        mockStripe
      );

      // Assert
      expect(mockClient.setupPaymentIntent).toHaveBeenCalled();
      expect(mockStripe.confirmCardSetup).toHaveBeenCalled();
      expect(mockClient.retrievePaymentMethodData).toHaveBeenCalled();
    });
    it('does a custom (in Feathery) payment with no payment/card setup', async () => {
      const mockClient = _mockClient();
      const mockStripe = _mockStripe();

      const mockUpdateFieldValues = jest.fn();

      // act
      const result = await purchaseCart(
        {
          client: mockClient,
          formattedFields: mockFormattedFieldValues,
          updateFieldValues: mockUpdateFieldValues,
          integrationData: mockStripeConfig('custom'),
          triggerElement: mockButton,
          triggerElementType: 'button'
        },
        mockStripe
      );

      // Assert
      expect(mockClient.createPayment).toHaveBeenCalled();
      expect(mockUpdateFieldValues).toHaveBeenCalled();
      expect(result).toBeNull();
    });
    it('does a stripe checkout', async () => {
      const mockClient = _mockClient();
      const mockStripe = _mockStripe();

      const mockUpdateFieldValues = jest.fn();

      // act
      const result = await purchaseCart(
        {
          client: mockClient,
          formattedFields: mockFormattedFieldValues,
          updateFieldValues: mockUpdateFieldValues,
          integrationData: mockStripeConfig('stripe'),
          triggerElement: mockButton,
          triggerElementType: 'button'
        },
        mockStripe
      );

      // Assert
      expect(mockClient.createCheckoutSession).toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });
});
