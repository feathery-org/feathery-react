import React, { useState } from 'react';
import Slider from 'rc-slider';

import SliderStyles from './styles';

export default function SliderField({
  element,
  fieldLabel,
  responsiveStyles,
  fieldVal = 0,
  editMode,
  onChange = () => {},
  elementProps = {},
  children
}: any) {
  const [internalValue, setInternalValue] = useState(fieldVal);

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
        position: 'relative',
        pointerEvents: editMode ? 'none' : 'auto',
        ...responsiveStyles.getTarget('fc')
      }}
      {...elementProps}
    >
      {children}
      {fieldLabel}
      <SliderStyles
        customStyles={{
          ['.rc-slider'.repeat(2)]: {
            width: 'calc(100% - 8px)',
            ...responsiveStyles.getTarget('field')
          },
          ['.rc-slider-handle'.repeat(2)]: {
            opacity: 1,
            ...responsiveStyles.getTarget('handle'),
            '&:hover': responsiveStyles.getTarget('hover')
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
          onChange={(val) => {
            setInternalValue(val);
            onChange(val);
          }}
        />
      </div>
      <div
        css={{
          display: 'flex',
          justifyContent: 'space-between'
        }}
      >
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}
