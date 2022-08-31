import React, { useMemo } from 'react';
import Form from 'react-bootstrap/Form';

// Draws a checkmark, similar in dimensions to the default Chrome checkbox, in CSS
const checkmarkClipPath =
  'polygon(40% 85%, 89% 23%, 76% 12%, 39% 59%, 23% 44%, 12% 55%)';

const MIN_CHECKBOX_PX = 13;

// Possibly extract this to its own file, however the radio type is nearly identical to checkbox
const radio = (size, color) => {
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

const checkbox = (size, color) => {
  return {
    boxShadow: `inset ${size}px ${size}px #${color}`,
    clipPath: checkmarkClipPath
  };
};

const scaleCheckboxSize = (fontSize) => {
  return Math.max(Math.floor(fontSize * 0.5), MIN_CHECKBOX_PX);
};

const applyHeightAndWidthByFontSize = (applyStyles, target) => {
  applyStyles.apply(target, ['font_size'], (fontSize) => {
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
  applyStyles,
  target,
  colorProperty,
  isRadio
) => {
  applyStyles.apply(target, ['font_size', colorProperty], (fontSize, color) => {
    const scaledSize = scaleCheckboxSize(fontSize);
    return isRadio ? radio(scaledSize, color) : checkbox(scaledSize, color);
  });
};

const applyCheckmark = (applyStyles, target, colorProperty) => {
  applyStyles.apply(
    target,
    ['height', 'height_unit', 'width', 'width_unit', colorProperty],
    (height, heightUnit, width, widthUnit, color) => {
      return {
        boxShadow: `inset ${width}${widthUnit} ${height}${heightUnit} #${color}`,
        clipPath: checkmarkClipPath
      };
    }
  );
};

export function applyCheckableInputStyles(element, applyStyles) {
  applyStyles.addTargets(
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
    applyHeightAndWidthByFontSize(applyStyles, 'checkbox');
    applyHeightAndWidthByFontSize(applyStyles, 'checkboxCheckmark');
    applyHeightAndWidthByFontSize(applyStyles, 'checkboxCheckmarkHover');
    applyCheckmarkByFontSize(
      applyStyles,
      'checkboxCheckmark',
      'selected_font_color',
      isRadioGroup
    );
    applyCheckmarkByFontSize(
      applyStyles,
      'checkboxCheckmarkHover',
      'hover_font_color',
      isRadioGroup
    );
  } else {
    applyStyles.applyHeight('checkbox');
    applyStyles.applyWidth('checkbox');
    applyStyles.applyHeight('checkboxCheckmark');
    applyStyles.applyWidth('checkboxCheckmark');
    applyStyles.applyHeight('checkboxCheckmarkHover');
    applyStyles.applyWidth('checkboxCheckmarkHover');
    applyCheckmark(
      applyStyles,
      'checkboxCheckmark',
      'selected_font_color',
      isRadioGroup
    );
    applyCheckmark(
      applyStyles,
      'checkboxCheckmarkHover',
      'hover_font_color',
      isRadioGroup
    );
  }

  // base styles
  applyStyles.applyBorders('checkbox');
  if (!isRadioGroup) applyStyles.applyCorners('checkbox');
  applyStyles.applyBoxShadow('checkbox');
  applyStyles.applyColor(
    'checkbox',
    'background_color',
    'backgroundColor',
    true
  );
  applyStyles.applyColor('checkbox', 'font_color', 'color', true);

  // hover styles
  applyStyles.applyBorders('checkboxHover', 'hover_');
  applyStyles.applyColor(
    'checkboxHover',
    'hover_background_color',
    'backgroundColor',
    true
  );

  // selected styles
  applyStyles.applyBorders('checkboxSelected', 'selected_');
  applyStyles.applyColor(
    'checkboxSelected',
    'selected_background_color',
    'backgroundColor',
    true
  );

  return applyStyles;
}

export const composeCheckableInputStyle = (
  styles,
  group = false,
  type = 'checkbox'
) => {
  const isRadio = type === 'radio';
  return {
    [`input[type="${type}"]`]: {
      position: 'static',
      marginLeft: 5,
      marginRight: group ? 10 : 5,
      marginTop: group ? 3 : 0,
      marginBottom: 0,
      appearance: 'none',
      display: 'grid',
      placeContent: 'center',
      borderRadius: isRadio ? '50%' : null, // Force radio buttons to be round
      ...styles.getTarget('checkbox')
    },
    [`input[type="${type}"]:hover`]: {
      ...styles.getTarget('checkboxHover')
    },
    [`input[type="${type}"]::before`]: {
      content: "''",
      transform: 'scale(0)',
      ...styles.getTarget('checkboxCheckmark')
    },
    [`input[type="${type}"]:hover::before`]: {
      ...styles.getTarget('checkboxCheckmark'),
      ...styles.getTarget('checkboxCheckmarkHover')
    },
    [`input[type="${type}"]:checked`]: {
      ...styles.getTarget('checkboxSelected')
    },
    [`input[type="${type}"]:checked::before`]: {
      transform: 'scale(1)'
    }
  };
};

function CheckboxField({
  element,
  applyStyles,
  fieldLabel,
  fieldVal = true,
  onChange = () => {},
  elementProps = {},
  children
}) {
  const styles = useMemo(
    () => applyCheckableInputStyles(element, applyStyles),
    [applyStyles]
  );

  const servar = element.servar;

  return (
    <div
      css={{ ...applyStyles.getTarget('fc'), position: 'relative' }}
      {...elementProps}
    >
      {fieldLabel}
      <Form.Check
        id={servar.key}
        type='checkbox'
        checked={fieldVal}
        onChange={onChange}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: 0
        }}
        css={composeCheckableInputStyle(styles)}
      />
      {children}
    </div>
  );
}

export default CheckboxField;
