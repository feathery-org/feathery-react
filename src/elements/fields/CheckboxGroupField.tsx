import React, { useMemo } from 'react';
import ReactForm from 'react-bootstrap/Form';
import { bootstrapStyles } from '../styles';
import {
  applyCheckableInputStyles,
  applyHeightWidthMarginByFontSize,
  composeCheckableInputStyle
} from './CheckboxField';
import InlineTooltip from '../components/InlineTooltip';

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
  onChange = () => {},
  onOtherChange = () => {},
  onEnter = () => {},
  elementProps = {},
  disabled = false,
  children
}: any) {
  const servar = element.servar;
  const otherChecked = fieldVal.includes(otherVal);
  const otherLabel = servar.metadata.other_label ?? 'Other';

  const styles = useMemo(() => {
    applyCheckableInputStyles(element, responsiveStyles);
    applyCheckboxGroupStyles(element, responsiveStyles);
    responsiveStyles.addTargets('row');
    responsiveStyles.apply('row', 'row_separation', (a: number) => {
      return { marginBottom: `${a || 5}px` };
    });
    return responsiveStyles;
  }, [responsiveStyles]);

  const labels = servar.metadata.option_labels;
  const tooltips = servar.metadata.option_tooltips ?? [];

  const isOptionDisabled = (checked: boolean) => {
    return (
      disabled ||
      (servar.max_length && servar.max_length <= fieldVal.length && !checked)
    );
  };
  const otherDisabled = isOptionDisabled(otherChecked);
  const otherTextDisabled = !otherChecked || otherDisabled;

  let options;
  if (
    repeatIndex !== null &&
    servar.metadata.repeat_options !== undefined &&
    servar.metadata.repeat_options[repeatIndex] !== undefined
  ) {
    const repeatOptions = servar.metadata.repeat_options[repeatIndex];
    options = repeatOptions.map((option: any, i: number) => {
      const value = option.value ? option.value : option;
      const label = option.label ? option.label : option;
      const tooltip = option.tooltip ? option.tooltip : '';
      const checked = fieldVal.includes(value);
      const optionDisabled = isOptionDisabled(checked);
      return (
        <div
          key={`${servar.key}-${i}`}
          css={{
            display: 'flex',
            pointerEvents: optionDisabled ? 'none' : 'auto',
            ...styles.getTarget('row')
          }}
        >
          <input
            type='checkbox'
            id={`${servar.key}-${i}`}
            name={value}
            checked={checked}
            onChange={onChange}
            style={{
              padding: 0,
              lineHeight: 'normal'
            }}
            css={{
              ...composeCheckableInputStyle(styles, optionDisabled),
              ...styles.getTarget('checkboxGroup'),
              ...(optionDisabled ? responsiveStyles.getTarget('disabled') : {}),
              '&:focus-visible': { border: '1px solid rgb(74, 144, 226)' }
            }}
            disabled={optionDisabled}
            aria-label={element.properties.aria_label}
          />
          <label
            htmlFor={`${servar.key}-${i}`}
            css={{
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              ...styles.getTarget('checkboxLabel')
            }}
          >
            {label}
          </label>
          <InlineTooltip
            id={`${element.id}-${value}`}
            text={tooltip}
            responsiveStyles={responsiveStyles}
            absolute={false}
          />
        </div>
      );
    });
  } else {
    options = servar.metadata.options.map((opt: any, i: number) => {
      const optionLabel = labels && labels[i] ? labels[i] : opt;
      const checked = fieldVal.includes(opt);
      const optionDisabled = isOptionDisabled(checked);
      return (
        <div
          key={`${servar.key}-${i}`}
          css={{
            display: 'flex',
            pointerEvents: optionDisabled ? 'none' : 'auto',
            ...styles.getTarget('row')
          }}
        >
          <input
            type='checkbox'
            id={`${servar.key}-${i}`}
            name={opt}
            checked={checked}
            onChange={onChange}
            style={{
              padding: 0,
              lineHeight: 'normal'
            }}
            css={{
              ...composeCheckableInputStyle(styles, optionDisabled),
              ...styles.getTarget('checkboxGroup'),
              ...(optionDisabled ? responsiveStyles.getTarget('disabled') : {}),
              '&:focus-visible': { border: '1px solid rgb(74, 144, 226)' }
            }}
            disabled={optionDisabled}
            aria-label={element.properties.aria_label}
          />
          <label
            htmlFor={`${servar.key}-${i}`}
            css={{
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              ...styles.getTarget('checkboxLabel')
            }}
          >
            {optionLabel}
          </label>
          <InlineTooltip
            id={`${element.id}-${opt}`}
            text={tooltips[i]}
            responsiveStyles={responsiveStyles}
            absolute={false}
          />
        </div>
      );
    });
  }

  return (
    <div
      css={{
        position: 'relative',
        width: '100%',
        ...responsiveStyles.getTarget('fc')
      }}
      {...elementProps}
    >
      {children}
      {fieldLabel}
      {options}
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
            style={{
              padding: 0,
              lineHeight: 'normal'
            }}
            css={{
              ...composeCheckableInputStyle(styles, otherDisabled),
              ...styles.getTarget('checkboxGroup'),
              ...(otherDisabled ? responsiveStyles.getTarget('disabled') : {}),
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
            id={`${element.id}-`}
            text={servar.metadata.other_tooltip}
            responsiveStyles={responsiveStyles}
            absolute={false}
          />
        </div>
      )}
    </div>
  );
}

export default CheckboxGroupField;
