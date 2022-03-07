import React from 'react';
import { mobileBreakpointKey } from '../styles';

function ButtonGroupField({
  element,
  applyStyles,
  fieldLabel,
  fieldVal = null,
  onClick = () => {},
  elementProps = {},
  children
}) {
  const servar = element.servar;
  return (
    <div css={{ position: 'relative' }}>
      {fieldLabel}
      <div
        css={{
          display: 'flex',
          flexWrap: 'wrap',
          ...applyStyles.getTarget('fc')
        }}
        {...elementProps}
      >
        {servar.metadata.options.map((opt, index) => {
          const imageUrl = servar.metadata.option_images[index];
          return (
            <div
              id={servar.key}
              onClick={onClick}
              key={`${servar.key}-${index}`}
              css={{
                boxSizing: 'border-box',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                flexDirection: 'column',
                cursor: 'pointer',
                ...applyStyles.getTargets(
                  'field',
                  fieldVal === opt ? 'active' : ''
                ),
                '&:active': applyStyles.getTarget('active'),
                '&:hover': applyStyles.getTarget('hover')
              }}
            >
              {imageUrl && (
                <img
                  src={imageUrl}
                  style={{
                    // Setting min-height to 0 prevents vertical image overflow
                    minHeight: 0,
                    objectFit: 'contain'
                  }}
                />
              )}
              {opt}
            </div>
          );
        })}
      </div>
      {children}
    </div>
  );
}

export default ButtonGroupField;
