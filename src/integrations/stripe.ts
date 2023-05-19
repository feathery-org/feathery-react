import { loadStripe } from '@stripe/stripe-js/pure';
import { useState } from 'react';
import { runningInClient, featheryDoc, featheryWindow } from '../utils/browser';
import { ActionData } from './utils';
import { fieldValues } from '../utils/init';
import { ACTION_PURCHASE_PRODUCTS } from '../utils/elementActions';
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

export const FEATHERY_PAYMENTS_SELECTIONS = 'feathery.payments.selections';
export const FEATHERY_PAYMENTS_TOTAL = 'feathery.payments.total';

export function getPaymentsReservedFieldValues() {
  return Object.entries(fieldValues).reduce((result, [key, value]) => {
    if (key.startsWith('feathery.payments.')) {
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

// get the cart selections from fields values object key feathery.payments.selections
function getCartSelections(): Record<string, number> {
  return (
    (fieldValues[FEATHERY_PAYMENTS_SELECTIONS] as Record<string, number>) ??
    ({} as Record<string, number>)
  );
}
// save the cart selections into fields values object key feathery.payments.selections
function saveCartSelections(
  cartSelections: Record<string, number> | null,
  updateFieldValues: any
) {
  updateFieldValues({ [FEATHERY_PAYMENTS_SELECTIONS]: cartSelections });
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

/**
 * Add to cart function
 */
export function addToCart(
  paymentAction: PaymentAction,
  updateFieldValues: any
) {
  const {
    product_id: productId,
    quantity_field: quantityField,
    fixed_quantity: fixedQuantity,
    toggle,
    clear_cart: clearCart
  } = paymentAction;

  const cartSelections = getCartSelections();
  const currentQuantity = cartSelections[productId] ?? 0;
  if (clearCart) {
    // clear cart
    Object.keys(cartSelections).forEach((key) => {
      delete cartSelections[key];
    });
  }
  if (toggle && currentQuantity > 0) {
    // toggle off
    delete cartSelections[productId];
  } else {
    // toggle on
    const newQty = quantityField
      ? (fieldValues[quantityField] as number) ?? 0
      : fixedQuantity ?? 0;
    // if newQty is 0, remove from cart, otherwise add to cart
    if (newQty) cartSelections[productId] = newQty;
    else delete cartSelections[productId];
  }
  const newCartSelections = Object.keys(cartSelections).length
    ? cartSelections
    : null;
  saveCartSelections(newCartSelections, updateFieldValues);
  return newCartSelections;
}

/**
 * Remove from cart function.
 * Clear the cart completely if clear_cart is true.
 */
export function removeFromCart(
  paymentAction: PaymentAction,
  updateFieldValues: any
) {
  const { product_id: productId, clear_cart: clearCart } = paymentAction;
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
      }
    }
  } catch (e) {
    return {
      errorField: triggerElement,
      errorMessage: 'Payment Error'
    };
  }
  return null;
}

export async function checkForPaymentCheckoutCompletion(
  step: any,
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
    const paymentElement = [...step.buttons, ...step.subgrids].find((element) =>
      element.properties.actions?.find(
        (action: any) => action.type === ACTION_PURCHASE_PRODUCTS
      )
    );
    if (paymentElement) {
      // auto clear the cart on successful payment
      saveCartSelections(null, updateFieldValues);

      // clearing after successful payment
      const fieldValuesToSubmit: Record<string, any> = {
        [FEATHERY_PAYMENTS_SELECTIONS]: {},
        [FEATHERY_PAYMENTS_TOTAL]: 0
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
