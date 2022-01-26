import React, { useMemo } from 'react';

import ReactButton from 'react-bootstrap/Button';
import TextNodes from '../components/TextNodes';
import Spinner from 'react-bootstrap/Spinner';

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
  applyStyles.applyMargin('button');

  applyStyles.applyBorders('buttonHover', 'hover_');
  if (element.properties.link !== 'none') {
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

function ButtonElement({
  element,
  applyStyles,
  values = null,
  loader = null,
  handleRedirect = () => {},
  onClick = () => {},
  elementProps = {},
  children
}) {
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
        cursor: element.properties.link === 'none' ? 'default' : 'pointer',
        boxShadow: 'none',
        maxWidth: '100%',
        position: 'relative'
      }}
      css={{
        '&:disabled': { cursor: 'default !important' },
        '&:active': styles.getTarget('buttonActive'),
        '&:hover:enabled': styles.getTarget('buttonHover'),
        '&&': styles.getTarget('button')
      }}
      disabled={element.properties.link === 'none' || loader}
      onClick={onClick}
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

export default ButtonElement;
export { adjustColor };
