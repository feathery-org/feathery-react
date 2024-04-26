import React, { useMemo } from 'react';
import ResponsiveStyles, { borderColorProps, ERROR_COLOR } from '../styles';
import { adjustColor } from '../../utils/styles';

export default function useBorder({
  element,
  defaultHover = false,
  error = false
}: any) {
  const styles = useMemo(() => {
    const styles = new ResponsiveStyles(
      element,
      ['border', 'borderHover', 'borderActive', 'borderDisabled'],
      true
    );
    styles.applyCorners('border');
    styles.applyBorders({ target: 'border' });

    if (element.styles.hover_border_top_color) {
      styles.applyBorders({
        target: 'borderHover',
        prefix: 'hover_'
      });
    } else if (defaultHover) {
      // default hover effect
      styles.apply('borderHover', borderColorProps, (...colors: any) => {
        const newStyles: Record<string, string> = {};
        borderColorProps.forEach((prop, index) => {
          newStyles[prop] = `${adjustColor(colors[index], -45)} !important`;
        });
        return newStyles;
      });
    }
    styles.applyBorders({
      target: 'borderActive',
      prefix: 'selected_'
    });
    styles.applyBorders({
      target: 'borderDisabled',
      prefix: 'disabled_'
    });
    return styles;
  }, [element.styles, element.mobile_styles]);

  const borderId = `bb-${element.id}`;
  const borderSelector = `#${borderId}`;
  return {
    borderStyles: {
      hover: { [borderSelector]: styles.getTarget('borderHover') },
      active: { [borderSelector]: styles.getTarget('borderActive') },
      disabled: { [borderSelector]: styles.getTarget('borderDisabled') }
    },
    customBorder: (
      <div
        id={borderId}
        css={{
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          right: 0,
          transition: '0.2s ease all !important',
          ...styles.getTarget('border'),
          ...(error ? { borderColor: ERROR_COLOR } : {})
        }}
      />
    ),
    borderId
  };
}
