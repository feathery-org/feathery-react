import React, { useMemo, useRef, useState } from 'react';
import ReactForm from '../components/CustomFormControl';
import { resetStyles } from '../styles';
import {
  applyCheckableInputStyles,
  applyHeightWidthMarginByFontSize,
  composeCheckableInputStyle
} from './CheckboxField';
import InlineTooltip from '../components/InlineTooltip';
import { iosScrollOnFocus } from '../../utils/browser';
import useSalesforceSync from '../../hooks/useSalesforceSync';

const applyRadioGroupStyles = (element: any, responsiveStyles: any) => {
  responsiveStyles.addTargets('radioGroup');
  applyHeightWidthMarginByFontSize(responsiveStyles, 'radioGroup');
  return responsiveStyles;
};

function RadioButtonGroupField({
  element,
  responsiveStyles,
  fieldLabel,
  required = false,
  disabled = false,
  fieldVal = '',
  otherVal = '',
  repeatIndex = null,
  editMode,
  onChange = () => {},
  onOtherChange = () => {},
  onEnter = () => {},
  elementProps = {},
  children
}: any) {
  const servar = element.servar;
  const containerRef = useRef(null);
  const { dynamicOptions, loadingDynamicOptions, shouldSalesforceSync } =
    useSalesforceSync(servar.metadata.salesforce_sync, editMode);

  const [otherSelect, setOtherSelect] = useState({});
  const otherChecked =
    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    (otherSelect[servar.key] || fieldVal) && fieldVal === otherVal;
  const otherTextDisabled = !otherChecked || disabled;
  const otherLabel = servar.metadata.other_label ?? 'Other';

  const styles = useMemo(() => {
    applyCheckableInputStyles(element, responsiveStyles);
    applyRadioGroupStyles(element, responsiveStyles);
    responsiveStyles.addTargets('row-container');
    responsiveStyles.apply('row-container', 'row_separation', (a: number) => {
      return { gap: `${a || 5}px` };
    });
    responsiveStyles.apply('row-container', 'option_direction', (a: string) => {
      return { flexDirection: a || 'column' };
    });
    return responsiveStyles;
  }, [responsiveStyles]);

  const labels = servar.metadata.option_labels;
  const tooltips = servar.metadata.option_tooltips ?? [];
  let options;
  if (shouldSalesforceSync) {
    options = dynamicOptions.map((option: any) => ({
      value: option.value,
      label: option.label
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
        width: '100%',
        height: '100%',
        ...responsiveStyles.getTarget('fc'),
        position: 'relative'
      }}
      {...elementProps}
    >
      {children}
      {fieldLabel}
      <div
        css={{
          display: 'flex',
          flexWrap: 'wrap',
          width: '100%',
          ...styles.getTarget('row-container')
        }}
      >
        {options.map((option: any, i: number) => {
          const value = option.value ?? option;
          const label = option.label ?? option;
          const tooltip = option.tooltip ?? '';

          return (
            <div
              key={`${servar.key}-${i}`}
              css={{
                display: 'flex'
              }}
            >
              <label style={{ display: 'contents' }}>
                <input
                  type='radio'
                  id={`${servar.key}-${i}`}
                  name={
                    repeatIndex !== null
                      ? `${servar.key}-${repeatIndex}`
                      : servar.key
                  }
                  checked={fieldVal === value}
                  required={required}
                  disabled={disabled || loadingDynamicOptions}
                  onChange={onChange}
                  onFocus={iosScrollOnFocus}
                  aria-label={element.properties.aria_label}
                  value={value}
                  style={{
                    padding: 0,
                    lineHeight: 'normal'
                  }}
                  css={{
                    ...composeCheckableInputStyle(styles, disabled, true),
                    ...styles.getTarget('radioGroup'),
                    ...(disabled ? responsiveStyles.getTarget('disabled') : {}),
                    '&:focus-visible': { border: '1px solid rgb(74, 144, 226)' }
                  }}
                />
                <span
                  css={{
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    ...styles.getTarget('checkboxLabel')
                  }}
                >
                  {label}
                </span>
              </label>
              <InlineTooltip
                container={containerRef}
                id={`${element.id}-${value}`}
                text={tooltip}
                responsiveStyles={responsiveStyles}
                absolute={false}
                repeat={element.repeat}
              />
            </div>
          );
        })}
        {servar.metadata.other && (
          <div style={{ display: 'flex' }}>
            <input
              type='radio'
              id={`${servar.key}-`}
              key={`${servar.key}-`}
              name={
                repeatIndex !== null
                  ? `${servar.key}-${repeatIndex}`
                  : servar.key
              }
              checked={otherChecked}
              disabled={disabled || loadingDynamicOptions}
              onChange={(e) => {
                setOtherSelect({
                  ...otherSelect,
                  [servar.key]: true
                });
                onChange(e);
              }}
              onFocus={iosScrollOnFocus}
              value={otherVal || ''}
              style={{
                padding: 0,
                lineHeight: 'normal'
              }}
              css={{
                ...composeCheckableInputStyle(styles, disabled, true),
                ...styles.getTarget('radioGroup'),
                ...(disabled ? responsiveStyles.getTarget('disabled') : {})
              }}
            />
            <label
              htmlFor={`${servar.key}-`}
              css={styles.getTarget('checkboxLabel')}
            >
              {otherLabel}
            </label>
            <ReactForm.Control
              type='text'
              // Paired with flex grow, will not expand parent width
              htmlSize={1}
              css={{
                marginLeft: '5px',
                ...resetStyles,
                paddingLeft: '0.4rem',
                flexGrow: 1,
                ...responsiveStyles.getTarget('field'),
                ...(otherTextDisabled || loadingDynamicOptions
                  ? responsiveStyles.getTarget('disabled')
                  : {})
              }}
              id={servar.key}
              value={otherVal || ''}
              onChange={onOtherChange}
              onKeyDown={(e: any) => {
                if (e.key === 'Enter') onEnter(e);
              }}
              maxLength={servar.max_length}
              minLength={servar.min_length}
              required={otherChecked}
              disabled={otherTextDisabled || loadingDynamicOptions}
            />
            <InlineTooltip
              container={containerRef}
              id={`${element.id}-`}
              text={servar.metadata.other_tooltip}
              responsiveStyles={responsiveStyles}
              absolute={false}
              repeat={element.repeat}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default RadioButtonGroupField;
