import ButtonGroupField from './ButtonGroupField';
import CheckboxField from './CheckboxField';
import CheckboxGroupField from './CheckboxGroupField';
import ColorPickerField from './ColorPickerField';
import DropdownField from './DropdownField';
import FileUploadField from './FileUploadField';
import MultiFileUploadField from './MultiFileUploadField';
import PinInputField from './PinInputField';
import RadioButtonGroupField from './RadioButtonGroupField';
import RichFileUploadField from './RichFileUploadField';
import SignatureField from './SignatureField';
import TextField from './TextField';
import React, { memo, useMemo } from 'react';

const Fields = {
  ButtonGroupField,
  CheckboxField,
  CheckboxGroupField,
  ColorPickerField,
  DropdownField,
  FileUploadField,
  MultiFileUploadField,
  PinInputField,
  RadioButtonGroupField,
  RichFileUploadField,
  SignatureField,
  TextField
};

function applyFieldStyles(field, styles) {
  styles.addTargets('fc', 'field', 'error', 'active', 'hover');

  styles.applyFontStyles('fc');
  styles.applyMargin('fc');
  styles.applySelectorStyles('active', 'selected_');
  styles.applySelectorStyles('hover', 'hover_');
  styles.apply('error', 'font_family', (a) => ({
    fontFamily: a
  }));
  styles.apply('error', 'font_size', (a) => ({
    fontSize: `${a}px`
  }));

  const type = field.servar.type;
  switch (type) {
    case 'signature':
      styles.apply('fc', 'width', (a) => ({
        width: `${a}px`
      }));
      styles.applyColor('field', 'background_color', 'backgroundColor');
      styles.applyCorners('field');
      styles.applyBorders('field');
      styles.applyBoxShadow('field');
      break;
    case 'rich_file_upload':
      styles.applyHeight('fc');
      styles.applyWidth('fc');
      styles.apply(
        'field',
        [
          'cta_padding_top',
          'cta_padding_right',
          'cta_padding_bottom',
          'cta_padding_left'
        ],
        (a, b, c, d) => ({
          padding: `${a}px ${b}px ${c}px ${d}px`
        })
      );
      styles.applyColor('field', 'background_color', 'backgroundColor');
      break;
    case 'rich_multi_file_upload':
      styles.addTargets('ac', 'add');
      styles.applyHeight('field');
      styles.applyWidth('field');
      styles.applyHeight('ac');
      styles.applyWidth('ac');
      styles.apply(
        'ac',
        [
          'uploader_padding_top',
          'uploader_padding_right',
          'uploader_padding_bottom',
          'uploader_padding_left'
        ],
        (a, b, c, d) => ({
          padding: `${a}px ${b}px ${c}px ${d}px`
        })
      );
      styles.apply(
        'add',
        [
          'cta_padding_top',
          'cta_padding_right',
          'cta_padding_bottom',
          'cta_padding_left'
        ],
        (a, b, c, d) => ({
          padding: `${a}px ${b}px ${c}px ${d}px`
        })
      );
      styles.applyColor('add', 'background_color', 'backgroundColor');
      break;
    case 'button_group':
      styles.apply('fc', 'layout', (a) => ({
        alignItems: a
      }));
      styles.apply('fc', 'vertical_layout', (a) => ({
        justifyContent: a
      }));
      styles.applyHeight('field', true);
      styles.applyWidth('field', true);
      styles.applyColor('field', 'background_color', 'backgroundColor');
      styles.applyBoxShadow('field');
      styles.applyCorners('field');
      styles.applyBorders('field');
      styles.applyMargin('field');
      break;
    case 'checkbox':
      styles.applyMargin('fc');
      break;
    case 'dropdown':
    case 'gmap_state':
      styles.addTargets('sub-fc');
      styles.applyHeight('sub-fc');
      styles.applyMargin('fc');
      styles.applyWidth('fc');
      styles.applyBorders('field');
      styles.applyCorners('field');
      styles.applyHeight('field');
      styles.applyBoxShadow('field');
      styles.applyColor('field', 'background_color', 'backgroundColor');
      if (field.properties.placeholder)
        styles.applyPlaceholderStyles(type, field.styles);
      break;
    case 'pin_input':
      styles.applyMargin('fc');
      styles.applyWidth('field');
      styles.applyHeight('field');
      styles.applyBoxShadow('field');
      styles.applyCorners('field');
      styles.applyColor('field', 'background_color', 'backgroundColor');
      styles.apply('field', 'font_size', (a) => ({
        fontSize: `${a}px`
      }));
      styles.applyColor('field', 'font_color', 'color');
      break;
    case 'multiselect':
      styles.applyMargin('fc');
      styles.applyCorners('field');
      styles.applyBorders('field');
      styles.applyBoxShadow('field');
      styles.applyFontStyles('field');
      styles.applyColor('field', 'background_color', 'backgroundColor');
      styles.apply('field', 'font_size', (a) => ({
        height: `${parseInt(a) + 4}px`
      }));
      break;
    case 'select':
      styles.applyMargin('fc');
      styles.applyCorners('field');
      styles.applyBorders('field');
      styles.applyBoxShadow('field');
      styles.applyFontStyles('field');
      styles.applyColor('field', 'background_color', 'backgroundColor');
      styles.apply('field', 'font_size', (a) => ({
        height: `${parseInt(a) + 4}px`
      }));
      break;
    case 'hex_color':
      styles.applyMargin('fc');
      styles.applyCorners('field');
      styles.applyBorders('field');
      break;
    default:
      styles.addTargets('sub-fc', 'tooltipIcon');
      styles.applyMargin('fc');
      styles.applyWidth('fc');
      styles.applyHeight('sub-fc');
      styles.applyBoxShadow('field');
      styles.applyCorners('field');
      styles.applyBorders('field');
      styles.applyFontStyles('field');
      styles.applyColor('field', 'background_color', 'backgroundColor');
      if (field.properties.placeholder)
        styles.applyPlaceholderStyles(type, field.styles);
      styles.apply('tooltipIcon', 'font_size', (a) => ({
        width: `${a}px`
      }));
      break;
  }
  return styles;
}

Object.entries(Fields).map(([key, Field]) => {
  Fields[key] = memo(({ element, applyStyles, inlineError = '', ...props }) => {
    const servar = element.servar;
    const fieldLabel = servar.name ? (
      <label
        htmlFor={servar.key}
        style={{
          marginBottom: '10px',
          display: 'inline-block'
        }}
      >
        {servar.name}
      </label>
    ) : null;
    const styles = useMemo(() => applyFieldStyles(element, applyStyles), [
      element
    ]);
    return (
      <>
        <Field
          element={element}
          fieldLabel={fieldLabel}
          inlineError={inlineError}
          applyStyles={styles}
          {...props}
        />
        {inlineError && (
          <span
            css={{
              alignSelf: 'flex-start',
              marginTop: '3px',
              color: '#F42525',
              ...applyStyles.getTarget('error')
            }}
          >
            {inlineError}
          </span>
        )}
      </>
    );
  });
});

export default Fields;
