import React, { useState } from 'react';
import useBorder from '../components/useBorder';
import Select from 'react-select';
import CreatableSelect from 'react-select/creatable';
import { featheryDoc } from '../../utils/browser';
import InlineTooltip from '../components/Tooltip';

export default function DropdownMultiField({
  element,
  responsiveStyles,
  fieldLabel,
  inlineError,
  required = false,
  fieldVal = [],
  editMode,
  onChange = () => {},
  elementProps = {},
  children
}: any) {
  const { borderStyles, customBorder } = useBorder({
    element,
    error: inlineError
  });
  const [focused, setFocused] = useState(false);

  const servar = element.servar;
  const labels = servar.metadata.option_labels;
  const options = servar.metadata.options.map((option: any, index: number) => {
    const label = labels && labels[index] ? labels[index] : option;
    return { value: option, label };
  });

  const disabled = element.properties.disabled ?? false;
  const hasTooltip = !!element.properties.tooltipText;
  const chevronPosition = hasTooltip ? 30 : 10;

  responsiveStyles.applyFontStyles('field');
  const Component = servar.metadata.creatable_options
    ? CreatableSelect
    : Select;
  return (
    <div
      css={{
        maxWidth: '100%',
        width: '100%',
        position: 'relative',
        pointerEvents: editMode ? 'none' : 'auto',
        ...responsiveStyles.getTarget('fc')
      }}
      {...elementProps}
    >
      {children}
      {fieldLabel}
      <div
        css={{
          position: 'relative',
          width: '100%',
          whiteSpace: 'nowrap',
          ...responsiveStyles.getTarget('sub-fc'),
          '&:hover': disabled
            ? {}
            : {
                ...responsiveStyles.getTarget('hover'),
                ...borderStyles.hover
              },
          '&&': focused
            ? {
                ...responsiveStyles.getTarget('active'),
                ...borderStyles.active
              }
            : {}
        }}
      >
        {customBorder}
        <Component
          styles={{
            control: (baseStyles) => ({
              ...baseStyles,
              ...responsiveStyles.getTarget('field'),
              width: '100%',
              height: '100%',
              border: 'none',
              boxShadow: 'none',
              backgroundColor: 'transparent',
              backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'><path d='M0 0.776454L0.970744 0L5 4.2094L9.02926 0L10 0.776454L5 6L0 0.776454Z' fill='%23${element.styles.font_color}'/></svg>")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: `right ${chevronPosition}px center`,
              position: 'relative'
            }),
            container: (baseStyles) => ({
              ...baseStyles,
              height: '100%'
            }),
            indicatorSeparator: () => ({ display: 'none' }),
            indicatorsContainer: () => ({ display: 'none' })
          }}
          id={servar.key}
          value={fieldVal.map((val: any) => ({ label: val, value: val }))}
          required={required}
          isDisabled={disabled}
          onChange={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          options={options}
          isMulti
          menuPortalTarget={featheryDoc().body}
          placeholder=''
        />
        <span
          css={{
            position: 'absolute',
            pointerEvents: 'none',
            left: '0.75rem',
            transition: '0.2s ease all',
            top: '50%',
            ...responsiveStyles.getTarget('placeholder'),
            ...(fieldVal.length > 0 || focused
              ? responsiveStyles.getTarget('placeholderFocus')
              : {}),
            ...(focused ? responsiveStyles.getTarget('placeholderActive') : {})
          }}
        >
          {element.properties.placeholder || ''}
        </span>
        <InlineTooltip element={element} responsiveStyles={responsiveStyles} />
      </div>
    </div>
  );
}
