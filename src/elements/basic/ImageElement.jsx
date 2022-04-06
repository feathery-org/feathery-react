import React, { useMemo } from 'react';
import { isNum } from '../../utils/primitives';

function applyImageStyles(element, applyStyles) {
  applyStyles.addTargets('image');
  applyStyles.applyWidth('image');

  applyStyles.apply('text', 'line_height', (a) => ({
    lineHeight: isNum(a) ? `${a}px` : 'normal'
  }));
  applyStyles.apply('text', 'letter_spacing', (a) => ({
    letterSpacing: isNum(a) ? `${a}px` : 'normal'
  }));
  applyStyles.apply('text', 'text_transform', (a) => ({
    textTransform: a || 'none'
  }));

  return applyStyles;
}

function ImageElement(
  { element, applyStyles, elementProps = {}, children },
  ref
) {
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
        ref={ref}
        {...elementProps}
      />
      {children}
    </div>
  );
}

export default React.forwardRef(ImageElement);
