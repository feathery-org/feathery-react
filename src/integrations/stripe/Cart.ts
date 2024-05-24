import { fieldValues } from '../../utils/init';
import {
  addToCart,
  calculateLineItemCost,
  FEATHERY_CART,
  FEATHERY_CART_TOTAL,
  Price,
  removeFromCart,
  StripeConfig
} from './';
import { formatDecimal, formatMoney } from '../../utils/primitives';
import { getDefaultPrice } from './SimplifiedProduct';

class CartItem {
  _id: string;
  _quantity: number;
  _productPriceCacheConfig: any;
  constructor(id: string, quantity: number, productPriceCacheConfig: any) {
    this._id = id;
    this._quantity = quantity;
    this._productPriceCacheConfig = productPriceCacheConfig;
  }

  get id() {
    return this._id;
  }

  get name() {
    return this._productPriceCacheConfig[this._id].name;
  }

  _getPrice() {
    return (
      (getDefaultPrice(this._productPriceCacheConfig[this._id])?.unit_amount ??
        0) / 100
    );
  }

  get price() {
    return formatDecimal(this._getPrice(), 2);
  }

  get price_formatted() {
    return formatMoney(
      this._getPrice(),
      getDefaultPrice(this._productPriceCacheConfig[this._id])?.currency
    );
  }

  get quantity() {
    return this._quantity;
  }

  _getSubtotal() {
    return calculateLineItemCost(
      this._productPriceCacheConfig[this._id],
      this._quantity,
      true
    ).getValue();
  }

  get subtotal() {
    return calculateLineItemCost(
      this._productPriceCacheConfig[this._id],
      this._quantity,
      true
    ).getValue();
  }

  get subtotal_formatted() {
    return formatMoney(
      this.subtotal as unknown as number,
      getDefaultPrice(this._productPriceCacheConfig[this._id])?.currency
    );
  }
}

export default class Cart {
  _productPriceCacheConfig;
  _updateFieldValues: any;
  _stripeConfig: StripeConfig;

  constructor(updateFieldValues: any, stripeConfig: StripeConfig) {
    this._productPriceCacheConfig = {
      ...(stripeConfig?.metadata.live?.product_price_cache ?? {}),
      ...(stripeConfig?.metadata.test?.product_price_cache ?? {})
    };
    this._updateFieldValues = updateFieldValues;
    this._stripeConfig = stripeConfig;
  }

  get items() {
    return Object.entries(fieldValues[FEATHERY_CART] ?? {}).reduce(
      (items: any, [id, quantity]) => {
        items[id] = new CartItem(id, quantity, this._productPriceCacheConfig);
        return items;
      },
      {}
    );
  }

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

  addProductToCart(productId: string, quantity: number, replace = true) {
    const newCartSelections = addToCart(
      {
        product_id: productId,
        fixed_quantity: quantity,
        toggle: false,
        clear_cart: false,
        add_to_quantity: !replace
      },
      this._updateFieldValues,
      this._stripeConfig
    );
    return { ...newCartSelections };
  }

  removeProductFromCart(productId: string) {
    const newCartSelections = removeFromCart(
      {
        product_id: productId,
        clear_cart: false
      },
      this._updateFieldValues,
      this._stripeConfig
    );
    return { ...newCartSelections };
  }
}
