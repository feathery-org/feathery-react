import React, { useMemo } from 'react';
import { imgMaxSizeStyles, noTextSelectStyles } from '../styles';

function ButtonGroupField({
  element,
  responsiveStyles,
  fieldLabel,
  fieldVal = null,
  editMode,
  onClick = () => {},
  elementProps = {},
  children
}: any) {
  const servar = element.servar;
  const selectedOptMap = useMemo(
    () =>
      Array.isArray(fieldVal)
        ? fieldVal.reduce((map: any, selected: any) => {
            map[selected] = true;
            return map;
          }, {})
        : {},
    [fieldVal]
  );
  const labels = servar.metadata.option_labels;
  return (
    <div css={{ position: 'relative' }}>
      {children}
      {fieldLabel}
      <div
        css={{
          display: 'flex',
          flexWrap: 'wrap',
          ...responsiveStyles.getTarget('fc')
        }}
        {...elementProps}
      >
        {servar.metadata.options.map((opt: any, index: any) => {
          const imageUrl = servar.metadata.option_images[index];
          const label = labels && labels[index] ? labels[index] : opt;
          return (
            <div
              onClick={() => onClick(opt)}
              key={`${servar.key}-${index}`}
              css={{
                boxSizing: 'border-box',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                cursor: editMode ? 'default' : 'pointer',
                '&:hover': editMode ? {} : responsiveStyles.getTarget('hover'),
                ...responsiveStyles.getTargets(
                  'field',
                  selectedOptMap[opt] ? 'active' : ''
                )
              }}
            >
              {imageUrl && (
                <img
                  src={imageUrl}
                  style={{
                    ...imgMaxSizeStyles,
                    ...responsiveStyles.getTargets('img')
                  }}
                />
              )}
              {label && (
                <div
                  css={{
                    display: 'flex',
                    maxWidth: '100%',
                    // Do not highlight text when clicking the button
                    ...noTextSelectStyles
                  }}
                >
                  {label}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ButtonGroupField;
