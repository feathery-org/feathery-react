import React, { useMemo } from 'react';

import ReactButton from 'react-bootstrap/Button';
import TextNodes from '../components/TextNodes';
import { imgMaxSizeStyles, ERROR_COLOR } from '../styles';
import { adjustColor } from '../../utils/styles';

const LINK_CUSTOM = 'custom';
const LINK_NONE = 'none';
const LINK_SKIP = 'skip';
const LINK_SUBMIT = 'submit';
const LINK_URL = 'url';
const LINK_ADD_REPEATED_ROW = 'add_repeated_row';
const LINK_REMOVE_REPEATED_ROW = 'remove_repeated_row';
const LINK_SEND_SMS = 'send_sms_code';
const LINK_SEND_MAGIC_LINK = 'send_magic_link';
const LINK_TRIGGER_PLAID = 'trigger_plaid';
const LINK_GOOGLE_OAUTH = 'trigger_google_oauth';
const LINK_STRIPE = 'select_payment_product';

function applyButtonStyles(element: any, applyStyles: any) {
  applyStyles.addTargets(
    'button',
    'buttonActive',
    'buttonHover',
    'buttonDisabled',
    'loader',
    'img'
  );

  applyStyles.apply('button', 'background_color', (a: any) => ({
    backgroundColor: `#${a}`
  }));
  applyStyles.applyHeight('button');
  applyStyles.applyWidth('button');
  applyStyles.applyCorners('button');
  applyStyles.applyBorders('button');
  applyStyles.applyFlexAndTextAlignments('button');
  applyStyles.apply(
    'button',
    [
      'uploader_padding_top',
      'uploader_padding_right',
      'uploader_padding_bottom',
      'uploader_padding_left'
    ],
    // @ts-expect-error TS(7006): Parameter 'a' implicitly has an 'any' type.
    (a, b, c, d) => ({
      padding: `${a}px ${b}px ${c}px ${d}px`
    })
  );
  applyStyles.applyWidth('img', 'image_');
  applyStyles.applyMargin('img', 'image_');

  applyStyles.applyBorders('buttonHover', 'hover_');
  if (element.properties.link !== LINK_NONE) {
    applyStyles.apply('buttonHover', 'background_color', (a: any) => {
      const color = `${adjustColor(a, -45)} !important`;
      return {
        backgroundColor: color,
        borderColor: color,
        transition: 'background 0.3s !important'
      };
    });
  }
  if (element.styles.hover_background_color) {
    applyStyles.apply('buttonHover', 'hover_background_color', (a: any) => ({
      backgroundColor: `#${a} !important`
    }));
  }
  applyStyles.applyBorders('buttonActive', 'selected_');
  if (element.styles.selected_background_color) {
    applyStyles.apply(
      'buttonActive',
      'selected_background_color',
      (a: string) => ({
        backgroundColor: `#${a} !important`
      })
    );
  }
  applyStyles.apply('buttonDisabled', 'background_color', (a: any) => {
    const color = `${adjustColor(a, 45)} !important`;
    return {
      backgroundColor: color,
      borderColor: color,
      transition: 'background 0.3s !important'
    };
  });

  applyStyles.apply('loader', ['height', 'height_unit'], (a: any, b: any) => {
    const thirdHeight = Math.round(a / 3);
    const dimension = `${thirdHeight}${b}`;
    return { width: dimension, height: dimension };
  });

  return applyStyles;
}

function ButtonElement({
  element,
  applyStyles,
  values = null,
  loader = null,
  editable = false,
  focused = false,
  disabled = false,
  active = false,
  textCallbacks = {},
  handleRedirect = () => {},
  onClick = () => {},
  elementProps = {},
  inlineError,
  children
}: any) {
  const styles = useMemo(
    () => applyButtonStyles(element, applyStyles),
    [applyStyles]
  );

  return (
    <ReactButton
      id={element.id}
      key={element.id}
      active={active}
      style={{
        display: 'flex',
        cursor:
          editable || element.properties.link === LINK_NONE
            ? 'default'
            : 'pointer',
        boxShadow: 'none',
        maxWidth: '100%',
        position: 'relative'
      }}
      css={{
        justifyContent: 'center',
        ...(inlineError ? { borderColor: ERROR_COLOR } : {}),
        alignItems: 'center',
        '&:disabled': {
          cursor: 'default !important',
          ...styles.getTarget('buttonDisabled')
        },
        /* Needed to style active class here to get active prop to work */
        '&.active': editable
          ? styles.getTarget('button')
          : styles.getTarget('buttonActive'),
        '&:active:not(:disabled):not(.disabled)': editable
          ? styles.getTarget('button')
          : styles.getTarget('buttonActive'),
        '&:hover:enabled': editable
          ? styles.getTarget('button')
          : styles.getTarget('buttonHover'),
        '&&': styles.getTarget('button')
      }}
      disabled={element.properties.link === LINK_NONE || loader || disabled}
      onClick={onClick}
      {...elementProps}
    >
      {children}
      {loader ? (
        <div css={styles.getTarget('loader')}>{loader}</div>
      ) : (
        <>
          {element.properties.image && (
            <img
              src={element.properties.image}
              style={{
                ...imgMaxSizeStyles,
                ...applyStyles.getTargets('img')
              }}
            />
          )}
          {element.properties.text && (
            <TextNodes
              element={element}
              values={values}
              applyStyles={applyStyles}
              handleRedirect={handleRedirect}
              editable={editable}
              focused={focused}
              textCallbacks={textCallbacks}
            />
          )}
        </>
      )}
    </ReactButton>
  );
}

export default ButtonElement;
export {
  LINK_CUSTOM,
  LINK_NONE,
  LINK_SKIP,
  LINK_SUBMIT,
  LINK_URL,
  LINK_ADD_REPEATED_ROW,
  LINK_REMOVE_REPEATED_ROW,
  LINK_SEND_SMS,
  LINK_SEND_MAGIC_LINK,
  LINK_TRIGGER_PLAID,
  LINK_GOOGLE_OAUTH,
  LINK_STRIPE
};
