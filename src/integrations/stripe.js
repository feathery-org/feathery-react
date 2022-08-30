import { loadStripe } from '@stripe/stripe-js';
import { useState } from 'react';
import { runningInClient } from '../utils/browser.js';

const stripePromise = new Promise((resolve) => {
  if (runningInClient())
    document.addEventListener('stripe_key_loaded', (e) => {
      const promise = loadStripe(e.detail.key);
      promise.then((stripe) => {
        resolve(stripe);
      });
    });
});

export const getStripe = () => stripePromise;

export function installStripe(stripeConfig) {
  // eslint-disable-next-line camelcase
  if (stripeConfig?.metadata?.client_key) {
    document.dispatchEvent(
      new CustomEvent('stripe_key_loaded', {
        detail: { key: stripeConfig.metadata.client_key }
      })
    );
  }
  return Promise.resolve();
}

// Returns mapping of servar key (or hidden field key) to value
export function getFlatStripeCustomerFieldValues(
  stripeConfig,
  fieldValues,
  servarFields
) {
  const servarMap = {};
  servarFields.forEach(
    (field) => (servarMap[field.servar.id] = field.servar.key)
  );

  if (!stripeConfig?.metadata?.customer_field_mappings) return {};
  return getObjectMappingValues(
    stripeConfig.metadata.customer_field_mappings,
    fieldValues,
    servarMap
  );
}
function getObjectMappingValues(mappingObj, fieldValues, servarMap) {
  return Object.entries(mappingObj).reduce((result, [key, mappingInfo]) => {
    if (mappingInfo.id) {
      let key = mappingInfo.id;
      if (mappingInfo.type === 'servar') key = servarMap[mappingInfo.id];
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
  },
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

      const result = await stripe.confirmCardSetup(intentSecret, {
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

  const setCardElement = (key, cardElement) => {
    setCardElementMappings((cardElementMappings) => ({
      ...cardElementMappings,
      [key]: cardElement
    }));
  };
  const getCardElement = (key) => cardElementMappings[key];

  return [getCardElement, setCardElement];
}
