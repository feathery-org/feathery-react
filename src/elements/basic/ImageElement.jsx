import React, { useMemo } from 'react';

function applyImageStyles(element, applyStyles) {
  applyStyles.addTargets('image');
  applyStyles.applyMargin('image');
  applyStyles.applyWidth('image');

  if (element.styles.line_height) {
    applyStyles.apply('text', 'line_height', (a) => ({
      lineHeight: `${a}px`
    }));
  }

  return applyStyles;
}

function ImageElement({ element, applyStyles, elementProps = {}, children }) {
  const styles = useMemo(() => applyImageStyles(element, applyStyles), [
    applyStyles
  ]);
  return (
    <div css={{ ...styles.getTarget('image'), position: 'relative' }}>
      <img
        src={element.properties.source_image}
        alt='Form Image'
        css={{
          objectFit: 'contain',
          width: '100%'
        }}
        {...elementProps}
      />
      {children}
    </div>
  );
}

export default ImageElement;
