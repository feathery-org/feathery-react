import React, { memo, useState } from 'react';

import Placeholder from '../../components/Placeholder';
import InlineTooltip from '../../components/Tooltip';
// @ts-expect-error TS(7016): Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import DatePicker from 'react-datepicker';
import DateSelectorStyles from './styles';

import { bootstrapStyles, ERROR_COLOR } from '../../styles';
import { IMaskInput } from 'react-imask';

function formatDateString(date: any) {
  if (!date) return '';

  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${year}-${month}-${day}`;
}

function DateSelectorField({
  element,
  applyStyles,
  fieldLabel,
  elementProps = {},
  required = false,
  editable = false,
  onChange = () => {},
  setRef = () => {},
  value = '',
  inlineError,
  children
}: any) {
  const [internalDate, setInternalDate] = useState(
    value ? new Date(value) : ''
  );
  const onDateChange = (newDate: any) => {
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
        <DateSelectorStyles />
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
                ...(inlineError ? { borderColor: ERROR_COLOR } : {}),
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
              inputRef={setRef}
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
