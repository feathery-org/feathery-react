import React, { useState } from 'react';
import RatingStar from '../components/icons/RatingStar';

export default function RatingField({
  element,
  fieldLabel,
  responsiveStyles,
  fieldVal,
  editMode,
  onChange = () => {},
  elementProps = {},
  children
}: any) {
  const [hoverIndex, setHoverIndex] = useState<null | number>(null);

  const servar = element.servar;
  const numRatings = servar.max_length ?? 5;

  // If no field value, default to 1 less than the max
  fieldVal = fieldVal ?? numRatings - 1;

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
              <RatingStar
                key={index}
                onClick={() => onChange(index + 1)}
                onMouseEnter={() => setHoverIndex(index)}
                onMouseLeave={() => setHoverIndex(null)}
                css={{
                  pointerEvents: editMode ? 'none' : 'auto',
                  cursor: editMode ? 'default' : 'pointer',
                  width: `${100 / numRatings}%`,
                  paddingRight: '5px',
                  ...responsiveStyles.getTarget('field'),
                  ...activeStyles
                }}
              />
            );
          })}
      </div>
    </div>
  );
}
