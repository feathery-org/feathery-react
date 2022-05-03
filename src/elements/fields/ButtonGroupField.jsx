import React from 'react';

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
                    // Setting min-height to 0 prevents vertical image overflow
                    minHeight: 0,
                    objectFit: 'contain',
                    ...applyStyles.getTargets('img')
                  }}
                />
              )}
              {opt && (
                <div
                  css={{
                    display: 'flex',
                    width: '100%',
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
