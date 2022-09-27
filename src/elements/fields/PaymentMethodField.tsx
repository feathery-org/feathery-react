import React, { memo, useEffect, useState } from 'react';
import {
  CardElement,
  Elements,
  useElements,
  useStripe
} from '@stripe/react-stripe-js';

import { getStripe } from '../../integrations/stripe';
import { filterKeys } from '../../utils/primitives';

import InlineTooltip from '../components/Tooltip';
import { ERROR_COLOR } from '../styles';

// In order for the stripe card element to operate and show the hybrid fields, stripe must be loaded and
// initialized with a key.  In a runtime form, it is crucial to use the real key.  However. in
// the dashboard any key will do since the field is not operational nor would we want it to be.
const stripeKey = 'any-key-does-not-matter-what';
const stripePromise = getStripe();
// Limit stripe css props to only those that are supported in order to avoid easy to miss warnings
const supportedStripeCssProps = [
  'backgroundColor',
  'color',
  'fontFamily',
  'fontSize',
  'fontSmoothing',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'iconColor',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'padding',
  'textDecoration',
  'textShadow',
  'textTransform'
];

const CardField = ({
  element,
  applyStyles,
  fieldLabel,
  elementProps = {},
  setCardElement = () => {},
  setFieldError = () => {},
  onChange = () => {},
  editable = false,
  inlineError,
  errorDisplayMode
}: any) => {
  const stripe = useStripe();
  const elements = useElements();
  const [lastError, setLastError] = useState('');

  useEffect(() => {
    if (!stripe || !elements) {
      // Stripe.js has not yet loaded.
      return;
    }
    setCardElement(element.servar.key, elements.getElement(CardElement));
  }, [stripe, element.servar.key, elements]);

  // In general, mobile styles are supported for the payment method field.  However, we do this using
  // media queries.  The Stripe card element does not support this so the mobile styles that are set
  // in media queries directly below are ignored.  This means that mobile styles like color and the various font styles
  // do not work (mobile settings will not be applied).  However, other mobile styles for things like
  // background color and borders are set in the parent of the card element and DO WORK.
  const cardElementOptions = {
    style: {
      base: {
        textDecoration: 'none', // Bug in card element - force the reset to none
        ...filterKeys(applyStyles.getTarget('field'), supportedStripeCssProps),
        '::placeholder': {
          textDecoration: 'none', // Bug in card element - force the reset to none
          ...filterKeys(
            applyStyles.getTarget('placeholder'),
            supportedStripeCssProps
          )
        },
        ':hover': filterKeys(
          applyStyles.getTarget('hover'),
          supportedStripeCssProps
        ),
        ':focus': filterKeys(
          applyStyles.getTarget('active'),
          supportedStripeCssProps
        )
      },
      complete: applyStyles.getTarget('completed'),
      invalid: {
        color: ERROR_COLOR,
        iconColor: ERROR_COLOR
      }
    },
    classes: {
      base: element.servar.key
    }
  };
  const handleCardChange = (event: any) => {
    // Listen for changes in the CardElement
    // and display any errors as the customer types their card details.
    // Only set the field error if there is a change (Stripe card element is a bit chatty)
    const error = event.error?.message ?? '';
    if (lastError !== error) {
      setLastError(error);
      setFieldError(error);
    }
    // also set the field data with complete=true so we know
    // when a card number has been entered and is complete
    onChange(
      event.complete
        ? { complete: true, card_data: { brand: event.brand } }
        : ''
    );
  };

  return (
    <div
      css={{
        maxWidth: '100%',
        position: 'relative',
        pointerEvents: editable ? 'none' : 'auto',
        ...applyStyles.getTarget('fc')
      }}
      {...elementProps}
    >
      {fieldLabel}
      <div
        css={{
          position: 'relative',
          width: '100%',
          whiteSpace: 'nowrap',
          overflowX: 'hidden',
          padding: '0 2px',
          display: 'flex',
          alignItems: 'center',
          ...applyStyles.getTarget('sub-fc'),
          '&:focus': applyStyles.getTarget('active'),
          '&:hover': applyStyles.getTarget('hover'),
          ...(inlineError ? { borderColor: ERROR_COLOR } : {})
        }}
      >
        <div css={{ width: '100%', position: 'relative' }}>
          {/* position an input field under the card element to support html5 errors */}
          {!editable && errorDisplayMode === 'html5' && (
            <input
              id={element.servar.key}
              css={{
                width: '100%',
                height: 0,
                border: 'none',
                opacity: 0,
                '&:focus': {
                  outline: 'none'
                }
              }}
              // @ts-expect-error TS(2322): Type 'string' is not assignable to type 'number'.
              tabIndex='-1'
            />
          )}
          <CardElement
            css={
              !editable
                ? {
                    position: 'absolute',
                    top: 0,
                    width: '100%'
                  }
                : {}
            }
            options={cardElementOptions}
            onChange={handleCardChange}
          />
        </div>
        <InlineTooltip element={element} applyStyles={applyStyles} />
      </div>
    </div>
  );
};

function PaymentMethodField({ editable = false, children, ...props }: any) {
  useEffect(() => {
    // if ediatble, i.e. running in dashboard, then just load stripe with key so cardElement shows
    if (editable)
      document.dispatchEvent(
        new CustomEvent('stripe_key_loaded', {
          detail: { key: stripeKey }
        })
      );
  }, [editable]);

  return (
    // @ts-expect-error TS(2322): Type 'Promise<unknown>' is not assignable to type ... Remove this comment to see the full error message
    <Elements stripe={stripePromise}>
      {children}
      <CardField editable={editable} {...props} />
    </Elements>
  );
}

export default memo(PaymentMethodField);
