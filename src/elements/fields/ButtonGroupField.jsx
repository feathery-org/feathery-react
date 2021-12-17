import React from 'react';

function ButtonGroupField({
  element,
  applyStyles,
  fieldLabel,
  fieldVal = null,
  onClick = () => {},
  elementProps = {}
}) {
  const servar = element.servar;
  return (
    <>
      {fieldLabel}
      <div
        css={{
          display: 'flex',
          flexWrap: 'wrap',
          width: '100%',
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
              key={opt}
              css={{
                boxSizing: 'border-box',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                flexDirection: 'column',
                cursor: 'pointer',
                ...applyStyles.getTarget('field'),
                '&:active': applyStyles.getTarget('active'),
                '&:hover': applyStyles.getTarget('hover'),
                ...(fieldVal === opt ? applyStyles.getTarget('active') : {})
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
    </>
  );
}

export default ButtonGroupField;
