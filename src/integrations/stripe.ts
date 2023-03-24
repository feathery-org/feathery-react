import { loadStripe } from '@stripe/stripe-js';
import { useState } from 'react';
import { runningInClient, featheryDoc } from '../utils/browser';
import { ActionData } from './utils';
import { fieldValues } from '../utils/init';
import { ACTION_COLLECT_PAYMENT } from '../utils/elementActions';
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

export interface PaymentProduct {
  product_id: string;
  quantity_field?: string; // resolved servar key of hidden field key
  fixed_quantity?: number;
}
export interface PaymentGroup {
  payment_group_id: string;
  products: PaymentProduct[];
}
export function getStripePaymentQuantityFieldValues(
  paymentGroup: PaymentGroup
) {
  return paymentGroup.products
    .filter((p) => p.quantity_field)
    .reduce((result: any, p) => {
      const key = p.quantity_field as string;
      if (key in fieldValues) result[key] = fieldValues[key];
      return result;
    }, {} as { [key: string]: any });
}

async function syncStripeFieldChanges(
  client: any,
  integrationData: any,
  paymentGroup?: PaymentGroup
) {
  // Need to update the backend with any customer field values that might be on
  // the current step.
  const stepCustomerFieldValues: any =
    getFlatStripeCustomerFieldValues(integrationData);
  // payment groups (from action props) also could have mapped product quantity fields that must be sync'd
  const stepPaymentQtyFieldValues = paymentGroup
    ? getStripePaymentQuantityFieldValues(paymentGroup)
    : {};
  const fieldValuesToSubmit = {
    ...stepCustomerFieldValues,
    ...stepPaymentQtyFieldValues
  };
  if (Object.keys(fieldValuesToSubmit).length) {
    await client.submitCustom(fieldValuesToSubmit);
  }
}

/**
 * Used to setup a payment method.
 */
export async function setupPaymentMethod(
  {
    servar,
    client,
    formattedFields,
    updateFieldValues,
    integrationData,
    targetElement
  }: ActionData,
  syncFields = true,
  stripePromise = null
) {
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
          errorField: servar,
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
          [servar.key]: paymentMethodData
        });
        formattedFields[servar.key] = {
          value: paymentMethodData,
          type: servar.type,
          displayText: servar.name
        };
      }
    } catch (e) {
      return {
        errorField: servar,
        errorMessage: e instanceof Error ? e.message : ''
      };
    }
  }
  return null;
}

/**
 * Used to either collect payment directly or launch stripe checkout to collect payment.
 */
export async function collectPayment(
  actionData: ActionData,
  stripePromise = null
) {
  const {
    client,
    triggerElement, // action button that triggered this
    triggerElementType,
    updateFieldValues,
    integrationData: stripeConfig
  } = actionData;

  // there can only be one collect payment action and therefore at most one payment group
  const collectPaymentAction = triggerElement.properties.actions.find(
    (action: { type: string }) => action.type === ACTION_COLLECT_PAYMENT
  );
  // sync fields to BE
  await syncStripeFieldChanges(
    client,
    stripeConfig,
    collectPaymentAction?.payment_group
  );

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
    const stripe: any = await (stripePromise ?? getStripe());
    const checkoutType = stripeConfig.metadata.checkout_type ?? 'custom';
    const paymentElementId =
      triggerElementType === 'button'
        ? triggerElement.id
        : triggerElement.properties.callback_id;

    if (!paymentElementId)
      return {
        errorField: triggerElement,
        errorMessage: 'Payment Error: Missing ID' // could happen on a container.
      };

    if (checkoutType === 'stripe') {
      // stripe checkout
      // If the urls are not supplied, default to the current step
      const successUrl =
        triggerElement?.properties?.success_url || window.location.href;
      const cancelUrl =
        triggerElement?.properties?.cancel_url || window.location.href;
      const { checkout_url: checkoutUrl } = await client.createCheckoutSession(
        paymentElementId,
        triggerElementType,
        successUrl,
        cancelUrl
      );
      // preserve browser back button function to current page/step
      checkoutUrl && (window.location.href = checkoutUrl);
    } else if (checkoutType === 'custom') {
      // custom payment from Feathery
      const { intent_secret: paymentIntentSecret } = await client.createPayment(
        paymentElementId,
        triggerElementType
      );
      // No paymentIntentSecret means no payment will be done
      if (paymentIntentSecret) {
        const result = await stripe.confirmCardPayment(paymentIntentSecret);
        if (result.error)
          return {
            errorField: triggerElement,
            errorMessage: result.error.message
          };
        else {
          // Complete the payment (clears fields, sets paid indicator)
          const { field_values: newFieldValues } =
            await client.paymentComplete();

          // BE is the source of truth here.  Update fieldValues.
          // This will clear the selected product hidden fields and the total hidden field
          // as well as set the has_paid field.
          updateFieldValues(newFieldValues);
        }
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
