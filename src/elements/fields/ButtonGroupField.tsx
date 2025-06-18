import React, { useMemo, useRef } from 'react';
import { imgMaxSizeStyles, noTextSelectStyles } from '../styles';
import useBorder from '../components/useBorder';
import { hoverStylesGuard } from '../../utils/browser';
import InlineTooltip from '../components/InlineTooltip';
import ErrorInput from '../components/ErrorInput';
import useSalesforceSync from '../../hooks/useSalesforceSync';

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
  const containerRef = useRef(null);
  const servar = element.servar;
  const { dynamicOptions, loadingDynamicOptions } = useSalesforceSync(
    servar.metadata.salesforce_sync
  );

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

  const labels = servar.metadata.option_labels;
  const tooltips = servar.metadata.option_tooltips;
  let options;
  if (dynamicOptions.length > 0) {
    options = dynamicOptions.map((option: any) => ({
      value: option.value,
      label: option.label,
      tooltip: ''
    }));
  } else if (
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
      ref={containerRef}
      css={{
        position: 'relative',
        width: '100%',
        height: '100%',
        pointerEvents:
          editMode || disabled || loadingDynamicOptions ? 'none' : 'auto',
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
                  editMode || disabled || loadingDynamicOptions
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
                  container={containerRef}
                  id={`${element.id}-${label}`}
                  text={tooltip}
                  responsiveStyles={responsiveStyles}
                  absolute={false}
                  repeat={element.repeat}
                />
              )}
            </div>
          );
        })}
        {/* This input must always be rendered so we can set field errors */}
        <ErrorInput
          id={servar.key}
          name={servar.key}
          aria-label={element.properties.aria_label}
        />
      </div>
    </div>
  );
}

export default ButtonGroupField;
