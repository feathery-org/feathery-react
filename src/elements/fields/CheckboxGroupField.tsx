import React, { useMemo, useRef } from 'react';
import ReactForm from 'react-bootstrap/Form';
import { bootstrapStyles } from '../styles';
import {
  applyCheckableInputStyles,
  applyHeightWidthMarginByFontSize,
  composeCheckableInputStyle
} from './CheckboxField';
import InlineTooltip from '../components/InlineTooltip';
import { iosScrollOnFocus } from '../../utils/browser';
import useSalesforceSync from '../../hooks/useSalesforceSync';

const applyCheckboxGroupStyles = (element: any, responsiveStyles: any) => {
  responsiveStyles.addTargets('checkboxGroup');
  applyHeightWidthMarginByFontSize(responsiveStyles, 'checkboxGroup');
  return responsiveStyles;
};

function CheckboxGroupField({
  element,
  responsiveStyles,
  fieldLabel,
  fieldVal = [],
  otherVal = '',
  repeatIndex = null,
  editMode,
  onChange = () => {},
  onOtherChange = () => {},
  onEnter = () => {},
  elementProps = {},
  disabled = false,
  children
}: any) {
  const servar = element.servar;
  const { dynamicOptions, loadingDynamicOptions, shouldSalesforceSync } =
    useSalesforceSync(servar.metadata.salesforce_sync, editMode);
  const otherChecked = fieldVal.includes(otherVal);
  const otherLabel = servar.metadata.other_label ?? 'Other';
  const containerRef = useRef(null);

  const styles = useMemo(() => {
    applyCheckableInputStyles(element, responsiveStyles);
    applyCheckboxGroupStyles(element, responsiveStyles);
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

  const isOptionDisabled = (checked: boolean) => {
    return (
      disabled ||
      loadingDynamicOptions ||
      (servar.max_length && servar.max_length <= fieldVal.length && !checked)
    );
  };
  const otherDisabled = isOptionDisabled(otherChecked);
  const otherTextDisabled = !otherChecked || otherDisabled;

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
        ...responsiveStyles.getTarget('fc')
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
          const checked = fieldVal.includes(value);
          const optionDisabled = isOptionDisabled(checked);

          return (
            <div
              key={`${servar.key}-${i}`}
              css={{
                display: 'flex',
                pointerEvents: optionDisabled ? 'none' : 'auto'
              }}
            >
              <label style={{ display: 'contents' }}>
                <input
                  type='checkbox'
                  id={`${servar.key}-${i}`}
                  name={value}
                  checked={checked}
                  onChange={onChange}
                  onFocus={iosScrollOnFocus}
                  style={{ padding: 0, lineHeight: 'normal' }}
                  css={{
                    ...composeCheckableInputStyle(styles, optionDisabled),
                    ...styles.getTarget('checkboxGroup'),
                    ...(optionDisabled
                      ? responsiveStyles.getTarget('disabled')
                      : {}),
                    '&:focus-visible': { border: '1px solid rgb(74, 144, 226)' }
                  }}
                  disabled={optionDisabled}
                  aria-label={element.properties.aria_label}
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
                text={option.tooltip ?? ''}
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
              type='checkbox'
              id={`${servar.key}-`}
              key={`${servar.key}-`}
              name={otherVal}
              checked={otherChecked}
              disabled={otherDisabled}
              onChange={onChange}
              onFocus={iosScrollOnFocus}
              style={{
                padding: 0,
                lineHeight: 'normal'
              }}
              css={{
                ...composeCheckableInputStyle(styles, otherDisabled),
                ...styles.getTarget('checkboxGroup'),
                ...(otherDisabled
                  ? responsiveStyles.getTarget('disabled')
                  : {}),
                '&:focus-visible': { border: '1px solid rgb(74, 144, 226)' }
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
                ...bootstrapStyles,
                paddingLeft: '0.4rem',
                flexGrow: 1,
                ...responsiveStyles.getTarget('field'),
                ...(otherTextDisabled
                  ? responsiveStyles.getTarget('disabled')
                  : {})
              }}
              id={servar.key}
              value={otherVal || ''}
              onChange={onOtherChange}
              onKeyDown={(e: any) => {
                if (e.key === 'Enter') onEnter(e);
              }}
              required={otherChecked}
              disabled={otherTextDisabled}
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

export default CheckboxGroupField;
