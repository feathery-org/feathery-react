import React, { useMemo } from 'react';

const PLACEHOLDER_IMAGE =
  'https://feathery.s3.us-west-1.amazonaws.com/theme-image-preview.png';

function applyImageStyles(element, applyStyles) {
  applyStyles.addTargets('image');
  applyStyles.applyWidth('image');
  return applyStyles;
}

function ImageElement({ element, applyStyles, elementProps = {}, children }) {
  const styles = useMemo(
    () => applyImageStyles(element, applyStyles),
    [applyStyles]
  );
  return (
    <div css={{ ...styles.getTarget('image'), position: 'relative' }}>
      <img
        src={element.properties.source_image || PLACEHOLDER_IMAGE}
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
