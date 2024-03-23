import React, { useMemo } from 'react';
import { imgMaxSizeStyles, noTextSelectStyles } from '../styles';
import useBorder from '../components/useBorder';
import { FORM_Z_INDEX } from '../../utils/styles';
import { hoverStylesGuard } from '../../utils/browser';
import InlineTooltip from '../components/InlineTooltip';

function ButtonGroupField({
  element,
  responsiveStyles,
  fieldLabel,
  inlineError,
  fieldVal = null,
  repeatIndex = null,
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
  const tooltips = servar.metadata.option_tooltips;
  let options;
  if (
    repeatIndex !== null &&
    servar.metadata.repeat_options !== undefined &&
    servar.metadata.repeat_options[repeatIndex] !== undefined
  ) {
    options = servar.metadata.repeat_options[repeatIndex];
  } else {
    options = servar.metadata.options.map((opt: any, index: number) => ({
      value: opt,
      label: labels && labels[index] ? labels[index] : opt,
      tooltip: tooltips && tooltips[index] ? tooltips[index] : ''
    }));
  }

  return (
    <div
      css={{
        position: 'relative',
        width: '100%',
        height: '100%',
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
        {options.map((option: any, index: number) => {
          const value = option.value ?? option;
          const label = option.label ?? option;
          const imageUrl = option.image
            ? option.image
            : servar.metadata.option_images[index];
          const tooltip = option.tooltip ?? '';

          return (
            <div
              onClick={() => onClick(value)}
              key={`${servar.key}-${index}`}
              css={{
                position: 'relative',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                boxSizing: 'border-box',
                cursor: 'pointer',
                ...responsiveStyles.getTarget('field'),
                '&:hover': hoverStylesGuard(
                  editMode || disabled
                    ? {}
                    : {
                        ...responsiveStyles.getTarget('hover'),
                        ...borderStyles.hover
                      }
                ),
                '&&': selectedOptMap[value]
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
              {tooltip && (
                <InlineTooltip
                  id={`${element.id}-${label}`}
                  text={tooltip}
                  responsiveStyles={responsiveStyles}
                  absolute={false}
                />
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
            opacity: 0,
            bottom: 0,
            left: '50%',
            width: '1px',
            height: '1px',
            zIndex: FORM_Z_INDEX - 2
          }}
        />
      </div>
    </div>
  );
}

export default ButtonGroupField;
