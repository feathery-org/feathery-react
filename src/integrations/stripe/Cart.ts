import { fieldValues } from '../../utils/init';
import { FEATHERY_CART, FEATHERY_CART_TOTAL, Price, Product } from './';
import { formatDecimal, formatMoney } from '../../utils/primitives';

export default class Cart {
  _productPriceCacheConfig;
  constructor(productPriceCacheConfig: { [key: string]: Product }) {
    this._productPriceCacheConfig = productPriceCacheConfig;
  }

  // more properties and methods will be here in future releases

  get total() {
    return formatDecimal((fieldValues[FEATHERY_CART_TOTAL] as number) ?? 0, 2);
  }

  get total_formatted(): string {
    // determine the currency from the first item in the cart
    // If no items, then no currency symbol
    let currency;
    const cart = fieldValues[FEATHERY_CART] ?? {};
    const cartIds = Object.keys(cart);
    if (Object.keys(cartIds).length > 0) {
      let priceObj: Price | undefined;
      const firstProductCacheItem = this._productPriceCacheConfig[cartIds[0]];
      if (firstProductCacheItem.default_price) {
        // find the price with the default price id
        priceObj = firstProductCacheItem.prices.find(
          (price) => price.id === firstProductCacheItem.default_price
        );
      }
      if (!priceObj && firstProductCacheItem.prices.length > 0)
        priceObj = firstProductCacheItem.prices[0];

      currency = priceObj?.currency;
    }

    const total = (fieldValues[FEATHERY_CART_TOTAL] as number) ?? 0;
    return currency ? formatMoney(total, currency) : formatDecimal(total, 2);
  }
}
