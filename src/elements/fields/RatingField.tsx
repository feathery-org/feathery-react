import React, { useState } from 'react';
import RatingStar from '../components/icons/RatingStar';
import Heart from '../components/icons/Heart';
import { FORM_Z_INDEX } from '../../utils/styles';

export default function RatingField({
  element,
  fieldLabel,
  responsiveStyles,
  fieldVal,
  editMode,
  onChange = () => {},
  elementProps = {},
  disabled = false,
  children
}: any) {
  const [hoverIndex, setHoverIndex] = useState<null | number>(null);

  const servar = element.servar;
  const numRatings = servar.max_length ?? 5;

  // If no field value, default to 1 less than the max
  fieldVal = fieldVal ?? numRatings - 1;

  const Icon = element.styles.icon_type === 'heart' ? Heart : RatingStar;

  return (
    <div
      css={{
        maxWidth: '100%',
        width: '100%',
        height: '100%',
        position: 'relative',
        ...responsiveStyles.getTarget('fc')
      }}
      {...elementProps}
    >
      {children}
      {fieldLabel}
      <div css={{ display: 'flex', justifyContent: 'space-around' }}>
        {Array(numRatings)
          .fill(null)
          .map((_, index) => {
            let activeStyles = {};
            if (hoverIndex === null) {
              if (index <= fieldVal - 1)
                activeStyles = responsiveStyles.getTarget('selectedRating');
            } else if (index <= hoverIndex)
              activeStyles = responsiveStyles.getTarget('hoverRating');
            return (
              <Icon
                key={index}
                onClick={() => onChange(index + 1)}
                onMouseEnter={() => setHoverIndex(index)}
                onMouseLeave={() => setHoverIndex(null)}
                css={{
                  pointerEvents: editMode || disabled ? 'none' : 'auto',
                  cursor: editMode || disabled ? 'default' : 'pointer',
                  width: `${100 / numRatings}%`,
                  paddingRight: '5px',
                  ...responsiveStyles.getTarget('field'),
                  ...activeStyles
                }}
              />
            );
          })}
        {/* This input must always be rendered so we can set field errors */}
        <input
          id={servar.key}
          name={servar.key}
          aria-label={element.properties.aria_label}
          // Properties to disable all focus/input but still allow displaying errors
          // type="text", file inputs open a file picker on focus, instead we just use a text input
          // inputMode="none" this prevents the virtual keyboard from displaying on mobile devices caused by using text input
          // tabIndex={-1} prevents the user from accessing the field using the keyboard
          // pointerEvents: 'none' prevents clicking on the element, in the case they somehow are able to click it
          // onFocus and onClick are cancelled for a similar reason
          type='text'
          inputMode='none'
          onFocus={(e) => e.preventDefault()}
          onClick={(e) => e.preventDefault()}
          tabIndex={-1}
          style={{
            pointerEvents: 'none',
            position: 'absolute',
            opacity: 0,
            bottom: 0,
            left: '50%',
            width: '1px',
            height: '1px',
            zIndex: FORM_Z_INDEX - 2
          }}
        />
      </div>
    </div>
  );
}
