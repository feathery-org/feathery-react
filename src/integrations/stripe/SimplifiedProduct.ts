import {
  calculateLineItemCost,
  Price,
  Product as StripeProductProductCacheItem
} from './stripe';
import { fieldValues } from '../../utils/init';
import { FEATHERY_CART } from './';
import { formatDecimal, formatMoney } from '../../utils/primitives';

export default class SimplifiedProduct {
  _id = '';
  _productPriceCacheItem: StripeProductProductCacheItem;
  _defaultPrice: Price | undefined;
  _mode: 'live' | 'test';

  constructor(
    id: string,
    productPriceCacheItem: StripeProductProductCacheItem,
    mode: 'live' | 'test'
  ) {
    this._id = id;
    this._productPriceCacheItem = productPriceCacheItem;
    this._defaultPrice = this.getDefaultPrice();
    this._mode = mode;
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
      day: 'Dayly',
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

  get mode(): string {
    return this._mode;
  }

  getCartQuantity(): number {
    return (fieldValues[FEATHERY_CART] ?? ({} as any))[this.id] ?? 0;
  }

  get cart_quantity() {
    return formatDecimal(this.getCartQuantity(), 2);
  }

  get cart_quantity_formatted() {
    return formatMoney(this.getCartQuantity(), this._defaultPrice?.currency);
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

  getDefaultPrice(): Price | undefined {
    let priceObj: Price | undefined;
    if (this._productPriceCacheItem?.default_price) {
      // find the price with the default price id
      priceObj = this._productPriceCacheItem.prices.find(
        (price) => price.id === this._productPriceCacheItem.default_price
      );
    }
    if (!priceObj && this._productPriceCacheItem.prices.length > 0)
      priceObj = this._productPriceCacheItem.prices[0];
    return priceObj;
  }
}
