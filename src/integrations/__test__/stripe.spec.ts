import { featheryWindow } from '../../utils/browser';
import {
  setupPaymentMethod,
  purchaseCart,
  getFlatStripeCustomerFieldValues,
  getPaymentsReservedFieldValues,
  addToCart,
  removeFromCart,
  Product,
  calculateSelectedProductsTotal,
  calculateLineItemCost
} from '../stripe';
import { fieldValues } from '../../utils/init';
import BigDecimal from 'js-big-decimal';

const mockStripeConfig = (
  checkoutType: 'custom' | 'stripe' = 'custom',
  products: { [key: string]: Product } = {}
) => ({
  metadata: {
    test: { product_price_cache: products },
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
    'feathery.cart': {
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
    it('retrieves feathery.cart', () => {
      const result = getPaymentsReservedFieldValues();
      expect(result).toStrictEqual({
        'feathery.cart': mockCartSelections
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
      fixed_quantity: 0,
      add_to_quantity: false,
      toggle: true,
      clear_cart: true
    });

    beforeEach(() => {
      fieldValues['feathery.cart'] = {
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
        const mockUpdateFieldValues = jest.fn();

        // act
        const cartSelections = addToCart(
          _mockAction,
          mockUpdateFieldValues,
          mockStripeConfig()
        );

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
        // act
        const cartSelections = addToCart(
          _mockAction,
          mockUpdateFieldValues,
          mockStripeConfig()
        );

        // Assert
        expect(cartSelections).not.toBeNull();
        if (cartSelections) {
          // expect cartSelections[mockProdId] to be undefined
          expect(cartSelections[mockProdId]).toBeUndefined();
          expect(cartSelections[mockProdId2]).toEqual(2);
        }
      });
      it('increments quantity in cart', () => {
        // arrange
        const _mockAction = mockAction();
        _mockAction.product_id = mockProdIdNew;
        _mockAction.toggle = false;
        const _mockFixedQuantityAction = mockAction();
        _mockFixedQuantityAction.product_id = mockProdIdNew;
        _mockFixedQuantityAction.fixed_quantity = 2;
        _mockFixedQuantityAction.quantity_field = '';
        _mockFixedQuantityAction.add_to_quantity = true;
        _mockFixedQuantityAction.toggle = false;
        const mockUpdateFieldValues = jest.fn();

        // act
        addToCart(_mockAction, mockUpdateFieldValues, mockStripeConfig());
        // now increment it by 2
        const cartSelections = addToCart(
          _mockFixedQuantityAction,
          mockUpdateFieldValues,
          mockStripeConfig()
        );

        // Assert
        // expect cartSelections to not be null
        expect(cartSelections).not.toBeNull();
        if (cartSelections) {
          expect(cartSelections[mockProdId]).toEqual(1);
          expect(cartSelections[mockProdId2]).toEqual(2);
          expect(cartSelections[mockProdIdNew]).toEqual(3);
        }
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
          mockUpdateFieldValues,
          mockStripeConfig()
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
          mockUpdateFieldValues,
          mockStripeConfig()
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

  describe('purchase cost calculation', () => {
    const prodId1 = 'prod_NDu5phIipHaZqZ';
    const prodId2 = 'prod_MLwEIkqFPLtINN';
    const mockProdId = 'stripe-prod-1';
    const mockProdId2 = 'stripe-prod-2';

    const prodIdPackage = 'prod_package';
    const prodIdPackage2 = 'prod_package2';
    const prodIdTieredGraduated = 'prod_graduated';
    const prodIdTieredVolume = 'prod_volume';

    const products: { [key: string]: Product } = {
      [prodId1]: {
        id: prodId1,
        name: 'Product 1',
        description: 'Product 1 description',
        active: true,
        default_price: 'price_1MTSHfI26OLuOvXi5e1fCOx4',
        prices: [
          {
            id: 'price_1MTSHfI26OLuOvXi5e1fCOx4',
            type: 'recurring',
            recurring_interval: 'month',
            recurring_usage_type: 'licensed',
            billing_scheme: 'per_unit',
            unit_amount: 1200,
            per_unit_units: 1,
            per_unit_rounding: 'up'
          }
        ]
      },
      [prodId2]: {
        id: prodId2,
        name: 'Product 2',
        description: 'Product 2 description',
        active: true,
        default_price: 'price_1LdEMPI26OLuOvXiizpd23RP',
        prices: [
          {
            id: 'price_1LdEMPI26OLuOvXiizpd23RP',
            type: 'recurring',
            recurring_interval: 'month',
            recurring_usage_type: 'licensed',
            billing_scheme: 'per_unit',
            unit_amount: 2250,
            per_unit_units: 1,
            per_unit_rounding: 'up'
          }
        ]
      },
      [mockProdId]: {
        id: mockProdId,
        name: 'Mock Product 1',
        description: 'Mock Product 1 description',
        active: true,
        default_price: 'price_1LdH0QI26OLuOvXiVE7PCOKa',
        prices: [
          {
            id: 'price_1LdH0QI26OLuOvXiVE7PCOKa',
            type: 'one_time',
            billing_scheme: 'per_unit',
            unit_amount: 90000,
            per_unit_units: 1,
            per_unit_rounding: 'up'
          }
        ]
      },
      [mockProdId2]: {
        id: mockProdId2,
        name: 'Mock Product 2',
        description: 'Mock Product 2 description',
        active: true,
        default_price: 'price_2LdH0QI26dfkklfdgdflkdfj',
        prices: [
          {
            id: 'price_2LdH0QI26dfkklfdgdflkdfj',
            type: 'one_time',
            billing_scheme: 'per_unit',
            unit_amount: 30000,
            per_unit_units: 1,
            per_unit_rounding: 'up'
          }
        ]
      },
      [prodIdPackage]: {
        id: prodIdPackage,
        name: 'Package 1',
        description: 'Package 1 description',
        active: true,
        default_price: 'price_package',
        prices: [
          {
            id: 'price_package',
            type: 'one_time',
            billing_scheme: 'per_unit',
            unit_amount: 4200,
            per_unit_units: 11,
            per_unit_rounding: 'up'
          }
        ]
      },
      [prodIdPackage2]: {
        id: prodIdPackage2,
        name: 'Package 2',
        description: 'Package 2 description',
        active: true,
        default_price: 'price_package2',
        prices: [
          {
            id: 'price_package2',
            type: 'one_time',
            billing_scheme: 'per_unit',
            unit_amount: 4200,
            per_unit_units: 11,
            per_unit_rounding: 'down'
          }
        ]
      },
      [prodIdTieredGraduated]: {
        id: prodIdTieredGraduated,
        name: 'Tier 1',
        description: 'Tier 1 description',
        active: true,
        default_price: 'price_graduated',
        prices: [
          {
            id: 'price_graduated',
            type: 'one_time',
            billing_scheme: 'tiered',
            tiers_mode: 'graduated',
            tiers: [
              {
                up_to: 10,
                unit_amount: 1000,
                flat_amount: 10000
              },
              {
                up_to: 20,
                unit_amount: 500,
                flat_amount: 5000
              },
              {
                up_to: null,
                unit_amount: 100
              }
            ]
          }
        ]
      },
      [prodIdTieredVolume]: {
        id: prodIdTieredVolume,
        name: 'Tier 2',
        description: 'Tier 2 description',
        active: true,
        default_price: 'price_volume',
        prices: [
          {
            id: 'price_volume',
            type: 'one_time',
            billing_scheme: 'tiered',
            tiers_mode: 'volume',
            tiers: [
              {
                up_to: 10,
                unit_amount: 1000,
                flat_amount: 10000
              },
              {
                up_to: 20,
                unit_amount: 500,
                flat_amount: 5000
              },
              {
                up_to: null,
                unit_amount: 100
              }
            ]
          }
        ]
      }
    };

    describe('calculateLineItemCost', () => {
      it('ignore invalid product id', () => {
        expect(
          calculateLineItemCost(
            mockStripeConfig('stripe', products).metadata.test
              .product_price_cache.invalid,
            1
          )
        ).toStrictEqual(new BigDecimal(0));
      });
      it('per-unit, non-packaged - testing round up', () => {
        expect(
          calculateLineItemCost(
            mockStripeConfig('stripe', products).metadata.test
              .product_price_cache[prodIdPackage],
            10
          )
        ).toStrictEqual(new BigDecimal(382 * 10));
      });
      it('per-unit, non-packaged - testing round down', () => {
        expect(
          calculateLineItemCost(
            mockStripeConfig('stripe', products).metadata.test
              .product_price_cache[prodIdPackage2],
            10
          )
        ).toStrictEqual(new BigDecimal(381 * 10));
      });
      it('tiered, graduated, with tier flat pricing', () => {
        expect(
          calculateLineItemCost(
            mockStripeConfig('stripe', products).metadata.test
              .product_price_cache[prodIdTieredGraduated],
            32
          )
        ).toStrictEqual(
          new BigDecimal(1000 * 10 + 10000 + (500 * 10 + 5000) + 100 * 12)
        );
      });
      it('tiered, graduated, with tier flat pricing, falls into second tier only', () => {
        expect(
          calculateLineItemCost(
            mockStripeConfig('stripe', products).metadata.test
              .product_price_cache[prodIdTieredGraduated],
            12
          )
        ).toStrictEqual(new BigDecimal(1000 * 10 + 10000 + (500 * 2 + 5000)));
      });
      it('tiered, VOLUME, with flat pricing', () => {
        expect(
          calculateLineItemCost(
            mockStripeConfig('stripe', products).metadata.test
              .product_price_cache[prodIdTieredVolume],
            18
          )
        ).toStrictEqual(new BigDecimal(500 * 18 + 5000));
      });
    });
    describe('calculateSelectedProductsTotal', () => {
      beforeEach(() => {
        fieldValues['feathery.cart'] = {
          'stripe-prod-1': 1,
          'stripe-prod-2': 2
        };
      });

      it('calculates a total', () => {
        const mockUpdateFieldValues = jest.fn();
        expect(
          calculateSelectedProductsTotal(
            mockStripeConfig('stripe', products),
            mockUpdateFieldValues
          )
        ).toBe('1500.00');
      });
    });
  });
});
