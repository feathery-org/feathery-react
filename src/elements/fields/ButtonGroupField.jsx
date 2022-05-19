import React from 'react';
import { imgMaxSizeStyles } from '../styles';

function ButtonGroupField({
  element,
  applyStyles,
  fieldLabel,
  fieldVal = null,
  editable = false,
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
                cursor: editable ? 'default' : 'pointer',
                ...applyStyles.getTargets(
                  'field',
                  fieldVal === opt ? 'active' : ''
                ),
                '&:active': applyStyles.getTarget('active'),
                '&:hover': editable ? {} : applyStyles.getTarget('hover')
              }}
            >
              {imageUrl && (
                <img
                  src={imageUrl}
                  style={{
                    ...imgMaxSizeStyles,
                    ...applyStyles.getTargets('img')
                  }}
                />
              )}
              {opt && (
                <div
                  id={servar.key}
                  css={{
                    display: 'flex',
                    width: '100%',
                    // Do not highlight text when clicking the button
                    webkitTouchCallout: 'none' /* iOS Safari */,
                    webkitUserSelect: 'none' /* Safari */,
                    mozUserSelect: 'none' /* Old versions of Firefox */,
                    msUserSelect: 'none' /* Internet Explorer / Edge */,
                    userSelect: 'none' /* Chrome, Firefox, etc. */,
                    ...applyStyles.getTarget('tc')
                  }}
                >
                  {opt}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {children}
    </div>
  );
}

export default ButtonGroupField;
