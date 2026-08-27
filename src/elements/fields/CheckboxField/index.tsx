import React, { useMemo } from 'react';
import { hoverStylesGuard, iosScrollOnFocus } from '../../../utils/browser';
import { fieldAriaLabel } from '../shared/accessibleName';

// Draws a checkmark, similar in dimensions to the default Chrome checkbox, in CSS
const checkmarkClipPath =
  'polygon(40% 85%, 89% 23%, 76% 12%, 39% 59%, 23% 44%, 12% 55%)';

const MIN_CHECKBOX_PX = 13;

// Possibly extract this to its own file, however the radio type is nearly identical to checkbox
const radio = (size: any, color: any) => {
  const dotRadius = Math.floor(size / 1.7) / 2;
  // The dot is a radial gradient on a pseudo-element covering the whole input
  // rather than a fixed-px box centered in leftover space: when that leftover
  // is odd, browsers snap the box up to a device pixel off-center at some
  // zoom/DPR levels, while gradients rasterize around the true center
  return {
    position: 'absolute',
    // inset: 0 — spelled out for older Safari, which lacks the shorthand
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    height: 'auto',
    width: 'auto',
    minWidth: 0,
    minHeight: 0,
    border: 0,
    backgroundImage: `radial-gradient(circle, #${color} ${dotRadius}px, transparent ${dotRadius}px)`
  };
};

const checkbox = (size: any, color: any) => {
  return {
    boxShadow: `inset ${size}px ${size}px #${color}`,
    clipPath: checkmarkClipPath
  };
};

const scaleCheckboxSize = (fontSize: any) => {
  return Math.max(fontSize, MIN_CHECKBOX_PX);
};

export const applyHeightWidthMarginByFontSize = (
  responsiveStyles: any,
  target: any,
  single = false
) => {
  responsiveStyles.apply(target, ['font_size'], (fontSize: any) => {
    const scaled = scaleCheckboxSize(fontSize);
    const scaledSize = `${scaled}px`;
    const styles: Record<string, string> = {
      minHeight: scaledSize,
      height: scaledSize,
      minWidth: scaledSize,
      width: scaledSize
    };

    const margin = Math.max(scaled / 2, 10);
    if (!single) styles.marginRight = `${margin}px`;

    return styles;
  });
};

const applyCheckmarkByFontSize = (
  responsiveStyles: any,
  target: any,
  colorProperty: any,
  isRadio: any
) => {
  responsiveStyles.apply(
    target,
    ['font_size', colorProperty],
    (fontSize: any, color: any) => {
      const scaledSize = scaleCheckboxSize(fontSize);
      return isRadio ? radio(scaledSize, color) : checkbox(scaledSize, color);
    }
  );
};

const applyLabelHeightByFontSize = (responsiveStyles: any, target: any) => {
  responsiveStyles.apply(
    target,
    ['font_size', 'line_height'],
    (fontSize: any, lineHeight: any) => {
      if (!lineHeight) lineHeight = scaleCheckboxSize(fontSize);
      const topOffset = (lineHeight - fontSize) / 2;
      return {
        position: 'relative',
        top: `-${topOffset}px`,
        lineHeight: `${lineHeight}px`
      };
    }
  );
};

const applyCheckmark = (
  responsiveStyles: any,
  target: any,
  colorProperty: any
) => {
  responsiveStyles.apply(
    target,
    ['height', 'height_unit', 'width', 'width_unit', colorProperty],
    (height: any, heightUnit: any, width: any, widthUnit: any, color: any) => {
      return {
        boxShadow: `inset ${width}${widthUnit} ${height}${heightUnit} #${color}`,
        clipPath: checkmarkClipPath
      };
    }
  );
};

export function applyCheckableInputStyles(element: any, responsiveStyles: any) {
  responsiveStyles.addTargets(
    'checkbox',
    'checkboxCheckmark',
    'checkboxSelected',
    'checkboxHover',
    'checkboxCheckmarkHover',
    'checkboxLabel'
  );

  const {
    servar: {
      type,
      metadata: { multiple }
    }
  } = element;

  const isRadioGroup = type === 'select' || (type === 'matrix' && !multiple);
  const isCheckboxGroup =
    type === 'multiselect' ||
    type === 'checkbox_group' ||
    (type === 'matrix' && multiple);

  const scaleWithFontSize = isCheckboxGroup || isRadioGroup;

  // width/height styles
  if (scaleWithFontSize) {
    applyLabelHeightByFontSize(responsiveStyles, 'checkboxLabel');
    applyHeightWidthMarginByFontSize(responsiveStyles, 'checkbox', true);
    applyHeightWidthMarginByFontSize(
      responsiveStyles,
      'checkboxCheckmark',
      true
    );
    applyHeightWidthMarginByFontSize(
      responsiveStyles,
      'checkboxCheckmarkHover',
      true
    );
    applyCheckmarkByFontSize(
      responsiveStyles,
      'checkboxCheckmark',
      'selected_font_color',
      isRadioGroup
    );
    applyCheckmarkByFontSize(
      responsiveStyles,
      'checkboxCheckmarkHover',
      'hover_font_color',
      isRadioGroup
    );
  } else {
    responsiveStyles.applyHeight('checkbox');
    responsiveStyles.applyWidth('checkbox');
    responsiveStyles.applyHeight('checkboxCheckmark');
    responsiveStyles.applyWidth('checkboxCheckmark');
    responsiveStyles.applyHeight('checkboxCheckmarkHover');
    responsiveStyles.applyWidth('checkboxCheckmarkHover');
    responsiveStyles.apply(
      'checkbox',
      ['width', 'width_unit', 'label_gap'],
      (width: any, widthUnit: any, labelGap: any) => {
        if (labelGap !== undefined) {
          return { marginRight: `${labelGap}px` };
        }
        if (widthUnit !== 'px' || !width) return {};
        // Scale spacing up between checkbox and label as checkbox size
        // increases. Minimum space of 5px.
        return { marginRight: `${Math.max(Math.round(width * 0.4), 5)}px` };
      }
    );
    applyCheckmark(
      responsiveStyles,
      'checkboxCheckmark',
      'selected_font_color',
      // @ts-expect-error TS(2554): Expected 3 arguments, but got 4.
      isRadioGroup
    );
    applyCheckmark(
      responsiveStyles,
      'checkboxCheckmarkHover',
      'hover_font_color',
      // @ts-expect-error TS(2554): Expected 3 arguments, but got 4.
      isRadioGroup
    );
  }

  // base styles
  responsiveStyles.applyBorders({ target: 'checkbox' });
  if (!isRadioGroup) responsiveStyles.applyCorners('checkbox');
  responsiveStyles.applyBoxShadow('checkbox');
  responsiveStyles.applyColor(
    'checkbox',
    'background_color',
    'backgroundColor',
    true
  );

  responsiveStyles.applySelectorStyles('checkboxHover', {
    prefix: 'hover_',
    important: true
  });
  responsiveStyles.applySelectorStyles('checkboxSelected', {
    prefix: 'selected_',
    important: true
  });

  return responsiveStyles;
}

export const composeCheckableInputStyle = (
  styles: any,
  noHover = false,
  isRadio = false
) => {
  return {
    // Radio inputs anchor their absolutely-positioned ::before dot
    position: isRadio ? 'relative' : 'static',
    marginLeft: 5,
    marginRight: 5,
    marginTop: 0,
    marginBottom: 0,
    appearance: 'none',
    display: 'grid',
    placeContent: 'center',
    // On error in Safari, checkboxes can have a misshapen outline so disable
    outline: 'none',
    borderRadius: isRadio ? '50%' : null, // Force radio buttons to be round
    ...styles.getTarget('checkbox'),
    '&:hover': hoverStylesGuard(
      noHover ? {} : styles.getTarget('checkboxHover')
    ),
    '&::before': {
      content: "''",
      transform: 'scale(0)',
      ...styles.getTarget('checkboxCheckmark')
    },
    '&:hover::before': hoverStylesGuard({
      ...styles.getTarget('checkboxCheckmark'),
      ...styles.getTarget('checkboxCheckmarkHover')
    }),
    '&:checked': {
      ...styles.getTarget('checkboxSelected')
    },
    '&:checked::before': {
      transform: 'scale(1)'
    }
  };
};

function CheckboxField({
  element,
  responsiveStyles,
  fieldLabel,
  fieldVal = true,
  onChange = () => {},
  elementProps = {},
  disabled = false,
  children
}: any) {
  const styles = useMemo(
    () => applyCheckableInputStyles(element, responsiveStyles),
    [responsiveStyles]
  );

  const servar = element.servar;

  return (
    <div
      css={{
        ...responsiveStyles.getTarget('fc'),
        position: 'relative',
        display: 'flex',
        alignItems: 'center'
      }}
      {...elementProps}
    >
      {children}
      <input
        id={servar.key}
        name={servar.key}
        type='checkbox'
        checked={fieldVal}
        disabled={disabled}
        onChange={onChange}
        onFocus={iosScrollOnFocus}
        aria-label={fieldAriaLabel(element)}
        css={{
          ...composeCheckableInputStyle(styles, disabled),
          ...(!fieldLabel ? { marginRight: 5 } : {}),
          ...(disabled ? responsiveStyles.getTarget('disabled') : {}),
          '&:focus-visible': { border: '1px solid rgb(74, 144, 226)' }
        }}
      />
      {fieldLabel}
    </div>
  );
}

export default CheckboxField;
