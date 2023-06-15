import React, { useMemo } from 'react';

// Draws a checkmark, similar in dimensions to the default Chrome checkbox, in CSS
const checkmarkClipPath =
  'polygon(40% 85%, 89% 23%, 76% 12%, 39% 59%, 23% 44%, 12% 55%)';

const MIN_CHECKBOX_PX = 13;

// Possibly extract this to its own file, however the radio type is nearly identical to checkbox
const radio = (size: any, color: any) => {
  size = Math.floor(size / 1.7);
  return {
    height: size,
    width: size,
    minWidth: size,
    minHeight: size,
    border: 0,
    boxShadow: `inset ${size}px ${size}px #${color}`,
    borderRadius: '50%'
  };
};

const checkbox = (size: any, color: any) => {
  return {
    boxShadow: `inset ${size}px ${size}px #${color}`,
    clipPath: checkmarkClipPath
  };
};

const scaleCheckboxSize = (fontSize: any) => {
  return Math.max(Math.floor(fontSize * 0.5), MIN_CHECKBOX_PX);
};

export const applyHeightAndWidthByFontSize = (
  responsiveStyles: any,
  target: any
) => {
  responsiveStyles.apply(target, ['font_size'], (fontSize: any) => {
    const scaledSize = `${scaleCheckboxSize(fontSize)}px`;
    return {
      minHeight: scaledSize,
      height: scaledSize,
      minWidth: scaledSize,
      width: scaledSize
    };
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
    'checkboxCheckmarkHover'
  );

  const {
    servar: { type }
  } = element;

  const isRadioGroup = type === 'select';
  const isCheckboxGroup = type === 'multiselect' || type === 'checkbox_group';

  const scaleWithFontSize = isCheckboxGroup || isRadioGroup;

  // width/height styles
  if (scaleWithFontSize) {
    applyHeightAndWidthByFontSize(responsiveStyles, 'checkbox');
    applyHeightAndWidthByFontSize(responsiveStyles, 'checkboxCheckmark');
    applyHeightAndWidthByFontSize(responsiveStyles, 'checkboxCheckmarkHover');
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
  responsiveStyles.applyColor('checkbox', 'font_color', 'color', true);

  responsiveStyles.applySelectorStyles('checkboxHover', 'hover_', true);
  responsiveStyles.applySelectorStyles('checkboxSelected', 'selected_', true);

  return responsiveStyles;
}

export const composeCheckableInputStyle = (
  styles: any,
  group = false,
  isRadio = false
) => {
  return {
    position: 'static',
    marginLeft: 5,
    marginRight: group ? 10 : 5,
    marginTop: group ? (isRadio ? 4 : 3) : 0,
    marginBottom: 0,
    appearance: 'none',
    display: 'grid',
    placeContent: 'center',
    borderRadius: isRadio ? '50%' : null, // Force radio buttons to be round
    ...styles.getTarget('checkbox'),
    '&:hover': styles.getTarget('checkboxHover'),
    '&::before': {
      content: "''",
      transform: 'scale(0)',
      ...styles.getTarget('checkboxCheckmark')
    },
    '&:hover::before': {
      ...styles.getTarget('checkboxCheckmark'),
      ...styles.getTarget('checkboxCheckmarkHover')
    },
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
        display: 'flex'
      }}
      {...elementProps}
    >
      {children}
      <input
        id={servar.key}
        type='checkbox'
        checked={fieldVal}
        disabled={element.properties.disabled ?? false}
        onChange={onChange}
        style={{ marginTop: '5px', marginRight: '5px' }}
        css={composeCheckableInputStyle(styles)}
      />
      {fieldLabel}
    </div>
  );
}

export default CheckboxField;
