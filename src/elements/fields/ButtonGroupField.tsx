import React, { useMemo } from 'react';
import { imgMaxSizeStyles, noTextSelectStyles } from '../styles';

function ButtonGroupField({
  element,
  applyStyles,
  fieldLabel,
  fieldVal = null,
  editable = false,
  onClick = () => {},
  elementProps = {},
  children
}: any) {
  const servar = element.servar;
  const selectedOptMap = useMemo(
    () =>
      fieldVal === null
        ? {}
        : fieldVal.reduce((map: any, selected: any) => {
            map[selected] = true;
            return map;
          }, {}),
    [fieldVal]
  );
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
        {servar.metadata.options.map((opt: any, index: any) => {
          const imageUrl = servar.metadata.option_images[index];
          return (
            <div
              onClick={() => onClick(opt)}
              key={`${servar.key}-${index}`}
              css={{
                boxSizing: 'border-box',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                cursor: editable ? 'default' : 'pointer',
                ...applyStyles.getTargets(
                  'field',
                  selectedOptMap[opt] ? 'active' : ''
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
                  css={{
                    display: 'flex',
                    maxWidth: '100%',
                    // Do not highlight text when clicking the button
                    ...noTextSelectStyles,
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
