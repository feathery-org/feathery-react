import React, { useEffect, useState } from 'react';
import Slider from '@rc-component/slider';
import { hoverStylesGuard } from '../../../utils/browser';

import SliderStyles from './styles';
import HiddenValueInput from '../../components/HiddenValueInput';
import { getSliderRange } from '../../../utils/valueBounds';

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
  const { min: minVal, max: maxVal } = getSliderRange(servar);
  // A linked range can move past the value; rc-slider keeps the handle in range,
  // so show the label and input the same way, as submit will store it
  const shownValue =
    typeof internalValue === 'number'
      ? Math.min(Math.max(internalValue, minVal), maxVal)
      : internalValue;
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
          // The handle is the element the user drags, so it carries the
          // field key like a native control would
          handleRender={(handle) =>
            React.cloneElement(handle, { name: servar.key } as any)
          }
        />
        <HiddenValueInput name={servar.key} value={shownValue} />
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
          {shownValue}
        </span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}
