import React, { useEffect, useMemo, useState } from 'react';
import { fieldValues } from '../../utils/init';
import { getRenderData } from '../../utils/image';

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
  editMode,
  children
}: any) {
  const [documentUrl, setDocumentUrl] = useState(
    editMode ? PLACEHOLDER_IMAGE : ''
  );
  const [documentType, setDocumentType] = useState<string | undefined>('');
  const [applyWidth, setApplyWidth] = useState(true);
  const styles = useMemo(
    () => applyImageStyles(element, responsiveStyles),
    [responsiveStyles]
  );

  const fieldKey = element.properties.uploaded_image_file_field_key ?? '';
  let imageFieldSource = fieldValues[fieldKey];
  if (Array.isArray(imageFieldSource))
    imageFieldSource = imageFieldSource[element.repeat ?? 0];
  useEffect(() => {
    if (imageFieldSource) {
      if (typeof imageFieldSource === 'string') {
        setDocumentType('');
        setDocumentUrl(imageFieldSource);
      } else {
        getRenderData(imageFieldSource).then((data) => {
          setDocumentType(data.type);
          setDocumentUrl(data.url);
        });
      }
    } else {
      setDocumentUrl(element.properties.source_image || PLACEHOLDER_IMAGE);
      setDocumentType('');
    }
  }, [imageFieldSource, element.properties.source_image]);

  const displayPDF = documentUrl && documentType === 'application/pdf';
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
      {displayPDF ? (
        <embed
          type='application/pdf'
          width='100%'
          height='100%'
          alt=''
          aria-label={element.properties.aria_label}
          src={documentUrl + '#view=FitH'}
          css={{
            border: 'none',
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
      ) : (
        <img
          src={documentUrl}
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
