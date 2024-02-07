import React, { memo, useMemo } from 'react';

import ButtonGroupField from './ButtonGroupField';
import CheckboxField from './CheckboxField';
import CheckboxGroupField from './CheckboxGroupField';
import ColorPickerField from './ColorPickerField';
import DateSelectorField from './DateSelectorField';
import DropdownField from './DropdownField';
import DropdownMultiField from './DropdownMultiField';
import FileUploadField from './FileUploadField';
import PhoneField from './PhoneField';
import PinInputField from './PinInputField';
import RadioButtonGroupField from './RadioButtonGroupField';
import RatingField from './RatingField';
import SignatureField from './SignatureField';
import SliderField from './SliderField';
import TextField from './TextField';
import TextArea from './TextArea';
import AddressLine1 from './AddressLine1';
import PasswordField from './PasswordField';
import PaymentMethodField from './PaymentMethodField';
import MatrixField from './MatrixField';
import { borderWidthProps } from '../styles';
import { DEFAULT_MIN_SIZE } from '../../Form/grid/StyledContainer/styles';
import QRScanner from './QRScanner';

const Fields = {
  AddressLine1,
  ButtonGroupField,
  CheckboxField,
  CheckboxGroupField,
  ColorPickerField,
  DateSelectorField,
  DropdownField,
  DropdownMultiField,
  FileUploadField,
  MatrixField,
  PasswordField,
  PaymentMethodField,
  PhoneField,
  PinInputField,
  QRScanner,
  RadioButtonGroupField,
  RatingField,
  SignatureField,
  SliderField,
  TextField,
  TextArea
};

const justifyContentTextAlignMap = {
  'flex-start': 'left',
  center: 'center',
  'flex-end': 'right'
};

const defaultBorderFields = [
  'slider',
  'checkbox',
  'multiselect',
  'hex_color',
  'select',
  'signature',
  'file_upload'
];

export const DROPDOWN_Z_INDEX = 10;

function applyFieldStyles(field: any, styles: any) {
  const type = field?.servar?.type || field.type;
  styles.addTargets(
    'fc',
    'sub-fc',
    'field',
    'error',
    'active',
    'hover',
    'disabled',
    'tooltipIcon'
  );

  // For these fields, selector font colors
  // apply to the checkmark / radio fill
  const ignoreSelectorColors = ['select', 'multiselect', 'checkbox'].includes(
    type
  );
  styles.applyFontStyles('fc', false, true);
  styles.applyFontStyles('field', false, ignoreSelectorColors);

  // These are fields that don't have content inside, which won't be shifted by
  // a default border
  const hasBorder = defaultBorderFields.includes(type);
  styles.applySelectorStyles('active', {
    prefix: 'selected_',
    important: type !== 'payment_method',
    addBorder: hasBorder,
    background: type === 'button_group'
  });
  styles.applySelectorStyles('hover', {
    prefix: 'hover_',
    important: !['button_group', 'payment_method'].includes(type),
    addBorder: hasBorder,
    background: type === 'button_group'
  });
  styles.apply('disabled', 'disabled_background_color', (a: any) => {
    if (a)
      return {
        [type === 'button_group' ? 'background' : 'backgroundColor']: `#${a}`
      };
    else return { filter: 'brightness(0.9)' };
  });
  styles.applyFontFamily('error');
  styles.apply('error', 'font_size', (a: any) => ({
    fontSize: `${a}px`
  }));
  styles.apply('tooltipIcon', 'font_size', (a: any) => ({
    width: `${a}px`
  }));
  styles.applyColor('tooltipIcon', 'font_color', 'fill');

  switch (type) {
    case 'signature':
      styles.applyHeight('sub-fc');
      styles.applyColor('field', 'background_color', 'backgroundColor');
      styles.applyCorners('field');
      styles.applyBorders({ target: 'field' });
      styles.applyBoxShadow('field');
      break;
    case 'file_upload':
      styles.addTargets('ac', 'add');
      styles.applyHeight('ac');
      if (!field.servar.metadata.multiple) {
        styles.applyHeight('fc');
      }
      styles.applyHeight('field');
      styles.applyBorders({ target: 'field' });
      styles.applyCorners('field');
      styles.applyBoxShadow('field');
      styles.applyColor('ac', 'background_color', 'backgroundColor');
      styles.applyBorders({ target: 'ac' });
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
    case 'rating':
      styles.addTargets('selectedRating', 'hoverRating');
      styles.applyColor('field', 'background_color', 'fill');
      styles.applyColor('selectedRating', 'selected_background_color', 'fill');
      styles.applyColor('hoverRating', 'hover_background_color', 'fill');
      break;
    case 'button_group':
      styles.addTargets('img', 'label', 'bc');
      styles.apply('bc', 'vertical_align', (a: any) => ({
        alignItems: a,
        alignContent: a
      }));
      styles.apply(
        'bc',
        'horizontal_align',
        (a: keyof typeof justifyContentTextAlignMap) => ({
          justifyContent: a,
          textAlign: justifyContentTextAlignMap[a]
        })
      );
      styles.applyHeight('bc', '', true);
      styles.apply(
        'field',
        ['button_width', 'button_width_unit', 'content_responsive'],
        (a: any, b: any, c: boolean) => {
          const metric = `${a}${b}`;
          if (c) return { minWidth: metric };
          else
            return {
              width: '100%',
              maxWidth: metric
            };
        }
      );
      styles.apply(
        'field',
        ['button_height', 'button_height_unit', 'content_responsive'],
        (a: any, b: any, c: boolean) => ({
          [c ? 'minHeight' : 'height']: `${a}${b}`
        })
      );
      styles.applyBackgroundColorGradient('field');
      styles.applyBoxShadow('field');
      styles.applyCorners('field');
      styles.applyFlexDirection('field');
      styles.applyContentAlign('field');
      styles.applyTextAlign('label');
      styles.applyMargin('field', 'button_');
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
      styles.apply('hover', 'hover_image_color', (a: string) => {
        if (!a) return {};
        const level = a === 'black' ? 0 : 100;
        return {
          img: {
            webkitFilter: `brightness(${level}%)`,
            filter: `brightness(${level}%)`
          }
        };
      });
      styles.applyColor('hover', 'hover_font_color', 'color');
      styles.applyColor('active', 'selected_font_color', 'color');

      styles.apply('active', 'selected_image_color', (a: string) => {
        if (!a) return {};
        const level = a === 'black' ? 0 : 100;
        return {
          img: {
            webkitFilter: `brightness(${level}%)`,
            filter: `brightness(${level}%)`
          }
        };
      });
      break;
    case 'dropdown':
    case 'gmap_state':
    case 'gmap_country':
    case 'dropdown_multi':
      if (type === 'dropdown_multi') {
        // Dropdown multiselect can grow in height as more options are selected
        styles.apply('sub-fc', ['height', 'height_unit'], (a: any, b: any) => {
          if (b === '%')
            return {
              minHeight: `${DEFAULT_MIN_SIZE}px`,
              height: 'auto'
            };
          else return { minHeight: `${a}${b}` };
        });
      } else styles.applyHeight('sub-fc');
      styles.applyCorners('sub-fc');
      styles.applyBoxShadow('sub-fc');
      styles.applyColor('sub-fc', 'background_color', 'backgroundColor');
      styles.applyCorners('field');
      if (field.properties.placeholder)
        styles.applyPlaceholderStyles(type, field.styles);
      break;
    case 'pin_input':
      styles.applyWidth('sub-fc');
      styles.applyHeight('sub-fc');
      styles.applyBoxShadow('sub-fc');
      styles.applyCorners('sub-fc');
      styles.applyColor('sub-fc', 'background_color', 'backgroundColor');
      break;
    case 'multiselect':
      styles.applyCorners('field');
      styles.applyBorders({ target: 'field' });
      styles.applyBoxShadow('field');
      styles.applyColor('field', 'background_color', 'backgroundColor');
      styles.apply('field', 'font_size', (a: any) => ({
        height: `${parseInt(a) + 4}px`
      }));
      break;
    case 'select':
      styles.applyCorners('field');
      styles.applyBorders({ target: 'field' });
      styles.applyBoxShadow('field');
      styles.applyColor('field', 'background_color', 'backgroundColor');
      styles.apply('field', 'font_size', (a: any) => ({
        height: `${parseInt(a) + 4}px`
      }));
      break;
    case 'hex_color':
      styles.applyHeight('field');
      styles.applyCorners('field');
      styles.applyBoxShadow('field');
      styles.applyBorders({ target: 'field' });
      break;
    case 'slider':
      styles.addTargets('handle', 'track');
      styles.apply('handle', ['height', 'height_unit'], (a: any, b: any) => {
        const value = `${a}${b}`;
        return {
          height: value,
          width: value,
          marginTop: `-${Math.max(a - 4, 0) / 2}${b}`
        };
      });
      styles.applyColor('handle', 'background_color', 'backgroundColor');
      styles.applyCorners('handle');
      styles.applyBorders({ target: 'handle' });
      styles.applyBoxShadow('handle');
      styles.applyColor('track', 'background_color', 'backgroundColor');
      styles.apply('field', ['height', 'height_unit'], (a: any, b: any) => {
        const value = `${a / 2 - 6}${b}`;
        return { marginBottom: value };
      });
      break;
    case 'payment_method':
      styles.addTargets('completedFont', 'activeFont', 'hoverFont');
      styles.applyHeight('sub-fc');
      styles.applyCorners('sub-fc');
      styles.applyColor('sub-fc', 'background_color', 'backgroundColor');
      styles.applyBoxShadow('sub-fc');

      // iconColor is specific to stripe card element
      styles.applyColor('field', 'placeholder_color', 'iconColor');
      styles.applyColor('hoverFont', 'hover_placeholder_color', 'iconColor');
      styles.applyColor(
        'activeFont',
        'selected_placeholder_color',
        'iconColor'
      );
      styles.applyColor(
        'completedFont',
        'completed_placeholder_color',
        'iconColor'
      );
      styles.applyColor('hoverFont', 'hover_font_color', 'color');
      styles.applyColor('activeFont', 'selected_font_color', 'color');
      styles.applyColor('completedFont', 'completed_font_color', 'color');

      styles.applyPlaceholderStyles(type, field.styles);
      break;
    case 'phone_number':
      styles.addTargets('fieldToggle', 'dropdown');

      styles.applyFontStyles('dropdown', false, true);
      styles.apply('dropdown', 'background_color', (color: any) => {
        if (color.substring(6).toLowerCase() !== 'ff')
          return { backgroundColor: 'white', color: 'black' };
        return { backgroundColor: `#${color}` };
      });

      styles.applyHeight('sub-fc');
      styles.applyBoxShadow('sub-fc');
      styles.applyCorners('sub-fc');
      styles.apply(
        'sub-fc',
        [
          ...borderWidthProps,
          ...borderWidthProps.map((prop) => `hover_${prop}`),
          ...borderWidthProps.map((prop) => `selected_${prop}`)
        ],
        (...props: any) => ({
          paddingTop: Math.max(props[0], props[4], props[8]),
          paddingRight: Math.max(props[1], props[5], props[9]),
          paddingBottom: Math.max(props[2], props[6], props[10]),
          paddingLeft: Math.max(props[3], props[7], props[11])
        })
      );
      styles.applyColor('sub-fc', 'background_color', 'backgroundColor');
      // Corners must also be applied to input even if not visible since it could cover
      // up the visible container corners
      styles.apply(
        'field',
        ['corner_top_right_radius', 'corner_bottom_right_radius'],
        // @ts-expect-error TS(7006): Parameter 'a' implicitly has an 'any' type.
        (a, b) => ({ borderRadius: `0 ${a}px ${b}px 0` })
      );
      styles.applyPlaceholderStyles(type, field.styles);

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
      styles.apply('fieldToggle', 'border_bottom_color', (a: any) => ({
        borderRight: `1px solid #${a}`
      }));
      break;
    default:
      styles.addTargets('dropdown');
      styles.applyFontStyles('dropdown');
      styles.apply('dropdown', 'background_color', (color: any) => {
        if (color.substring(6).toLowerCase() !== 'ff')
          return { backgroundColor: 'white', color: 'black' };
        return { backgroundColor: `#${color}` };
      });

      if (type !== 'qr_scanner') styles.applyHeight('sub-fc');
      styles.applyCorners('sub-fc');
      styles.applyColor('sub-fc', 'background_color', 'backgroundColor');
      styles.applyBoxShadow('field');
      styles.applyCorners('field');
      if (field.properties.placeholder)
        styles.applyPlaceholderStyles(type, field.styles);
      break;
  }
  return styles;
}

Object.entries(Fields).map(([key, Field]: any) => {
  // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
  Fields[key] = memo(({ element, responsiveStyles, ...props }) => {
    const servar = element.servar;
    const fieldLabel = servar?.name ? (
      <label
        // Doesn't work for repeats currently since repeating field IDs aren't unique
        htmlFor={servar.repeated ? undefined : servar.key}
        style={{
          marginBottom: '10px',
          display: 'inline-block',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere'
        }}
      >
        {servar.name}
      </label>
    ) : null;
    const styles = useMemo(
      () => applyFieldStyles(element, responsiveStyles),
      [element]
    );
    return (
      <Field
        element={element}
        fieldLabel={fieldLabel}
        responsiveStyles={styles}
        {...props}
      />
    );
  });
});

export default Fields;
