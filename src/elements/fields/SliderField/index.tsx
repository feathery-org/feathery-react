import React, { useEffect, useState } from 'react';
import Slider from 'rc-slider';
import { hoverStylesGuard } from '../../../utils/browser';

import SliderStyles from './styles';

export default function SliderField({
  element,
  fieldLabel,
  responsiveStyles,
  disabled = false,
  fieldVal = 0,
  editMode,
  rightToLeft,
  onChange = () => {},
  elementProps = {},
  children
}: any) {
  const [internalValue, setInternalValue] = useState(fieldVal);

  useEffect(() => {
    if (fieldVal !== internalValue) setInternalValue(fieldVal);
  }, [fieldVal]);

  const servar = element.servar;
  const minVal = servar.min_length ?? 0;
  const maxVal = servar.max_length ?? 100;
  const minLabel = servar.metadata.min_val_label || minVal;
  const maxLabel = servar.metadata.max_val_label || maxVal;
  const stepSize = servar.metadata.step_size || 1;

  return (
    <div
      css={{
        maxWidth: '100%',
        width: '100%',
        height: '100%',
        position: 'relative',
        pointerEvents: editMode || disabled ? 'none' : 'auto',
        ...responsiveStyles.getTarget('fc'),
        '&:hover .current-value': {
          opacity: 1,
          transitionDelay: '0ms'
        }
      }}
      {...elementProps}
    >
      {children}
      {fieldLabel}
      <SliderStyles
        customStyles={{
          ['.rc-slider'.repeat(2)]: {
            width: 'calc(100% - 8px)',
            userSelect: 'none',
            ...responsiveStyles.getTarget('field')
          },
          ['.rc-slider-handle'.repeat(2)]: {
            opacity: 1,
            ...responsiveStyles.getTarget('handle'),
            transitionProperty:
              'color, background-color, border-color !important',
            '&:hover': hoverStylesGuard(responsiveStyles.getTarget('hover'))
          },
          // Override default css that repeats 3 times
          ['.rc-slider-handle-dragging'.repeat(4)]: {
            boxShadow: 'none',
            ...responsiveStyles.getTarget('active')
          },
          'div.rc-slider-track': responsiveStyles.getTarget('track')
        }}
      />
      <div css={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
        <Slider
          value={internalValue}
          min={minVal}
          max={maxVal}
          step={stepSize}
          reverse={rightToLeft}
          onChange={(val) => {
            setInternalValue(val);
            onChange(val);
          }}
          aria-label={element.properties.aria_label}
        />
      </div>
      <div
        css={{
          display: 'flex',
          justifyContent: 'space-between',
          position: 'relative'
        }}
      >
        <span>{minLabel}</span>
        <span
          css={{ opacity: 0, transition: '0.2s ease opacity 0.3s' }}
          className='current-value'
        >
          {internalValue}
        </span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}
