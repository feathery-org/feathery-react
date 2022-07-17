import React, { memo, useState } from 'react';

import Placeholder from '../../components/Placeholder';
import InlineTooltip from '../../components/Tooltip';
import DatePicker from 'react-datepicker';

import { bootstrapStyles } from '../../styles';
import { IMaskInput } from 'react-imask';

import './dateSelector.css';

function formatDateString(date) {
  if (!date) return '';

  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

function DateSelectorField({
  element,
  applyStyles,
  fieldLabel,
  elementProps = {},
  required = false,
  editable = false,
  onChange = () => {},
  value = '',
  inlineError,
  children
}) {
  const [internalDate, setInternalDate] = useState(
    value ? new Date(value) : ''
  );
  const onDateChange = (newDate) => {
    newDate = newDate ?? '';
    setInternalDate(newDate);
    onChange(formatDateString(newDate));
  };

  const servar = element.servar;
  return (
    <div
      css={{
        maxWidth: '100%',
        position: 'relative',
        pointerEvents: editable ? 'none' : 'auto',
        ...applyStyles.getTarget('fc')
      }}
      {...elementProps}
    >
      {fieldLabel}
      <div
        css={{
          position: 'relative',
          width: '100%',
          ...applyStyles.getTarget('sub-fc')
        }}
      >
        <DatePicker
          selected={internalDate}
          onSelect={onDateChange} // when day is clicked
          onChange={onDateChange} // only when value has changed
          required={required}
          autoComplete={servar.metadata.autocomplete || 'on'}
          placeholder=''
          customInput={
            <IMaskInput
              id={servar.key}
              css={{
                height: '100%',
                width: '100%',
                ...bootstrapStyles,
                ...applyStyles.getTarget('field'),
                ...(inlineError ? { borderColor: '#F42525' } : {}),
                '&:focus': applyStyles.getTarget('active'),
                '&:hover': applyStyles.getTarget('hover'),
                '&:not(:focus)':
                  value || !element.properties.placeholder
                    ? {}
                    : { color: 'transparent !important' }
              }}
              type='tel'
              mask='00/00/0000'
              unmask={false}
            />
          }
        />
        <Placeholder
          value={value}
          element={element}
          applyStyles={applyStyles}
        />
        <InlineTooltip element={element} applyStyles={applyStyles} />
      </div>
      {children}
    </div>
  );
}

export default memo(DateSelectorField);
