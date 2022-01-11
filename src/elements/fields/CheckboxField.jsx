import React, { useMemo } from 'react';
import Form from 'react-bootstrap/Form';

// Draws a checkmark, similar in dimensions to the default Chrome checkbox, in CSS
const checkmarkClipPath =
  'polygon(40% 85%, 89% 23%, 76% 12%, 39% 59%, 23% 44%, 12% 55%)';

const MIN_CHECKBOX_PX = 13;

const scaleCheckboxSize = (fontSize) => {
  return Math.max(Math.floor(fontSize * 0.5), MIN_CHECKBOX_PX);
};

const applyHeightAndWidthByFontSize = (applyStyles, target) => {
  applyStyles.apply(target, ['font_size'], (fontSize) => {
    const scaledSize = `${scaleCheckboxSize(fontSize)}px`;
    return { height: scaledSize, width: scaledSize };
  });
};

const applyCheckmarkByFontSize = (applyStyles, target, colorProperty) => {
  applyStyles.apply(target, ['font_size', colorProperty], (fontSize, color) => {
    const scaledSize = `${scaleCheckboxSize(fontSize)}px`;
    return {
      boxShadow: `inset ${scaledSize} ${scaledSize} #${color}`,
      clipPath: checkmarkClipPath
    };
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

export function applyCheckboxStyles(element, applyStyles) {
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

  const scaleWithFontSize = type === 'multiselect' || type === 'checkbox_group';

  // width/height styles
  if (scaleWithFontSize) {
    applyHeightAndWidthByFontSize(applyStyles, 'checkbox');
    applyHeightAndWidthByFontSize(applyStyles, 'checkboxCheckmark');
    applyHeightAndWidthByFontSize(applyStyles, 'checkboxCheckmarkHover');
    applyCheckmarkByFontSize(
      applyStyles,
      'checkboxCheckmark',
      'selected_font_color'
    );
    applyCheckmarkByFontSize(
      applyStyles,
      'checkboxCheckmarkHover',
      'hover_font_color'
    );
  } else {
    applyStyles.applyHeight('checkbox');
    applyStyles.applyWidth('checkbox');
    applyStyles.applyHeight('checkboxCheckmark');
    applyStyles.applyWidth('checkboxCheckmark');
    applyStyles.applyHeight('checkboxCheckmarkHover');
    applyStyles.applyWidth('checkboxCheckmarkHover');
    applyCheckmark(applyStyles, 'checkboxCheckmark', 'selected_font_color');
    applyCheckmark(applyStyles, 'checkboxCheckmarkHover', 'hover_font_color');
  }

  // base styles
  applyStyles.applyMargin('fc');
  applyStyles.applyBorders('checkbox');
  applyStyles.applyCorners('checkbox');
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

export const composeCheckboxStyle = (styles) => {
  return {
    'input[type="checkbox"]': {
      position: 'static',
      marginLeft: 5,
      marginRight: 5,
      marginTop: 0,
      marginBottom: 0,
      appearance: 'none',
      display: 'grid',
      placeContent: 'center',
      ...styles.getTarget('checkbox')
    },
    'input[type="checkbox"]:hover': {
      ...styles.getTarget('checkboxHover')
    },
    'input[type="checkbox"]::before': {
      content: "''",
      transform: 'scale(0)',
      ...styles.getTarget('checkboxCheckmark')
    },
    'input[type="checkbox"]:hover::before': {
      ...styles.getTarget('checkboxCheckmark'),
      ...styles.getTarget('checkboxCheckmarkHover')
    },
    'input[type="checkbox"]:checked': {
      ...styles.getTarget('checkboxSelected')
    },
    'input[type="checkbox"]:checked::before': {
      transform: 'scale(1)',
      ...styles.getTarget('checkboxSelected')
    }
  };
};

function CheckboxField({
  element,
  applyStyles,
  fieldLabel,
  fieldVal = true,
  onChange = () => {},
  onClick = () => {},
  elementProps = {}
}) {
  const styles = useMemo(() => applyCheckboxStyles(element, applyStyles), [
    applyStyles
  ]);

  const servar = element.servar;

  return (
    <div css={applyStyles.getTarget('fc')} {...elementProps}>
      {fieldLabel}
      <Form.Check
        id={servar.key}
        type='checkbox'
        checked={fieldVal}
        onChange={onChange}
        onClick={onClick}
        style={{
          display: 'flex',
          alignItems: 'center'
        }}
        css={composeCheckboxStyle(styles)}
      />
    </div>
  );
}

export default CheckboxField;
