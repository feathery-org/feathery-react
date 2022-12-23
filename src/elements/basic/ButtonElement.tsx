import React, { useMemo } from 'react';

import ReactButton from 'react-bootstrap/Button';
import TextNodes from '../components/TextNodes';
import { imgMaxSizeStyles, ERROR_COLOR } from '../styles';
import { adjustColor } from '../../utils/styles';
import useBorder from '../components/useBorder';

const LINK_ADD_REPEATED_ROW = 'add_repeated_row';
const LINK_BACK = 'back';
const LINK_CUSTOM = 'custom';
const LINK_GOOGLE_OAUTH = 'trigger_google_oauth';
const LINK_LOGOUT = 'logout';
const LINK_NEXT = 'next';
const LINK_NONE = 'none';
const LINK_REMOVE_REPEATED_ROW = 'remove_repeated_row';
const LINK_SELECT_PRODUCT = 'select_payment_product';
const LINK_SEND_MAGIC_LINK = 'send_magic_link';
const LINK_SEND_SMS = 'send_sms_code';
const LINK_STORE_FIELD = 'store_field_value';
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

function applyButtonStyles(element: any, responsiveStyles: any) {
  responsiveStyles.addTargets(
    'button',
    'buttonActive',
    'buttonHover',
    'buttonDisabled',
    'loader',
    'img'
  );

  responsiveStyles.applyColor('button', 'background_color', 'backgroundColor');
  responsiveStyles.applyHeight('button');
  responsiveStyles.apply(
    'button',
    ['width', 'width_unit', 'content_responsive'],
    (a: any, b: any, c: boolean) => ({
      [c ? 'minWidth' : 'width']: `${a}${b}`
    })
  );
  responsiveStyles.applyCorners('button');
  responsiveStyles.applyFlexAndTextAlignments('button');
  responsiveStyles.apply(
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
  responsiveStyles.applyWidth('img', 'image_');
  responsiveStyles.applyMargin('img', 'image_');

  if (element.styles.hover_background_color) {
    responsiveStyles.applyColor(
      'buttonHover',
      `hover_background_color`,
      'backgroundColor',
      true
    );
  } else {
    // default hover effect
    responsiveStyles.apply('buttonHover', 'background_color', (a: any) => {
      const newColor = `${adjustColor(a, -45)} !important`;
      return { backgroundColor: newColor };
    });
  }
  responsiveStyles.applySpanSelectorStyles('buttonHover', 'hover_');
  responsiveStyles.apply('buttonHover', 'hover_image_color', (a: string) => {
    if (!a) return {};
    const level = a === 'black' ? 0 : 100;
    return {
      img: {
        webkitFilter: `brightness(${level}%)`,
        filter: `brightness(${level}%)`
      }
    };
  });

  responsiveStyles.applyColor(
    'buttonActive',
    `selected_background_color`,
    'backgroundColor',
    true
  );
  responsiveStyles.applySpanSelectorStyles('buttonActive', 'selected_');
  responsiveStyles.apply(
    'buttonActive',
    'selected_image_color',
    (a: string) => {
      if (!a) return {};
      const level = a === 'black' ? 0 : 100;
      return {
        img: {
          webkitFilter: `brightness(${level}%)`,
          filter: `brightness(${level}%)`
        }
      };
    }
  );

  responsiveStyles.apply('buttonDisabled', 'background_color', (a: any) => {
    const color = `${adjustColor(a, 45)} !important`;
    return {
      backgroundColor: color,
      borderColor: color
    };
  });
  responsiveStyles.apply(
    'buttonDisabled',
    'disabled_image_color',
    (a: string) => {
      if (!a) return {};
      const level = a === 'black' ? 0 : 100;
      return {
        img: {
          webkitFilter: `brightness(${level}%)`,
          filter: `brightness(${level}%)`
        }
      };
    }
  );
  responsiveStyles.applySpanSelectorStyles('buttonDisabled', 'disabled_');
  responsiveStyles.applyColor(
    'buttonDisabled',
    `disabled_background_color`,
    'backgroundColor',
    true
  );

  responsiveStyles.apply(
    'loader',
    ['height', 'height_unit'],
    (a: any, b: any) => {
      const thirdHeight = Math.round(a / 3);
      const dimension = `${thirdHeight}${b}`;
      return { width: dimension, height: dimension };
    }
  );

  return responsiveStyles;
}

function ButtonElement({
  element,
  responsiveStyles,
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
    () => applyButtonStyles(element, responsiveStyles),
    [responsiveStyles]
  );
  const { borderStyles, customBorder } = useBorder({
    element,
    defaultHover: true
  });

  const activeStyles = editMode
    ? styles.getTarget('button')
    : {
        ...styles.getTarget('buttonActive'),
        ...borderStyles.active
      };

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
        border: 'none',
        transition: '0.3s ease all !important',
        '&:disabled': {
          cursor: 'default !important',
          ...styles.getTarget('buttonDisabled'),
          ...borderStyles.disabled
        },
        '&:hover:enabled': editMode
          ? styles.getTarget('button')
          : {
              ...styles.getTarget('buttonHover'),
              ...borderStyles.hover
            },
        '&.active:enabled': activeStyles,
        '&:focus:enabled': activeStyles,
        '&&': styles.getTarget('button')
      }}
      disabled={element.properties.link === LINK_NONE || loader || disabled}
      onClick={onClick}
      {...elementProps}
    >
      {customBorder}
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
                ...responsiveStyles.getTargets('img')
              }}
            />
          )}
          {element.properties.text && (
            <TextNodes
              element={element}
              responsiveStyles={responsiveStyles}
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
  LINK_SELECT_PRODUCT,
  LINK_SEND_MAGIC_LINK,
  LINK_SEND_SMS,
  LINK_STORE_FIELD,
  LINK_TRIGGER_PLAID,
  LINK_URL,
  LINK_VERIFY_SMS,
  SUBMITTABLE_LINKS
};
