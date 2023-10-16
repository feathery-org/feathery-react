import { loadStripe } from '@stripe/stripe-js/pure';
import { useState } from 'react';
import {
  runningInClient,
  featheryDoc,
  featheryWindow
} from '../../utils/browser';
import { ActionData } from '../utils';
import SimplifiedProduct from './SimplifiedProduct';
import Cart from './Cart';
import { fieldValues, initState } from '../../utils/init';
import { ACTION_PURCHASE_PRODUCTS } from '../../utils/elementActions';
import BigDecimal from 'js-big-decimal';

const stripePromise = new Promise((resolve) => {
  if (runningInClient())
    featheryDoc().addEventListener('stripe_key_loaded', (e: any) => {
      const promise = loadStripe((e as any).detail.key);
      promise.then((stripe) => {
        resolve(stripe);
      });
    });
});

export const getStripe = () => stripePromise;

export function installStripe(stripeConfig: any) {
  const metadata = stripeConfig?.metadata;
  if (metadata) {
    // eslint-disable-next-line camelcase
    if (metadata.client_key) {
      featheryDoc().dispatchEvent(
        new CustomEvent('stripe_key_loaded', {
          detail: { key: stripeConfig.metadata.client_key }
        })
      );
    }
  }
  return Promise.resolve();
}

// Returns mapping of servar key (or hidden field key) to value
export function getFlatStripeCustomerFieldValues(stripeConfig: any) {
  if (!stripeConfig?.metadata?.customer_field_mappings) return {};
  return getObjectMappingValues(stripeConfig.metadata.customer_field_mappings);
}
function getObjectMappingValues(mappingObj: any) {
  return Object.values(mappingObj).reduce((result: any, mappingInfo) => {
    if (typeof mappingInfo === 'string') {
      const key = mappingInfo;
      if (key in fieldValues) result[key] = fieldValues[key];
    }
    // sub-object
    else if (typeof mappingInfo === 'object') {
      result = {
        ...result,
        ...(getObjectMappingValues(mappingInfo) as {
          [key: string]: any;
        })
      };
    }
    return result;
  }, {} as { [key: string]: any });
}

export const FEATHERY_CART = 'feathery.cart';
export const FEATHERY_CART_TOTAL = 'feathery.cart.total';

export function getPaymentsReservedFieldValues() {
  return Object.entries(fieldValues).reduce((result, [key, value]) => {
    if (key.startsWith('feathery.cart')) {
      result[key] = value;
    }
    return result;
  }, {} as { [key: string]: any });
}

async function syncStripeFieldChanges(client: any, integrationData: any) {
  // Need to update the backend with any customer field values that might be on
  // the current step.
  const stepCustomerFieldValues: any =
    getFlatStripeCustomerFieldValues(integrationData);
  // payment reserved fields
  const paymentsReservedFieldValues = getPaymentsReservedFieldValues();
  const fieldValuesToSubmit = {
    ...stepCustomerFieldValues,
    ...paymentsReservedFieldValues
  };
  if (Object.keys(fieldValuesToSubmit).length) {
    await client.submitCustom(fieldValuesToSubmit);
  }
}

/**
 * Used to set up a payment method.
 */
export async function setupPaymentMethod(
  {
    pmField,
    client,
    formattedFields,
    updateFieldValues,
    integrationData,
    targetElement
  }: ActionData,
  syncFields = true,
  stripePromise = null
) {
  const { servar } = pmField;
  if ((fieldValues[servar.key] as any)?.complete) {
    try {
      const stripe: any = await (stripePromise ?? getStripe());

      // sync fields to BE
      if (syncFields) await syncStripeFieldChanges(client, integrationData);

      // Payment method setup
      const { intent_secret: intentSecret } = await client.setupPaymentIntent(
        servar.key
      );

      const result = await (stripe as any).confirmCardSetup(intentSecret, {
        payment_method: {
          card: targetElement
          // Not supplying billing details for now but we could later if needed...
          // billing_details: { email }
        }
      });
      if (result.error)
        return {
          errorField: pmField,
          errorMessage: result.error.message
        };
      else {
        const paymentMethodId = result.setupIntent.payment_method;
        const paymentMethodData = await client.retrievePaymentMethodData(
          servar.key,
          paymentMethodId
        );
        // Got data for the payment method field, set it on the field
        updateFieldValues({
          [servar.key]: Object.assign(
            fieldValues[servar.key] ?? {},
            paymentMethodData
          )
        });
        if (formattedFields) {
          formattedFields[servar.key] = {
            value: paymentMethodData,
            type: servar.type,
            displayText: servar.name
          };
        }
      }
    } catch (e) {
      return {
        errorField: pmField,
        errorMessage: e instanceof Error ? e.message : ''
      };
    }
  }
  return null;
}

interface PaymentAction {
  product_id: string;
  quantity_field?: string; // resolved servar key or hidden field key
  fixed_quantity?: number;
  toggle?: boolean;
  clear_cart: boolean;
  success_url?: string;
  cancel_url?: string;
}

// get the cart selections from fields values object key feathery.cart
function getCartSelections(): Record<string, number> {
  return (
    (fieldValues[FEATHERY_CART] as Record<string, number>) ??
    ({} as Record<string, number>)
  );
}
// save the cart selections into fields values object key feathery.cart
function saveCartSelections(
  cartSelections: Record<string, number> | null,
  updateFieldValues: any
) {
  updateFieldValues({ [FEATHERY_CART]: cartSelections });
}

/**
 * Determines if a product is in the cart selections with a quantity greater than 0
 * @param productId
 * @returns
 */
export function isProductInPurchaseSelections(productId: string) {
  const cartSelections = getCartSelections();
  return cartSelections[productId] && cartSelections[productId] > 0;
}

interface PricingTier {
  up_to: number | null;
  unit_amount?: number;
  flat_amount?: number;
}
type PRICE_TYPE = 'one_time' | 'recurring';
export interface Price {
  id: string;
  currency?: string;
  type: PRICE_TYPE;
  recurring_interval?: 'month' | 'year' | 'week' | 'day' | null | '';
  recurring_usage_type?: 'licensed' | 'metered';
  billing_scheme: 'per_unit' | 'tiered';
  unit_amount?: number;
  per_unit_units?: number;
  per_unit_rounding?: 'up' | 'down';
  tiers_mode?: 'graduated' | 'volume';
  tiers?: PricingTier[];
}
export interface Product {
  id: string;
  name: string;
  description: string;
  active: boolean;
  default_price: string;
  prices: Price[];
}

export interface ProductPriceCacheConfig {
  product_price_cache: { [key: string]: Product };
}

interface StripeConfig {
  metadata: {
    test?: ProductPriceCacheConfig;
    live?: ProductPriceCacheConfig;
  };
}

export function getCart(stripeConfig: StripeConfig) {
  const allProductsPriceCache = {
    ...(stripeConfig?.metadata.live?.product_price_cache ?? {}),
    ...(stripeConfig?.metadata.test?.product_price_cache ?? {})
  };

  return new Cart(allProductsPriceCache);
}
export function getSimplifiedProducts(
  stripeConfig: StripeConfig
): Record<string, any> {
  const liveProductsPriceCache =
    stripeConfig?.metadata.live?.product_price_cache ?? {};
  const testProductsPriceCache =
    stripeConfig?.metadata.test?.product_price_cache ?? {};

  const products: Record<string, SimplifiedProduct> = {};
  Object.values(testProductsPriceCache).forEach((product: any) => {
    products[product.id] = new SimplifiedProduct(product.id, product, 'test');
  });
  Object.values(liveProductsPriceCache).forEach((product: any) => {
    products[product.id] = new SimplifiedProduct(product.id, product, 'live');
  });

  return products;
}

// Dynamically use the live or test product id based on the environment
// (test or live).  If live/test products have the same name
// then use the apropriate one based on the initState.isTestEnv.
function getLiveOrTestProduct(
  productId: string,
  stripeConfig: StripeConfig
): string {
  // Find the productId in the live or test product price cache and
  // if a product with the same name is found in the test/live cache as indicated
  // by initState.isTestEnv, then return that product id instead.
  // Otherwise, return the original productId.
  const liveProductsPriceCache =
    stripeConfig.metadata.live?.product_price_cache ?? {};
  const testProductsPriceCache =
    stripeConfig.metadata.test?.product_price_cache ?? {};
  const allProductsPriceCache = {
    ...liveProductsPriceCache,
    ...testProductsPriceCache
  };
  const targetCache = !initState?.isTestEnv // initState is undefined in unit test env
    ? liveProductsPriceCache
    : testProductsPriceCache;
  const product = allProductsPriceCache[productId];
  if (product) {
    const { name } = product;
    // find products with the same name in the target cache
    // If find more than one, stick with the one you have the id for because there
    // are naming collisions.  Too many products named the same and
    // we cannot know the user's intent.
    const products = Object.values(targetCache).filter(
      (p) => p.name === name
    ) as Product[];
    if (products.length === 1) {
      return products[0].id;
    }
  }
  return productId;
}

/**
 * Add to cart function
 */
export function addToCart(
  paymentAction: PaymentAction,
  updateFieldValues: any,
  stripeConfig: any
) {
  const {
    product_id: configuredProductId,
    quantity_field: quantityField,
    fixed_quantity: fixedQuantity,
    toggle
  } = paymentAction;

  const productId = getLiveOrTestProduct(configuredProductId, stripeConfig);
  const cartSelections = getCartSelections();
  const currentQuantity = cartSelections[productId] ?? 0;
  if (toggle && currentQuantity > 0) {
    // toggle off
    delete cartSelections[productId];
  } else {
    // toggle on
    let newQty = quantityField
      ? (fieldValues[quantityField] as number) ?? 0
      : fixedQuantity ?? 0;
    // deal with array fields and other possibilities
    if (Array.isArray(newQty)) {
      if (newQty.length > 0) newQty = newQty[0];
      else newQty = 0;
    }
    newQty = newQty > 0 ? newQty : 0;

    // if newQty is 0, remove from cart, otherwise add to cart
    if (newQty) cartSelections[productId] = newQty;
    else delete cartSelections[productId];
  }
  const newCartSelections = Object.keys(cartSelections).length
    ? cartSelections
    : null;
  saveCartSelections(newCartSelections, updateFieldValues);
  calculateSelectedProductsTotal(stripeConfig, updateFieldValues);
  return newCartSelections;
}

/**
 * Remove from cart function.
 * Clear the cart completely if clear_cart is true.
 */
export function removeFromCart(
  paymentAction: PaymentAction,
  updateFieldValues: any,
  stripeConfig: any
) {
  const { product_id: configuredProductId, clear_cart: clearCart } =
    paymentAction;
  const productId = getLiveOrTestProduct(configuredProductId, stripeConfig);

  const cartSelections = getCartSelections();
  if (clearCart) {
    // clear cart
    Object.keys(cartSelections).forEach((key) => {
      delete cartSelections[key];
    });
  } else {
    // remove from cart
    delete cartSelections[productId];
  }
  const newCartSelections = Object.keys(cartSelections).length
    ? cartSelections
    : null;
  saveCartSelections(newCartSelections, updateFieldValues);
  calculateSelectedProductsTotal(stripeConfig, updateFieldValues);
  return newCartSelections;
}

/**
 * Used to either collect payment directly or launch stripe checkout to collect payment.
 */
export async function purchaseCart(
  actionData: ActionData,
  stripePromise = null
) {
  const {
    client,
    triggerElement, // action button that triggered this
    updateFieldValues,
    integrationData: stripeConfig
  } = actionData;

  // sync fields to BE
  await syncStripeFieldChanges(client, stripeConfig);

  // setup any payment method on this step
  if (actionData.targetElement) {
    const payMethodResult = await setupPaymentMethod(
      actionData,
      false,
      stripePromise
    );
    if (payMethodResult) {
      // error
      return payMethodResult;
    }
  }

  // Now collect payment or do stripe checkout
  try {
    await (stripePromise ?? getStripe());
    const checkoutType = stripeConfig.metadata.checkout_type ?? 'custom';

    const purchaseCartAction: PaymentAction =
      triggerElement?.properties?.actions?.find(
        (action: any) => action.type === ACTION_PURCHASE_PRODUCTS
      );

    if (checkoutType === 'stripe') {
      // stripe checkout
      // success url always comes back to the current step so we can handle the payment completion

      // add or replace the _feathery_paid=true parameter in the window location and use as the
      // success url for the stripe checkout
      const { origin, pathname, hash, search } = featheryWindow().location;
      const queryParams = new URLSearchParams(search);
      queryParams.set('_feathery_paid', 'true');
      const successUrl = `${origin}${pathname}?${queryParams}${hash}`;

      // If the cancel url not supplied, default to the current step
      const cancelUrl =
        purchaseCartAction?.cancel_url || featheryWindow().location.href;
      const { checkout_url: checkoutUrl } = await client.createCheckoutSession(
        successUrl,
        cancelUrl
      );
      // preserve browser back button function to current page/step
      checkoutUrl && (featheryWindow().location.href = checkoutUrl);
    } else if (checkoutType === 'custom') {
      // custom payment from Feathery
      const result = await client.createPayment();
      if (result.error)
        return {
          errorField: triggerElement,
          errorMessage: result.error.message
        };
      else {
        const { field_values: newFieldValues } = result;
        // BE is the source of truth here.  Update fieldValues.
        // This will set the any payment indicator field.
        updateFieldValues(newFieldValues ?? {});
        calculateSelectedProductsTotal(stripeConfig, updateFieldValues);
      }
    }
  } catch (e: any) {
    return {
      errorField: triggerElement,
      errorMessage:
        e.payload &&
        Array.isArray(e.payload) &&
        e.payload[0]?.code === 'mixed-recurring'
          ? 'Payment Error: Mixed recurring periods'
          : 'Payment Error'
    };
  }
  return null;
}

export async function checkForPaymentCheckoutCompletion(
  steps: any,
  client: any,
  updateFieldValues: (fieldValues: any) => void,
  integrationData: any
) {
  // check if this is a checkout completion
  const queryParams = new URLSearchParams(featheryWindow().location.search);
  if (queryParams.get('_feathery_paid') === 'true') {
    // remove the _feathery_paid parameter from the url
    queryParams.delete('_feathery_paid');
    const { origin, pathname, hash } = featheryWindow().location;
    const newUrl = `${origin}${pathname}?${queryParams}${hash}`;
    featheryWindow().history.replaceState({}, '', newUrl);

    // search all step buttons and subgrids for the purchase action and complete the payment
    const paymentElement: any = Object.values(steps).reduce(
      (result: any, step: any) => {
        if (result) return result;
        return (
          [...step.buttons, ...step.subgrids].find((element) =>
            element.properties.actions?.find(
              (action: any) => action.type === ACTION_PURCHASE_PRODUCTS
            )
          ) ?? null
        );
      },
      null
    );
    if (paymentElement) {
      // auto clear the cart on successful payment
      saveCartSelections(null, updateFieldValues);
      calculateSelectedProductsTotal(integrationData, updateFieldValues);

      // clearing after successful payment
      const fieldValuesToSubmit: Record<string, any> = {
        [FEATHERY_CART]: {},
        [FEATHERY_CART_TOTAL]: 0
      };

      // Only get here if the stripe checkout payment was successful - set the has_paid mapped field.
      if (integrationData.metadata.payment_field_mappings?.has_paid) {
        updateFieldValues({
          [integrationData.metadata.payment_field_mappings.has_paid]: true
        });
        fieldValuesToSubmit[
          integrationData.metadata.payment_field_mappings.has_paid
        ] = true;
      }

      // sync to BE
      await client.submitCustom(fieldValuesToSubmit);

      if (integrationData.metadata.checkout_type === 'stripe') {
        // redirect to any success url
        const purchaseCartAction: PaymentAction =
          paymentElement?.properties?.actions?.find(
            (action: any) => action.type === ACTION_PURCHASE_PRODUCTS
          );
        if (purchaseCartAction?.success_url)
          // redirect to any success url
          featheryWindow().location.href = purchaseCartAction.success_url;
      }
    }
  }
}

export function usePayments(): [
  (key: string) => any,
  (key: string, cardElement: any) => void
] {
  // Stripe - the card elements on the active step, if any
  const [cardElementMappings, setCardElementMappings] = useState({});

  const setCardElement = (key: any, cardElement: any) => {
    setCardElementMappings((cardElementMappings) => ({
      ...cardElementMappings,
      [key]: cardElement
    }));
  };
  // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
  const getCardElement = (key: any) => cardElementMappings[key];

  return [getCardElement, setCardElement];
}

export function calculateSelectedProductsTotal(
  stripeConfig: StripeConfig,
  updateFieldValues: (fv: { [key: string]: any }) => void
): string {
  // Each key in feathery.cart is a product id.
  // Each value is the quantity of that product.
  // Calculate each product's cost and sum them up.

  const allProductsPriceCache = {
    ...(stripeConfig.metadata.test?.product_price_cache ?? {}),
    ...(stripeConfig.metadata.live?.product_price_cache ?? {})
  };

  let cost = new BigDecimal(0);
  const cartSelections = getCartSelections();
  for (const productId in cartSelections) {
    const quantity = cartSelections[productId];
    // call calculateLineItemCost to get the cost of this product
    const lineItemCost = calculateLineItemCost(
      allProductsPriceCache[productId],
      quantity
    );
    cost = cost.add(lineItemCost);
  }
  // Note: this will not work when and if we internationalize and support international currencies!
  // The text var needs to eventually support some sort of format specifier so that formatting is done during the display...
  const totalCost = cost
    .divide(new BigDecimal(100), 12)
    .round(2, BigDecimal.RoundingModes.HALF_UP)
    // .getPrettyValue(3, ',');
    .getValue();
  updateFieldValues({
    [FEATHERY_CART_TOTAL]: totalCost
  });
  return totalCost;
}

export function calculateLineItemCost(
  product: Product | undefined,
  quantity: number,
  inMajorUnits = false
): BigDecimal {
  // Pricing model (either one-time or recurring) is one of:
  //
  // 1. Per-unit or tiered (billing_scheme)
  // 2. If per-unit, then either per-one-unit (standard) or package pricing (per_unit_units, per_unit_rounding)
  // 3. If tiered, then either graduated or volume (tiers_mode, tiers)
  // 4. If tiered, then charges in tier can be per-unit, flat or both.
  //
  // Any metered pricing is not supported and skipped if encountered.

  let cost = new BigDecimal(0);
  if (product && product.default_price) {
    // only supporting default price right now and no metered pricing
    const price = product.prices.find(
      (price) => price.id === product.default_price
    );
    if (price && price.recurring_usage_type !== 'metered') {
      if (price.billing_scheme === 'per_unit') {
        // per-unit standard and package pricing
        const perUnitUnits = new BigDecimal(price.per_unit_units ?? 1);
        const rounding =
          price.per_unit_rounding && price.per_unit_rounding === 'down'
            ? BigDecimal.RoundingModes.DOWN
            : BigDecimal.RoundingModes.HALF_UP;

        // carrying out to 12 decimal digits max (from Stripe)
        const unitAmount = new BigDecimal(price.unit_amount)
          .divide(perUnitUnits, 12)
          .round(0, rounding);

        cost = unitAmount.multiply(new BigDecimal(quantity));
      } else if (price.billing_scheme === 'tiered' && price.tiers) {
        if (price.tiers_mode === 'graduated') {
          // tiered graduated
          let remaining = quantity;
          cost = price.tiers.reduce((cost, tier) => {
            if (remaining) {
              let sum = cost.add(new BigDecimal(tier.flat_amount ?? 0));
              const unitsThisTier =
                tier.up_to === null || quantity <= tier.up_to
                  ? remaining
                  : remaining - (quantity - tier.up_to);
              remaining -= unitsThisTier;
              sum = sum.add(
                new BigDecimal(tier.unit_amount ?? 0).multiply(
                  new BigDecimal(unitsThisTier)
                )
              );
              return sum;
            }
            return cost;
          }, new BigDecimal(0));
        } else if (price.tiers_mode === 'volume') {
          // tiered, volume
          for (let i = 0; i < price.tiers.length; i++) {
            const tier = price.tiers[i];
            if (tier.up_to === null || quantity <= tier.up_to) {
              let sum = new BigDecimal(tier.flat_amount ?? 0);
              sum = sum.add(
                new BigDecimal(tier.unit_amount ?? 0).multiply(
                  new BigDecimal(quantity)
                )
              );
              return sum;
            }
          }
        }
      }
    }
  }

  return inMajorUnits
    ? cost
        .divide(new BigDecimal(100), 12)
        .round(2, BigDecimal.RoundingModes.HALF_UP)
    : cost;
}
