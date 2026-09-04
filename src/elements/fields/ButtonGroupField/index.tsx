import React, { useMemo, useRef } from 'react';
import { assetName, certificationNameProps } from '../shared/certification';
import {
  imgMaxSizeStyles,
  noTextSelectStyles,
  unstyledButton
} from '../../styles';
import useBorder from '../../components/useBorder';
import { hoverStylesGuard } from '../../../utils/browser';
import InlineTooltip from '../../components/InlineTooltip';
import ErrorInput from '../../components/ErrorInput';
import HiddenValueInput from '../../components/HiddenValueInput';
import useSalesforceSync from '../../../hooks/useSalesforceSync';
import { fieldAriaLabel } from '../shared/accessibleName';

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
  const { dynamicOptions, loadingDynamicOptions, shouldSalesforceSync } =
    useSalesforceSync(servar.metadata.salesforce_sync, editMode);

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
    error: inlineError,
    breakpoint: responsiveStyles.getMobileBreakpoint()
  });

  const labels = servar.metadata.option_labels;
  const tooltips = servar.metadata.option_tooltips;
  let options;
  if (shouldSalesforceSync) {
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

          const inactive = editMode || disabled || loadingDynamicOptions;

          return (
            <button
              // A real button rather than a div so the option is keyboard
              // operable and carries a name on TrustedForm certificates.
              // The name is per-option so that it never collides with the
              // ErrorInput below, which owns the field key.
              type='button'
              name={`${servar.key}-${index}`}
              value={value}
              aria-pressed={!!selectedOptMap[value]}
              aria-disabled={inactive}
              // Visible option text is the accessible name (WCAG 2.5.3), so
              // only name image-only options explicitly
              aria-label={
                label
                  ? undefined
                  : `${fieldAriaLabel(element) ?? servar.key} - ${value}`
              }
              onClick={() => {
                if (!inactive) onClick(value);
              }}
              key={`${servar.key}-${index}`}
              id={`${servar.key}-${index}`}
              css={{
                ...unstyledButton,
                position: 'relative',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                boxSizing: 'border-box',
                cursor: 'pointer',
                ...responsiveStyles.getTarget('field'),
                '&:hover': hoverStylesGuard(
                  inactive
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
                  // Decorative: the option button carries the name
                  alt=''
                  {...certificationNameProps(assetName(imageUrl))}
                  css={{
                    ...imgMaxSizeStyles,
                    ...responsiveStyles.getTargets('img'),
                    pointerEvents: 'none'
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
                    ...noTextSelectStyles,
                    pointerEvents: 'none'
                  }}
                >
                  {label}
                </div>
              )}
              {tooltip && (
                <InlineTooltip
                  containerRef={containerRef}
                  id={`${element.id}-${label}`}
                  text={tooltip}
                  responsiveStyles={responsiveStyles}
                  absolute={false}
                  repeat={element.repeat}
                />
              )}
            </button>
          );
        })}
        {/* This input must always be rendered so we can set field errors */}
        <ErrorInput
          id={servar.key}
          name={servar.key}
          aria-label={fieldAriaLabel(element)}
        />
        <HiddenValueInput
          name={servar.key}
          value={(Array.isArray(fieldVal) ? fieldVal : []).join(', ')}
        />
      </div>
    </div>
  );
}

export default ButtonGroupField;
