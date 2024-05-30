import React, { useEffect, useMemo, useState } from 'react';
import { fieldValues } from '../../utils/init';
import { getThumbnailData } from '../../utils/image';

const PLACEHOLDER_IMAGE =
  'https://feathery.s3.us-west-1.amazonaws.com/theme-image-preview.png';

function applyImageStyles(element: any, responsiveStyles: any) {
  responsiveStyles.addTargets('imageContainer', 'image', 'dimension');
  responsiveStyles.applyCorners('imageContainer');
  responsiveStyles.applyCorners('image');
  responsiveStyles.applyWidth('dimension');
  return responsiveStyles;
}

function ImageElement({
  element,
  responsiveStyles,
  elementProps = {},
  children
}: any) {
  const [imageUrl, setImageUrl] = useState(element.properties.source_image);
  const [applyWidth, setApplyWidth] = useState(true);

  const styles = useMemo(
    () => applyImageStyles(element, responsiveStyles),
    [responsiveStyles]
  );

  const imageField = element.properties.uploaded_image_file_field_key ?? '';
  let imageFieldSource = fieldValues[imageField];
  if (imageFieldSource && Array.isArray(imageFieldSource))
    imageFieldSource = imageFieldSource[0];

  useEffect(() => {
    if (imageFieldSource) {
      if (typeof imageFieldSource === 'string') setImageUrl(imageFieldSource);
      else {
        getThumbnailData(imageFieldSource).then((data) =>
          setImageUrl(data.thumbnail)
        );
      }
    } else setImageUrl(element.properties.source_image);
  }, [imageFieldSource, element.properties.source_image]);

  return (
    <div
      css={{
        width: '100%',
        height: '100%',
        ...styles.getTarget('imageContainer'),
        maxHeight: '100%',
        position: 'relative',
        display: 'flex',
        alignItems: 'center'
      }}
    >
      {children}
      {imageField && !imageUrl ? null : (
        <img
          src={imageUrl || PLACEHOLDER_IMAGE}
          alt=''
          aria-label={element.properties.aria_label}
          css={{
            objectFit: 'contain',
            width: '100%',
            maxWidth: '100%',
            height: '100%',
            maxHeight: '100%',
            ...styles.getTarget('image'),
            ...(applyWidth ? styles.getTarget('dimension') : {})
          }}
          onLoad={() => setApplyWidth(false)}
          {...elementProps}
        />
      )}
    </div>
  );
}

export default ImageElement;
