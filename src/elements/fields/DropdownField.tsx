import { bootstrapStyles } from '../styles';

import React, { useState } from 'react';
import InlineTooltip from '../components/Tooltip';
import useBorder from '../components/useBorder';

export default function DropdownField({
  element,
  responsiveStyles,
  fieldLabel,
  inlineError,
  required = false,
  fieldVal = '',
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

  let options;
  if (servar.type === 'gmap_state') {
    if (fieldVal && !states.includes(fieldVal))
      // If user selected an international address
      options = [
        <option key={fieldVal} value={fieldVal}>
          {fieldVal}
        </option>
      ];
    else
      options = states.map((state) => (
        <option key={state} value={state}>
          {state}
        </option>
      ));
  } else {
    const labels = servar.metadata.option_labels;
    options = servar.metadata.options.map((option: any, index: number) => {
      const label = labels && labels[index] ? labels[index] : option;
      return (
        <option key={option} value={option}>
          {label}
        </option>
      );
    });
  }

  responsiveStyles.applyFontStyles('field', !fieldVal);
  return (
    <div
      css={{
        maxWidth: '100%',
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
          '&:hover': {
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
        <select
          css={{
            ...bootstrapStyles,
            ...responsiveStyles.getTarget('field'),
            width: '100%',
            height: '100%',
            border: 'none',
            boxShadow: 'none',
            backgroundColor: 'transparent',
            appearance: 'none',
            WebkitAppearance: 'none',
            MozAppearance: 'none',
            backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'><path d='M0 0.776454L0.970744 0L5 4.2094L9.02926 0L10 0.776454L5 6L0 0.776454Z' fill='%23${element.styles.font_color}'/></svg>")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 10px center',
            position: 'relative'
          }}
          id={servar.key}
          value={fieldVal}
          required={required}
          onChange={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        >
          <option key='' value='' />
          {options}
        </select>
        <span
          css={{
            position: 'absolute',
            pointerEvents: 'none',
            left: '0.75rem',
            transition: '0.2s ease all',
            top: '50%',
            ...responsiveStyles.getTarget('placeholder'),
            ...(fieldVal ? responsiveStyles.getTarget('placeholderFocus') : {}),
            [`input:focus + &`]: {
              ...responsiveStyles.getTarget('placeholderFocus'),
              ...responsiveStyles.getTarget('placeholderActive')
            }
          }}
        >
          {element.properties.placeholder || ''}
        </span>
        <InlineTooltip element={element} responsiveStyles={responsiveStyles} />
      </div>
    </div>
  );
}

const states = [
  'Alabama',
  'Alaska',
  'Arizona',
  'Arkansas',
  'California',
  'Colorado',
  'Connecticut',
  'Delaware',
  'District Of Columbia',
  'Florida',
  'Georgia',
  'Hawaii',
  'Idaho',
  'Illinois',
  'Indiana',
  'Iowa',
  'Kansas',
  'Kentucky',
  'Louisiana',
  'Maine',
  'Maryland',
  'Massachusetts',
  'Michigan',
  'Minnesota',
  'Mississippi',
  'Missouri',
  'Montana',
  'Nebraska',
  'Nevada',
  'New Hampshire',
  'New Jersey',
  'New Mexico',
  'New York',
  'North Carolina',
  'North Dakota',
  'Ohio',
  'Oklahoma',
  'Oregon',
  'Pennsylvania',
  'Rhode Island',
  'South Carolina',
  'South Dakota',
  'Tennessee',
  'Texas',
  'Utah',
  'Vermont',
  'Virginia',
  'Washington',
  'West Virginia',
  'Wisconsin',
  'Wyoming'
];
