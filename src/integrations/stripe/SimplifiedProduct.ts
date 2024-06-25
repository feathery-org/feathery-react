import {
  addToCart,
  calculateLineItemCost,
  Price,
  Product as StripeProductProductCacheItem,
  removeFromCart,
  StripeConfig
} from './stripe';
import { fieldValues } from '../../utils/init';
import { FEATHERY_CART } from './';
import { formatDecimal, formatMoney } from '../../utils/primitives';

export default class SimplifiedProduct {
  _id = '';
  _productPriceCacheItem: StripeProductProductCacheItem;
  _defaultPrice: Price | undefined;
  _mode: 'live' | 'test';
  _updateFieldValues: any;
  _stripeConfig: StripeConfig;
  _client: any;

  constructor(
    id: string,
    productPriceCacheItem: StripeProductProductCacheItem,
    mode: 'live' | 'test',
    updateFieldValues: any,
    stripeConfig: StripeConfig,
    client: any
  ) {
    this._id = id;
    this._productPriceCacheItem = productPriceCacheItem;
    this._defaultPrice = getDefaultPrice(productPriceCacheItem);
    this._mode = mode;
    this._updateFieldValues = updateFieldValues;
    this._stripeConfig = stripeConfig;
    this._client = client;
  }

  get id(): string {
    return this._id;
  }

  // getter for name comes from the product price cache item name property
  get name(): string {
    return this._productPriceCacheItem.name;
  }

  get description(): string {
    return this._productPriceCacheItem.description;
  }

  get active(): boolean {
    return this._productPriceCacheItem.active;
  }

  get price() {
    return formatDecimal((this._defaultPrice?.unit_amount ?? 0) / 100, 2);
  }

  get price_formatted() {
    return formatMoney(
      (this._defaultPrice?.unit_amount ?? 0) / 100,
      this._defaultPrice?.currency
    );
  }

  get currency(): string {
    return this._defaultPrice?.currency ?? '';
  }

  get subscription_interval(): string {
    const intervals: any = {
      day: 'Daily',
      week: 'Weekly',
      month: 'Monthly',
      year: 'Yearly'
    };
    let subscriptionInterval = 'One-Time';
    if (this._defaultPrice?.type === 'recurring') {
      subscriptionInterval =
        intervals[this._defaultPrice?.recurring_interval ?? ''] ?? '';
    }
    return subscriptionInterval;
  }

  get pricing_type(): string {
    const tieredTypes: any = {
      graduated: 'tiered - graduated',
      volume: 'tiered - volume'
    };
    let pricingType = 'flat-rate';
    if (this._defaultPrice?.billing_scheme === 'per_unit') {
      if ((this._defaultPrice?.per_unit_units ?? 1) > 1)
        pricingType = `per ${this._defaultPrice?.per_unit_units} units`;
    } else
      pricingType = tieredTypes[this._defaultPrice?.tiers_mode ?? ''] ?? '';

    return pricingType;
  }

  get recurring_billing_type(): string {
    const recurringUsageTypes: any = {
      licensed: 'licensed (in advance)',
      metered: 'metered (in arrears)'
    };
    return (
      recurringUsageTypes[this._defaultPrice?.recurring_usage_type ?? ''] ?? ''
    );
  }

  get mode(): string {
    return this._mode;
  }

  getCartQuantity(): number {
    return (fieldValues[FEATHERY_CART] ?? ({} as any))[this.id] ?? 0;
  }

  get cart_quantity() {
    return formatDecimal(this.getCartQuantity(), 2);
  }

  get cart_subtotal() {
    return calculateLineItemCost(
      this._productPriceCacheItem,
      this.getCartQuantity(),
      true
    ).getValue();
  }

  get cart_subtotal_formatted() {
    return formatMoney(
      calculateLineItemCost(
        this._productPriceCacheItem,
        this.getCartQuantity(),
        true
      ).getValue() as unknown as number,
      this._defaultPrice?.currency
    );
  }

  /**
   * Add this product to the cart
   * @param quantity
   * @param replace
   * @returns
   */
  addToCart(quantity: number, replace = true) {
    const newCartSelections = addToCart(
      {
        product_id: this._id,
        fixed_quantity: quantity,
        toggle: false,
        clear_cart: false,
        add_to_quantity: !replace
      },
      this._updateFieldValues,
      this._stripeConfig,
      this._client
    );
    return { ...newCartSelections };
  }

  removeFromCart() {
    const newCartSelections = removeFromCart(
      {
        product_id: this._id,
        clear_cart: false
      },
      this._updateFieldValues,
      this._stripeConfig,
      this._client
    );
    return { ...newCartSelections };
  }
}

export function getDefaultPrice(
  productPriceCacheItem: StripeProductProductCacheItem
): Price | undefined {
  let priceObj: Price | undefined;
  if (productPriceCacheItem?.default_price) {
    // find the price with the default price id
    priceObj = productPriceCacheItem.prices.find(
      (price) => price.id === productPriceCacheItem.default_price
    );
  }
  if (!priceObj && productPriceCacheItem?.prices.length > 0)
    priceObj = productPriceCacheItem.prices[0];
  return priceObj;
}
