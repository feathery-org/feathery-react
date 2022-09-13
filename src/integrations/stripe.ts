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
  // eslint-disable-next-line camelcase
  if (stripeConfig?.metadata?.client_key) {
    featheryDoc().dispatchEvent(
      new CustomEvent('stripe_key_loaded', {
        detail: { key: stripeConfig.metadata.client_key }
      })
    );
  }
  return Promise.resolve();
}

// Returns mapping of servar key (or hidden field key) to value
export function getFlatStripeCustomerFieldValues(
  stripeConfig: any,
  fieldValues: any,
  servarFields: any
) {
  const servarMap = {};
  servarFields.forEach(
    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    (field: any) => (servarMap[field.servar.id] = field.servar.key)
  );

  if (!stripeConfig?.metadata?.customer_field_mappings) return {};
  return getObjectMappingValues(
    stripeConfig.metadata.customer_field_mappings,
    fieldValues,
    servarMap
  );
}
function getObjectMappingValues(
  mappingObj: any,
  fieldValues: any,
  servarMap: any
) {
  return Object.entries(mappingObj).reduce((result, [, mappingInfo]) => {
    if ((mappingInfo as any).id) {
      let key = (mappingInfo as any).id;
      if ((mappingInfo as any).type === 'servar')
        key = servarMap[(mappingInfo as any).id];
      // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
      if (key && key in fieldValues) result[key] = fieldValues[key].value;
    }
    // sub-object
    else {
      result = {
        ...result,
        ...getObjectMappingValues(mappingInfo, fieldValues, servarMap)
      };
    }
    return result;
  }, {});
}

export async function setupPaymentMethod(
  {
    servar,
    client,
    formattedFields,
    updateFieldValues,
    step,
    integrationData,
    targetElement
  }: any,
  stripePromise = getStripe()
) {
  if (formattedFields[servar.key]?.value?.complete) {
    try {
      const stripe = await stripePromise;

      // Need to update the backend with any customer field values that might be on
      // the current step.
      const stepCustomerFieldValues = getFlatStripeCustomerFieldValues(
        integrationData,
        formattedFields,
        step.servar_fields
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
        const paymentMethodData = await client.retrievePaymentMethodData(
          servar.key,
          result.setupIntent.payment_method
        );
        // Got data for the payment methid field, set it on the field
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

export function usePayments() {
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
