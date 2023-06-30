import { bootstrapStyles } from '../styles';

import React, { useState } from 'react';
import useBorder from '../components/useBorder';
import Select from 'react-select';
import { featheryDoc } from '../../utils/browser';

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

  responsiveStyles.applyFontStyles('field');
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
          overflowX: 'hidden',
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
        <Select
          styles={{
            control: (baseStyles) => ({
              ...baseStyles,
              ...bootstrapStyles,
              ...responsiveStyles.getTarget('field'),
              width: '100%',
              height: '100%',
              border: 'none',
              boxShadow: 'none',
              backgroundColor: 'transparent',
              position: 'relative'
            })
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
          placeholder={element.properties.placeholder || ''}
        />
      </div>
    </div>
  );
}
