import React, { useMemo } from 'react';

const PLACEHOLDER_IMAGE =
  'https://feathery.s3.us-west-1.amazonaws.com/theme-image-preview.png';

function applyImageStyles(element: any, responsiveStyles: any) {
  responsiveStyles.addTargets('imageContainer', 'image');
  responsiveStyles.applyWidth('imageContainer');
  responsiveStyles.applyCorners('imageContainer');
  responsiveStyles.applyCorners('image');
  return responsiveStyles;
}

function ImageElement({
  element,
  responsiveStyles,
  elementProps = {},
  children
}: any) {
  const styles = useMemo(
    () => applyImageStyles(element, responsiveStyles),
    [responsiveStyles]
  );
  return (
    <div
      css={{
        ...styles.getTarget('imageContainer'),
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
          maxHeight: '100%',
          ...styles.getTarget('image')
        }}
        {...elementProps}
      />
    </div>
  );
}

export default ImageElement;
