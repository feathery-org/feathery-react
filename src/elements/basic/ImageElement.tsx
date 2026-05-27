import { useEffect, useMemo, useState } from 'react';
import { fieldValues } from '../../utils/init';
import { getRenderData } from '../../utils/image';

export const PLACEHOLDER_IMAGE =
  'https://feathery.s3.us-west-1.amazonaws.com/theme-image-preview.png';

function applyImageStyles(element: any, responsiveStyles: any) {
  responsiveStyles.addTargets('imageContainer', 'image', 'dimension');
  responsiveStyles.applyCorners('imageContainer');
  responsiveStyles.applyCorners('image');
  responsiveStyles.applyWidth('dimension');
  return responsiveStyles;
}

function getImmediateDocumentUrl({
  editMode,
  imageFieldSource,
  sourceImage
}: {
  editMode?: boolean;
  imageFieldSource: any;
  sourceImage?: string;
}) {
  if (imageFieldSource && typeof imageFieldSource === 'string') {
    return imageFieldSource;
  }
  if (!imageFieldSource) return sourceImage || PLACEHOLDER_IMAGE;
  return editMode ? PLACEHOLDER_IMAGE : '';
}

function ImageElement({
  element,
  responsiveStyles,
  elementProps = {},
  editMode,
  children
}: any) {
  const fieldKey = element.properties.uploaded_image_file_field_key ?? '';
  let imageFieldSource = fieldValues[fieldKey];

  if (Array.isArray(imageFieldSource)) {
    imageFieldSource = imageFieldSource[element.repeat ?? 0];
  }

  const shouldResolveImageSource = Boolean(
    imageFieldSource && typeof imageFieldSource !== 'string'
  );
  const immediateDocumentUrl = getImmediateDocumentUrl({
    editMode,
    imageFieldSource,
    sourceImage: element.properties.source_image
  });
  const [resolvedDocumentData, setResolvedDocumentData] = useState<{
    type?: string;
    url: string;
  } | null>(null);
  const [applyWidth, setApplyWidth] = useState(true);
  const styles = useMemo(
    () => applyImageStyles(element, responsiveStyles),
    [responsiveStyles]
  );

  useEffect(() => {
    if (!shouldResolveImageSource) return;

    getRenderData(imageFieldSource as any).then(setResolvedDocumentData);
  }, [imageFieldSource, shouldResolveImageSource]);

  const documentUrl =
    shouldResolveImageSource && resolvedDocumentData
      ? resolvedDocumentData.url
      : immediateDocumentUrl;
  const documentType =
    shouldResolveImageSource && resolvedDocumentData
      ? resolvedDocumentData.type
      : '';

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
          src={documentUrl || undefined}
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
