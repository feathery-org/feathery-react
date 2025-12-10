import { useMemo } from 'react';
import { keyframes } from '@emotion/react';
import ResponsiveStyles from '../../styles';

interface ElementSkeletonProps {
  responsiveStyles: ResponsiveStyles;
  element: any;
}

const shimmerFields = [
  'matrix',
  'multiselect',
  'select',
  'button_group',
  'slider',
  'rating',
  'table_element'
];

const shimmer = keyframes`
  100% {
    transform: translateX(100%);
  }
`;

const shimmerStyles = {
  position: 'relative' as const,
  overflow: 'hidden',
  backgroundColor: '#DDDBDD',
  '&::after': {
    content: '""',
    position: 'absolute' as const,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    transform: 'translateX(-100%)',
    backgroundImage:
      'linear-gradient(90deg, rgba(255, 255, 255, 0) 0, rgba(255, 255, 255, 0.2) 20%, rgba(255, 255, 255, 0.5) 60%, rgba(255, 255, 255, 0))',
    animation: `${shimmer} 5s infinite`
  }
};

function applyStyles(element: any, styles: any) {
  const type = element._type;
  styles.addTargets('fc', 'sub-fc', 'field');
  styles.applyFontStyles('fc', false, true);
  switch (type) {
    case 'checkbox':
      styles.applyHeight('sub-fc');
      styles.applyWidth('sub-fc');
      styles.applyColor('field', 'background_color', 'backgroundColor');
      styles.applyBorders({ target: 'sub-fc' });
      styles.applyCorners('sub-fc');
      styles.applyBoxShadow('sub-fc');
      break;
    case 'multiselect': // checkbox_group
    case 'select': // radio_group
      styles.applyHeight('sub-fc');
      break;
    case 'button_group':
      styles.applyHeight('sub-fc');
      break;
    case 'matrix':
      styles.applyHeight('sub-fc');
      break;
    case 'signature':
      styles.applyHeight('sub-fc');
      styles.applyColor('field', 'background_color', 'backgroundColor');
      styles.applyCorners('field');
      styles.applyBorders({ target: 'field' });
      styles.applyBoxShadow('field');
      break;
    case 'file_upload':
      styles.addTargets('sub-fc');
      styles.applyHeight('field');
      styles.applyBorders({ target: 'field' });
      styles.applyCorners('field');
      styles.applyBoxShadow('field');
      styles.applyColor('sub-fc', 'background_color', 'backgroundColor');
      break;
    case 'slider':
      styles.applyHeight('sub-fc');
      styles.applyCorners('field');
      break;
    case 'pin_input':
      styles.applyHeight('field');
      styles.applyWidth('field');
      styles.applyColor('field', 'background_color', 'backgroundColor');
      styles.applyBorders({ target: 'sub-fc' });
      styles.applyCorners('sub-fc');
      styles.applyBoxShadow('sub-fc');
      break;
    case 'rating':
      styles.applyHeight('sub-fc');
      break;
    case 'hex_color':
      styles.applyHeight('sub-fc');
      styles.applyColor('field', 'background_color', 'backgroundColor');
      styles.applyBorders({ target: 'sub-fc' });
      styles.applyCorners('sub-fc');
      styles.applyBoxShadow('sub-fc');
      break;
    case 'qr_scanner':
      styles.applyHeight('sub-fc');
      break;
    default:
      styles.applyHeight('sub-fc');
      styles.applyColor('field', 'background_color', 'backgroundColor');
      styles.applyBorders({ target: 'sub-fc' });
      styles.applyCorners('sub-fc');
      styles.applyBoxShadow('sub-fc');
      break;
  }

  return styles;
}

export default function ElementSkeleton({
  responsiveStyles,
  element
}: ElementSkeletonProps) {
  const type = element._type;

  const styles = useMemo(
    () => applyStyles(element, responsiveStyles),
    [element, responsiveStyles]
  );

  const renderPinInput = () => {
    const maxLength = element.servar.max_length || 6;
    const pinDivs = [];

    for (let i = 0; i < maxLength; i++) {
      pinDivs.push(
        <div
          key={i}
          css={{
            marginLeft: i === 0 ? 0 : '8px',
            ...styles.getTarget('sub-fc')
          }}
        >
          <div
            css={{
              position: 'relative',
              border: 'none',
              margin: 0,
              backgroundColor: 'transparent',
              boxSizing: 'border-box',
              ...styles.getTarget('field')
            }}
          />
        </div>
      );
    }

    return pinDivs;
  };

  const heightAdjust: any = {};
  // apply button height to button group skeleton
  if (type === 'button_group') {
    const height = element.styles?.height_unit;
    if (height === 'fit') {
      const buttonHeight = element.styles?.button_height;
      const buttonHeightUnit = element.styles?.button_height_unit || 'px';
      if (buttonHeight) {
        heightAdjust.height = `${buttonHeight}${buttonHeightUnit}`;
      }
    }
  } else if (type === 'qr_scanner') {
    heightAdjust.height = '166px'; // hardcode qr scanner height
  }

  if (!element.servar) {
    return (
      <div
        css={{
          maxWidth: '100%',
          width: '100%',
          height: '100%',
          position: 'relative',
          boxSizing: 'border-box'
        }}
      >
        <div
          css={{
            width: '100%',
            boxSizing: 'border-box',
            ...heightAdjust,
            ...shimmerStyles
          }}
        ></div>
      </div>
    );
  }
  return (
    <div
      css={{
        maxWidth: '100%',
        width: '100%',
        height: '100%',
        position: 'relative',
        boxSizing: 'border-box',
        ...styles.getTarget('fc')
      }}
    >
      {type === 'pin_input' ? (
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {renderPinInput()}
        </div>
      ) : (
        <div
          css={{
            width: '100%',
            boxSizing: 'border-box',
            ...styles.getTarget('sub-fc'),
            ...heightAdjust,
            ...(shimmerFields.includes(type) ? shimmerStyles : {})
          }}
        >
          <div
            css={{
              position: 'relative',
              height: '100%',
              width: '100%',
              border: 'none',
              margin: 0,
              backgroundColor: 'transparent',
              boxSizing: 'border-box',
              ...styles.getTarget('field')
            }}
          />
        </div>
      )}
    </div>
  );
}
