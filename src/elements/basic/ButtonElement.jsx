import React, { useMemo } from 'react';

import ReactButton from 'react-bootstrap/Button';
import TextNodes from '../components/TextNodes';

const LINK_CUSTOM = 'custom';
const LINK_NONE = 'none';
const LINK_SKIP = 'skip';
const LINK_SUBMIT = 'submit';
const LINK_ADD_REPEATED_ROW = 'add_repeated_row';
const LINK_REMOVE_REPEATED_ROW = 'remove_repeated_row';
const LINK_SEND_SMS = 'send_sms_code';
const LINK_TRIGGER_PLAID = 'trigger_plaid';

function adjustColor(color, amount) {
  return (
    '#' +
    color
      .replace(/^#/, '')
      .replace(/../g, (color) =>
        (
          '0' +
          Math.min(255, Math.max(0, parseInt(color, 16) + amount)).toString(16)
        ).substr(-2)
      )
  );
}

function applyButtonStyles(element, applyStyles) {
  applyStyles.addTargets('button', 'buttonActive', 'buttonHover', 'loader');

  applyStyles.apply('button', 'background_color', (a) => ({
    backgroundColor: `#${a}`
  }));
  applyStyles.applyHeight('button');
  applyStyles.applyWidth('button');
  applyStyles.applyCorners('button');
  applyStyles.applyBorders('button');

  applyStyles.applyBorders('buttonHover', 'hover_');
  if (element.properties.link !== LINK_NONE) {
    applyStyles.apply('buttonHover', 'background_color', (a) => {
      const color = `${adjustColor(a, -30)} !important`;
      return {
        backgroundColor: color,
        borderColor: color,
        transition: 'background 0.3s !important'
      };
    });
  }
  if (element.styles.hover_background_color) {
    applyStyles.apply('buttonHover', 'hover_background_color', (a) => ({
      backgroundColor: `#${a} !important`
    }));
  }

  applyStyles.applyBorders('buttonActive', 'selected_');
  if (element.styles.selected_background_color) {
    applyStyles.apply('buttonHover', 'selected_background_color', (a) => ({
      backgroundColor: `#${a} !important`
    }));
  }

  applyStyles.apply('loader', ['height', 'height_unit'], (a, b) => {
    const thirdHeight = Math.round(a / 3);
    const dimension = `${thirdHeight}${b}`;
    return { width: dimension, height: dimension };
  });

  return applyStyles;
}

function ButtonElement(
  {
    element,
    applyStyles,
    values = null,
    loader = null,
    handleRedirect = () => {},
    onClick = () => {},
    elementProps = {},
    children
  },
  ref
) {
  const styles = useMemo(() => applyButtonStyles(element, applyStyles), [
    applyStyles
  ]);

  return (
    <ReactButton
      id={element.id}
      key={element.id}
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        cursor: element.properties.link === LINK_NONE ? 'default' : 'pointer',
        boxShadow: 'none',
        maxWidth: '100%',
        position: 'relative',
        padding: '1px 6px'
      }}
      css={{
        '&:disabled': { cursor: 'default !important' },
        '&:active': styles.getTarget('buttonActive'),
        '&:hover:enabled': styles.getTarget('buttonHover'),
        '&&': styles.getTarget('button')
      }}
      disabled={element.properties.link === LINK_NONE || loader}
      onClick={onClick}
      ref={ref}
      {...elementProps}
    >
      {loader ? (
        <div css={styles.getTarget('loader')}>{loader}</div>
      ) : (
        <>
          {element.properties.image && (
            <img
              src={element.properties.image}
              style={{
                objectFit: 'contain',
                maxWidth: '80%',
                maxHeight: '100%'
              }}
            />
          )}
          <TextNodes
            element={element}
            values={values}
            applyStyles={applyStyles}
            handleRedirect={handleRedirect}
          />
        </>
      )}
      {children}
    </ReactButton>
  );
}

export default React.forwardRef(ButtonElement);
export {
  adjustColor,
  LINK_CUSTOM,
  LINK_NONE,
  LINK_SKIP,
  LINK_SUBMIT,
  LINK_ADD_REPEATED_ROW,
  LINK_REMOVE_REPEATED_ROW,
  LINK_SEND_SMS,
  LINK_TRIGGER_PLAID
};
