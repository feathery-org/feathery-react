import ButtonGroupField from './ButtonGroupField';
import CheckboxField from './CheckboxField';
import CheckboxGroupField from './CheckboxGroupField';
import ColorPickerField from './ColorPickerField';
import DropdownField from './DropdownField';
import FileUploadField from './FileUploadField';
import PinInputField from './PinInputField';
import RadioButtonGroupField from './RadioButtonGroupField';
import SignatureField from './SignatureField';
import TextField from './TextField';
import TextArea from './TextArea';
import React, { memo, useMemo } from 'react';
import AddressLine1 from './AddressLine1';

const Fields = {
  AddressLine1,
  ButtonGroupField,
  CheckboxField,
  CheckboxGroupField,
  ColorPickerField,
  DropdownField,
  FileUploadField,
  PinInputField,
  RadioButtonGroupField,
  SignatureField,
  TextField,
  TextArea
};

function applyFieldStyles(field, styles) {
  styles.addTargets('fc', 'field', 'error', 'active', 'hover');

  styles.applyFontStyles('fc');
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
      styles.applyWidth('fc');
      styles.applyColor('field', 'background_color', 'backgroundColor');
      styles.applyCorners('field');
      styles.applyBorders('field');
      styles.applyBoxShadow('field');
      break;
    case 'file_upload':
      styles.addTargets('ac', 'add');
      styles.applyHeight('ac');
      styles.applyWidth('ac');
      if (!field.servar.metadata.multiple) {
        styles.applyHeight('fc');
        styles.applyWidth('fc');
      }
      styles.applyHeight('field');
      styles.applyWidth('field');
      styles.applyBorders('field');
      styles.applyCorners('field');
      styles.applyBoxShadow('field');
      styles.applyColor('ac', 'background_color', 'backgroundColor');
      styles.applyBorders('ac');
      styles.applyCorners('ac');
      styles.applyBoxShadow('ac');
      styles.applyFlexDirection('ac');
      styles.applyWidth('img', 'image_');
      styles.applyMargin('img', 'image_');
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
      break;
    case 'button_group':
      styles.addTargets('img', 'tc');
      styles.apply('fc', 'layout', (a) => ({
        alignItems: a
      }));
      styles.apply('fc', 'vertical_layout', (a) => ({
        justifyContent: a
      }));
      // Cancel out extra per-button margins on the edges
      styles.apply(
        'fc',
        ['padding_top', 'padding_right', 'padding_bottom', 'padding_left'],
        (a, b, c, d) => {
          return {
            margin: `${-a}px ${-b}px ${-c}px ${-d}px`
          };
        }
      );
      styles.applyHeight('field', '', true);
      styles.applyWidth('field', '', true);
      styles.applyColor('field', 'background_color', 'backgroundColor');
      styles.applyBoxShadow('field');
      styles.applyCorners('field');
      styles.applyBorders('field');
      styles.applyPadding('field', '', true);
      styles.applyFlexAndTextAlignments('field');
      styles.apply(
        'field',
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
      styles.applyWidth('img', 'image_');
      styles.applyMargin('img', 'image_');
      break;
    case 'dropdown':
    case 'gmap_state':
      styles.addTargets('sub-fc');
      styles.applyHeight('sub-fc');
      styles.applyWidth('fc');
      styles.applyBorders('field');
      styles.applyCorners('field');
      styles.applyHeight('field');
      styles.applyBoxShadow('field');
      styles.applyColor('field', 'background_color', 'backgroundColor');
      if (field.properties.placeholder)
        styles.applyPlaceholderStyles(type, field.styles);
      // Override default bootstrap styles
      styles.applyBoxShadow('active');
      styles.applyBorders('active');
      break;
    case 'pin_input':
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
      styles.applyCorners('field');
      styles.applyBorders('field');
      break;
    default:
      styles.addTargets('sub-fc', 'tooltipIcon');
      if (type !== 'checkbox') styles.applyWidth('fc');
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
