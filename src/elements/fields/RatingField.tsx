import React, { useState } from 'react';
import RatingStar from '../components/icons/RatingStar';
import Heart from '../components/icons/Heart';

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
          aria-label={element.properties.aria_label}
          // Set to file type so keyboard doesn't pop up on mobile
          // when field error appears
          type='file'
          style={{
            position: 'absolute',
            bottom: 0,
            opacity: 0,
            zIndex: -1
          }}
        />
      </div>
    </div>
  );
}
