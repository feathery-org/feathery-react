import React, { useState } from 'react';
import RatingStar from '../../components/icons/RatingStar';
import Heart from '../../components/icons/Heart';
import ErrorInput from '../../components/ErrorInput';
import HiddenValueInput from '../../components/HiddenValueInput';
import { unstyledButton } from '../../styles';
import { fieldAriaLabel } from '../shared/accessibleName';

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
            const rating = index + 1;
            return (
              // A real button rather than a bare svg so each rating is keyboard
              // operable and carries a name on TrustedForm certificates
              <button
                key={index}
                type='button'
                name={`${servar.key}-${rating}`}
                value={rating}
                aria-label={`${
                  fieldAriaLabel(element) ?? servar.key
                } - ${rating}`}
                aria-pressed={fieldVal === rating}
                aria-disabled={editMode || disabled}
                onClick={() => {
                  if (!editMode && !disabled) onChange(rating);
                }}
                onMouseEnter={() => setHoverIndex(index)}
                onMouseLeave={() => setHoverIndex(null)}
                css={{
                  ...unstyledButton,
                  display: 'flex',
                  pointerEvents: editMode || disabled ? 'none' : 'auto',
                  cursor: editMode || disabled ? 'default' : 'pointer',
                  width: `${100 / numRatings}%`,
                  paddingRight: '5px'
                }}
              >
                <Icon
                  css={{
                    width: '100%',
                    ...responsiveStyles.getTarget('field'),
                    ...activeStyles
                  }}
                />
              </button>
            );
          })}
        {/* This input must always be rendered so we can set field errors */}
        <ErrorInput
          id={servar.key}
          name={servar.key}
          aria-label={fieldAriaLabel(element)}
        />
        <HiddenValueInput name={servar.key} value={fieldVal} />
      </div>
    </div>
  );
}
