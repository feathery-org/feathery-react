import React, { useMemo } from 'react';

import ReactButton from 'react-bootstrap/Button';
import TextNodes from '../components/TextNodes';
import { imgMaxSizeStyles, ERROR_COLOR, borderColorProps } from '../styles';
import { adjustColor } from '../../utils/styles';

const LINK_ADD_REPEATED_ROW = 'add_repeated_row';
const LINK_BACK = 'back';
const LINK_CUSTOM = 'custom';
const LINK_GOOGLE_OAUTH = 'trigger_google_oauth';
const LINK_LOGOUT = 'logout';
const LINK_NEXT = 'next';
const LINK_NONE = 'none';
const LINK_REMOVE_REPEATED_ROW = 'remove_repeated_row';
const LINK_SEND_MAGIC_LINK = 'send_magic_link';
const LINK_SEND_SMS = 'send_sms_code';
const LINK_STRIPE = 'select_payment_product';
const LINK_TRIGGER_PLAID = 'trigger_plaid';
const LINK_URL = 'url';
const LINK_VERIFY_SMS = 'verify_sms';
const SUBMITTABLE_LINKS = [
  LINK_NEXT,
  LINK_TRIGGER_PLAID,
  LINK_LOGOUT,
  LINK_SEND_MAGIC_LINK,
  LINK_SEND_SMS,
  LINK_VERIFY_SMS
];

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
  applyStyles.applyBorders({ target: 'button' });
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

  if (element.properties.link !== LINK_NONE) {
    applyStyles.apply('buttonHover', 'background_color', (a: any, b: any) => {
      const newColor = `${adjustColor(a, -45)} !important`;
      return {
        backgroundColor: newColor,
        transition: 'background 0.3s !important'
      };
    });
    applyStyles.apply('buttonHover', borderColorProps, (...colors: any) => {
      const newStyles: Record<string, string> = {};
      borderColorProps.forEach((prop, index) => {
        newStyles[prop] = `${adjustColor(colors[index], -45)} !important`;
      });
      return newStyles;
    });
  }
  if (element.styles.hover_background_color) {
    applyStyles.applyColor(
      'buttonHover',
      `hover_background_color`,
      'backgroundColor',
      true
    );
  }
  applyStyles.applyBorders({ target: 'buttonHover', prefix: 'hover_' });
  if (element.styles.selected_background_color) {
    applyStyles.applyColor(
      'buttonActive',
      `selected_background_color`,
      'backgroundColor',
      true
    );
  }
  applyStyles.applyBorders({ target: 'buttonActive', prefix: 'selected_' });
  applyStyles.apply('buttonDisabled', 'background_color', (a: any) => {
    const color = `${adjustColor(a, 45)} !important`;
    return {
      backgroundColor: color,
      borderColor: color,
      transition: 'background 0.3s !important'
    };
  });
  applyStyles.applyBorders({ target: 'buttonDisabled', prefix: 'disabled_' });
  if (element.styles.disabled_background_color) {
    applyStyles.applyColor(
      'buttonDisabled',
      `disabled_background_color`,
      'backgroundColor',
      true
    );
  }

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
  editMode,
  focused = false,
  disabled = false,
  active = false,
  textCallbacks = {},
  onClick = () => {},
  elementProps = {},
  inlineError,
  children
}: any) {
  const styles = useMemo(
    () => applyButtonStyles(element, applyStyles),
    [applyStyles]
  );

  // type=submit is important for HTML5 type validation messages
  const type = element.properties.link === LINK_NEXT ? 'submit' : 'button';
  return (
    <ReactButton
      id={element.id}
      key={element.id}
      active={active}
      type={type}
      style={{
        display: 'flex',
        cursor:
          editMode || element.properties.link === LINK_NONE
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
        '&.active': editMode
          ? styles.getTarget('button')
          : styles.getTarget('buttonActive'),
        '&:active:not(:disabled):not(.disabled)': editMode
          ? styles.getTarget('button')
          : styles.getTarget('buttonActive'),
        '&:hover:enabled': editMode
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
              editMode={editMode}
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
  LINK_ADD_REPEATED_ROW,
  LINK_BACK,
  LINK_CUSTOM,
  LINK_GOOGLE_OAUTH,
  LINK_LOGOUT,
  LINK_NEXT,
  LINK_NONE,
  LINK_REMOVE_REPEATED_ROW,
  LINK_SEND_MAGIC_LINK,
  LINK_SEND_SMS,
  LINK_STRIPE,
  LINK_TRIGGER_PLAID,
  LINK_URL,
  LINK_VERIFY_SMS,
  SUBMITTABLE_LINKS
};
