import { loadStripe } from '@stripe/stripe-js';
import { useState } from 'react';
import { runningInClient, featheryDoc } from '../utils/browser';

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
export function getFlatStripeCustomerFieldValues(
  stripeConfig: any,
  fieldValues: any
) {
  if (!stripeConfig?.metadata?.customer_field_mappings) return {};
  return getObjectMappingValues(
    stripeConfig.metadata.customer_field_mappings,
    fieldValues
  );
}
function getObjectMappingValues(mappingObj: any, fieldValues: any) {
  return Object.values(mappingObj).reduce((result: any, mappingInfo) => {
    if (typeof mappingInfo === 'string') {
      const key = mappingInfo;
      if (key in fieldValues) result[key] = fieldValues[key].value;
    }
    // sub-object
    else if (typeof mappingInfo === 'object') {
      result = {
        ...result,
        ...(getObjectMappingValues(mappingInfo, fieldValues) as {
          [key: string]: any;
        })
      };
    }
    return result;
  }, {} as { [key: string]: any });
}

/**
 * Used to both setup a payment method and, if there are charges, to pay.
 */
export async function setupPaymentMethodAndPay(
  {
    servar,
    client,
    formattedFields,
    updateFieldValues,
    integrationData,
    targetElement
  }: any,
  stripePromise = getStripe()
) {
  if (formattedFields[servar.key]?.value?.complete) {
    try {
      const stripe: any = await stripePromise;

      //
      // Payment method setup sequence
      //

      // Need to update the backend with any customer field values that might be on
      // the current step.
      const stepCustomerFieldValues: any = getFlatStripeCustomerFieldValues(
        integrationData,
        formattedFields
      );
      if (Object.keys(stepCustomerFieldValues).length) {
        await client.submitCustom(stepCustomerFieldValues);
      }

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

        //
        // Payment sequence
        //
        const { intent_secret: paymentIntentSecret } =
          await client.createPayment(servar.key);
        // No paymentIntentSecret means no payment will be done
        if (paymentIntentSecret) {
          const result = await stripe.confirmCardPayment(paymentIntentSecret, {
            payment_method: paymentMethodId
          });
          if (result.error)
            return {
              errorField: servar,
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
        errorField: servar,
        errorMessage: e instanceof Error ? e.message : ''
      };
    }
  }
  return null;
}

export function isProductSelected({
  productId,
  selectedProductIdField,
  fieldValues
}: {
  productId: string;
  selectedProductIdField: string;
  fieldValues: { [_: string]: any };
}) {
  if (productId && selectedProductIdField) {
    // get the value from the hidden field.  Example: {"some_stripe_product_id": 1}
    // selectedProductIdField can be shared, so make sure it is our product that is selected.
    return Boolean((fieldValues[selectedProductIdField] || {})[productId]);
  }
  return false;
}

export async function toggleProductSelection({
  productId,
  selectedProductIdFieldId,
  selectedProductIdFieldKey,
  fieldValues,
  updateFieldValues,
  client,
  integrations
}: {
  productId: string;
  selectedProductIdFieldId: string;
  selectedProductIdFieldKey: string;
  fieldValues: { [_: string]: any };
  updateFieldValues: any;
  client: any;
  integrations: any;
}) {
  // check productId and selectedProductIdField (key) are set
  if (
    productId &&
    selectedProductIdFieldKey &&
    selectedProductIdFieldId &&
    integrations.stripe
  ) {
    // get the value from the hidden field
    const fieldVal = fieldValues[selectedProductIdFieldKey] || {};
    const quantity = fieldVal[productId];
    // toggling the quantity 0/1 using xor
    let newQuantity = quantity ^ 1;
    // For the single select case, the stripe product id will change in the
    // common/shared hidden field. In this case just replace with quantity 1
    // of the new product id.
    if (!(productId in fieldVal)) newQuantity = 1;

    // toggle the quantity and set the new value into the hidden field
    // Do this immediately to give UI feedback
    updateFieldValues({
      [selectedProductIdFieldKey]: {
        [productId]: newQuantity
      }
    });
    // set the new product selection state on the BE
    const { field_values: newFieldValues } =
      await client.updateProductSelection(
        productId,
        newQuantity,
        selectedProductIdFieldKey
      );

    // BE is the source of truth here.  Update fieldValues.
    // This will change the  selected product hidden fields and the total hidden field.
    updateFieldValues(newFieldValues);
  }
}

export function usePayments(): [
  (key: any) => void,
  (key: any, cardElement: any) => void
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
