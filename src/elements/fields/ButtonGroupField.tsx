import React, { useMemo } from 'react';
import { imgMaxSizeStyles, noTextSelectStyles } from '../styles';
import useBorder from '../components/useBorder';
import { FORM_Z_INDEX } from '../../utils/styles';

function ButtonGroupField({
  element,
  responsiveStyles,
  fieldLabel,
  inlineError,
  fieldVal = null,
  editMode,
  onClick = () => {},
  elementProps = {},
  disabled = false,
  children
}: any) {
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
  const { borderStyles, customBorder } = useBorder({
    element,
    error: inlineError
  });

  const servar = element.servar;
  const labels = servar.metadata.option_labels;
  return (
    <div
      css={{
        position: 'relative',
        width: '100%',
        pointerEvents: editMode || disabled ? 'none' : 'auto',
        ...responsiveStyles.getTarget('fc')
      }}
    >
      {children}
      {fieldLabel}
      <div
        css={{
          display: 'flex',
          flexWrap: 'wrap',
          width: '100%',
          ...responsiveStyles.getTarget('bc')
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
                position: 'relative',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                boxSizing: 'border-box',
                cursor: 'pointer',
                ...responsiveStyles.getTarget('field'),
                '&:hover':
                  editMode || disabled
                    ? {}
                    : {
                        ...responsiveStyles.getTarget('hover'),
                        ...borderStyles.hover
                      },
                '&&': selectedOptMap[opt]
                  ? {
                      ...responsiveStyles.getTarget('active'),
                      ...borderStyles.active
                    }
                  : {}
              }}
            >
              {customBorder}
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
                    ...responsiveStyles.getTargets('label'),
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
        {/* This input must always be rendered so we can set field errors */}
        <input
          id={servar.key}
          name={servar.key}
          // Set to file type so keyboard doesn't pop up on mobile
          // when field error appears
          type='file'
          aria-label={element.properties.aria_label}
          style={{
            position: 'absolute',
            bottom: 0,
            opacity: 0,
            zIndex: FORM_Z_INDEX - 2
          }}
        />
      </div>
    </div>
  );
}

export default ButtonGroupField;
