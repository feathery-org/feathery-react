import ButtonGroupField from './ButtonGroupField';
import CheckboxField from './CheckboxField';
import CheckboxGroupField from './CheckboxGroupField';
import ColorPickerField from './ColorPickerField';
import DateSelectorField from './DateSelectorField';
import DropdownField from './DropdownField';
import FileUploadField from './FileUploadField';
import PhoneField from './PhoneField';
import PinInputField from './PinInputField';
import RadioButtonGroupField from './RadioButtonGroupField';
import SignatureField from './SignatureField';
import TextField from './TextField';
import TextArea from './TextArea';
import React, { memo, useMemo } from 'react';
import AddressLine1 from './AddressLine1';
import PaymentMethodField from './PaymentMethodField';

const Fields = {
  AddressLine1,
  ButtonGroupField,
  CheckboxField,
  CheckboxGroupField,
  ColorPickerField,
  DateSelectorField,
  DropdownField,
  FileUploadField,
  PaymentMethodField,
  PhoneField,
  PinInputField,
  RadioButtonGroupField,
  SignatureField,
  TextField,
  TextArea
};

function applyFieldStyles(field: any, styles: any) {
  styles.addTargets('fc', 'field', 'error', 'active', 'hover');

  styles.applyFontStyles('fc');
  styles.applySelectorStyles('active', 'selected_', true);
  styles.applySelectorStyles('hover', 'hover_', true);
  styles.apply('error', 'font_family', (a: any) => ({
    fontFamily: a
  }));
  styles.apply('error', 'font_size', (a: any) => ({
    fontSize: `${a}px`
  }));

  const type = field.servar.type;
  switch (type) {
    case 'signature':
      styles.applyWidth('fc');
      styles.applyHeight('sub-fc');
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
        // @ts-expect-error TS(7006): Parameter 'a' implicitly has an 'any' type.
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
        // @ts-expect-error TS(7006): Parameter 'a' implicitly has an 'any' type.
        (a, b, c, d) => ({
          padding: `${a}px ${b}px ${c}px ${d}px`
        })
      );
      break;
    case 'button_group':
      styles.addTargets('img', 'tc');
      styles.apply('fc', 'layout', (a: any) => ({
        alignItems: a
      }));
      styles.apply('fc', 'vertical_layout', (a: any) => ({
        justifyContent: a
      }));
      // Cancel out extra per-button margins on the edges
      styles.apply(
        'fc',
        ['padding_top', 'padding_right', 'padding_bottom', 'padding_left'],
        (a: any, b: any, c: any, d: any) => {
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
        // @ts-expect-error TS(7006): Parameter 'a' implicitly has an 'any' type.
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
      styles.apply('field', 'font_size', (a: any) => ({
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
      styles.apply('field', 'font_size', (a: any) => ({
        height: `${parseInt(a) + 4}px`
      }));
      break;
    case 'select':
      styles.applyCorners('field');
      styles.applyBorders('field');
      styles.applyBoxShadow('field');
      styles.applyFontStyles('field');
      styles.applyColor('field', 'background_color', 'backgroundColor');
      styles.apply('field', 'font_size', (a: any) => ({
        height: `${parseInt(a) + 4}px`
      }));
      break;
    case 'hex_color':
      styles.applyCorners('field');
      styles.applyBorders('field');
      break;
    case 'payment_method':
      styles.addTargets('sub-fc', 'tooltipIcon', 'completed');
      styles.addTargets('active', 'hover'); // resetting these targets here
      styles.applyHeight('sub-fc');
      styles.applyWidth('fc');
      styles.applyCorners('sub-fc');
      styles.applyBorders('sub-fc');
      styles.applyColor('sub-fc', 'background_color', 'backgroundColor');
      styles.applyBoxShadow('sub-fc');
      styles.applyFontStyles('field');

      styles.applySelectorStyles('active', 'selected_', false); // no !important allowed
      styles.applySelectorStyles('hover', 'hover_', false); // no !important allowed
      // iconColor is specific to stripe card element
      styles.apply('field', 'placeholder_color', (a: any) => ({
        iconColor: `#${a}`
      }));
      styles.apply('hover', 'hover_placeholder_color', (a: any) => ({
        iconColor: `#${a}`
      }));
      styles.apply('active', 'selected_placeholder_color', (a: any) => ({
        iconColor: `#${a}`
      }));
      styles.apply('completed', 'completed_placeholder_color', (a: any) => ({
        iconColor: `#${a}`
      }));
      styles.applyPlaceholderStyles(type, field.styles);
      styles.apply('tooltipIcon', 'font_size', (a: any) => ({
        width: `${a}px`
      }));
      styles.apply('completed', 'completed_font_color', (a: any) => ({
        color: `#${a}`
      }));
      break;
    default:
      styles.addTargets('sub-fc', 'tooltipIcon');
      // Avoid applying width to checkbox to ensure the checkbox width is properly set by the component
      if (type !== 'checkbox') styles.applyWidth('fc');
      styles.applyHeight('sub-fc');
      styles.applyBoxShadow('field');
      styles.applyCorners('field');
      styles.applyBorders('field');
      styles.applyFontStyles('field');
      styles.applyColor('field', 'background_color', 'backgroundColor');
      if (field.properties.placeholder || type === 'phone_number')
        styles.applyPlaceholderStyles(type, field.styles);
      styles.apply('tooltipIcon', 'font_size', (a: any) => ({
        width: `${a}px`
      }));

      if (type === 'phone_number') {
        styles.addTargets('fieldToggle', 'dropdown');
        styles.apply('fieldToggle', 'font_size', (a: any) => ({
          fontSize: `${1.5 * a}px`,
          width: `${3 * a}px`
        }));
        styles.apply(
          'fieldToggle',
          ['corner_top_left_radius', 'corner_bottom_left_radius'],
          (a: any, b: any) => ({
            borderTopLeftRadius: `${a}px`,
            borderBottomLeftRadius: `${b}px`
          })
        );
        styles.apply('field', 'font_size', (a: any) => ({
          paddingLeft: `${3.5 * a}px`
        }));
        styles.apply('placeholder', 'font_size', (a: any) => ({
          left: `${3.5 * a}px`
        }));
      }
      break;
  }
  return styles;
}

Object.entries(Fields).map(([key, Field]) => {
  // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
  Fields[key] = memo(({ element, applyStyles, ...props }) => {
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
    const styles = useMemo(
      () => applyFieldStyles(element, applyStyles),
      [element]
    );
    return (
      <>
        <Field
          element={element}
          fieldLabel={fieldLabel}
          applyStyles={styles}
          {...props}
        />
      </>
    );
  });
});

export default Fields;
