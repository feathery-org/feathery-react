import React, { memo, useEffect, useState } from 'react';
import {
  CardElement,
  Elements,
  useElements,
  useStripe
} from '@stripe/react-stripe-js';

import { getStripe } from '../../integrations/stripe';
import { filterKeys } from '../../utils/primitives';

import InlineTooltip from '../components/InlineTooltip';
import { ERROR_COLOR } from '../styles';
import useBorder from '../components/useBorder';
import { featheryDoc } from '../../utils/browser';

// In order for the stripe card element to operate and show the hybrid fields, stripe must be loaded and
// initialized with a key.  In a runtime form, it is crucial to use the real key.  However. in
// the dashboard any key will do since the field is not operational nor would we want it to be.
const stripeKey = 'any-key-does-not-matter-what';
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

// There are problems loading custom fonts into the Stripe element.
// Also, certain fonts (Open Sans) get cutoff.  So, punting on it
// completely and just using generic sans-serif all the time.
const toSansSerif = (styles: { fontFamily?: string }) => ({
  ...styles,
  fontFamily: 'sans-serif'
});

const CardField = ({
  element,
  responsiveStyles,
  fieldLabel,
  elementProps = {},
  setCardElement = () => {},
  setFieldError = () => {},
  onChange = () => {},
  autoFocus = false,
  editMode,
  inlineError,
  children
}: any) => {
  const [focused, setFocused] = useState(false);
  const { borderStyles, customBorder } = useBorder({
    element,
    error: inlineError
  });

  const stripe = useStripe();
  const stripeElements = useElements();
  const [lastError, setLastError] = useState('');

  useEffect(() => {
    if (!stripe || !stripeElements) {
      // Stripe.js has not yet loaded.
      return;
    }
    const cardEl = stripeElements.getElement(CardElement);
    if (autoFocus) {
      cardEl?.on('ready', () => cardEl.focus());
    }
    setCardElement(element.servar.key, cardEl);
  }, [stripe, element.servar.key, stripeElements]);

  // In general, mobile styles are supported for the payment method field.  However, we do this using
  // media queries.  The Stripe card element does not support this so the mobile styles that are set
  // in media queries directly below are ignored.  This means that mobile styles like color and the various font styles
  // do not work (mobile settings will not be applied).  However, other mobile styles for things like
  // background color and borders are set in the parent of the card element and DO WORK.
  const cardElementOptions = {
    style: {
      base: {
        textDecoration: 'none', // Bug in card element - force the reset to none
        ...filterKeys(
          toSansSerif(responsiveStyles.getTarget('field')),
          supportedStripeCssProps
        ),
        '::placeholder': {
          textDecoration: 'none', // Bug in card element - force the reset to none
          ...filterKeys(
            toSansSerif(responsiveStyles.getTarget('placeholder')),
            supportedStripeCssProps
          )
        },
        ':hover': filterKeys(
          toSansSerif(responsiveStyles.getTarget('hoverFont')),
          supportedStripeCssProps
        ),
        ':focus': filterKeys(
          toSansSerif(responsiveStyles.getTarget('activeFont')),
          supportedStripeCssProps
        )
      },
      complete: toSansSerif(responsiveStyles.getTarget('completedFont')),
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
        width: '100%',
        position: 'relative',
        pointerEvents: editMode ? 'none' : 'auto',
        ...responsiveStyles.getTarget('fc')
      }}
      {...elementProps}
    >
      {children}
      {fieldLabel}
      <div
        css={{
          position: 'relative',
          width: '100%',
          whiteSpace: 'nowrap',
          padding: '0 2px',
          display: 'flex',
          alignItems: 'center',
          ...responsiveStyles.getTarget('sub-fc'),
          '&:hover': {
            ...responsiveStyles.getTarget('hover'),
            ...borderStyles.hover
          },
          '&&': focused
            ? {
                ...responsiveStyles.getTarget('active'),
                ...borderStyles.active
              }
            : {}
        }}
      >
        {customBorder}
        <div css={{ width: '100%', position: 'relative' }}>
          {/* position an input field under the card element to support html5 errors */}
          <input
            id={element.servar.key}
            name={element.servar.key}
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
          <CardElement
            css={{
              position: 'absolute',
              top: 0,
              left: 5,
              right: 5,
              width: '100%'
            }}
            options={cardElementOptions}
            onChange={handleCardChange}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
        </div>
        <InlineTooltip
          id={element.id}
          text={element.properties.tooltipText}
          responsiveStyles={responsiveStyles}
        />
      </div>
    </div>
  );
};

function PaymentMethodField({ editMode, children, ...props }: any) {
  const stripePromise = getStripe();
  useEffect(() => {
    // if ediatble, i.e. running in dashboard, then just load stripe with key so cardElement shows
    if (editMode)
      featheryDoc().dispatchEvent(
        new CustomEvent('stripe_key_loaded', {
          detail: { key: stripeKey }
        })
      );
  }, [editMode]);

  return (
    // @ts-expect-error TS(2322): Type 'Promise<unknown>' is not assignable to type ... Remove this comment to see the full error message
    <Elements stripe={stripePromise}>
      {children}
      <CardField editMode={editMode} {...props} />
    </Elements>
  );
}

export default memo(PaymentMethodField);
