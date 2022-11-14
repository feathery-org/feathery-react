import React, { useMemo } from 'react';

const PLACEHOLDER_IMAGE =
  'https://feathery.s3.us-west-1.amazonaws.com/theme-image-preview.png';

function applyImageStyles(element: any, applyStyles: any) {
  applyStyles.addTargets('image');
  applyStyles.applyWidth('image');
  return applyStyles;
}

function ImageElement({
  element,
  applyStyles,
  elementProps = {},
  children
}: any) {
  const styles = useMemo(
    () => applyImageStyles(element, applyStyles),
    [applyStyles]
  );
  return (
    <div
      css={{
        ...styles.getTarget('image'),
        maxHeight: '100%',
        position: 'relative',
        display: 'flex',
        alignItems: 'center'
      }}
    >
      {children}
      <img
        src={element.properties.source_image || PLACEHOLDER_IMAGE}
        alt='Form Image'
        css={{
          objectFit: 'contain',
          width: '100%',
          maxHeight: '100%'
        }}
        {...elementProps}
      />
    </div>
  );
}

export default ImageElement;
