import React, { useMemo, useState } from 'react';
import ReactForm from 'react-bootstrap/Form';
import { bootstrapStyles } from '../styles';
import {
  applyCheckableInputStyles,
  applyHeightWidthMarginByFontSize,
  composeCheckableInputStyle
} from './CheckboxField';
import InlineTooltip from '../components/InlineTooltip';

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
  onChange = () => {},
  onOtherChange = () => {},
  onEnter = () => {},
  elementProps = {},
  children
}: any) {
  const servar = element.servar;
  const [otherSelect, setOtherSelect] = useState({});
  const otherChecked =
    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    (otherSelect[servar.key] || fieldVal) && fieldVal === otherVal;
  const otherTextDisabled = !otherChecked || disabled;
  const otherLabel = servar.metadata.other_label ?? 'Other';

  const styles = useMemo(() => {
    applyCheckableInputStyles(element, responsiveStyles);
    applyRadioGroupStyles(element, responsiveStyles);
    responsiveStyles.apply('row', 'row_separation', (a: number) => {
      return { marginBottom: `${a || 5}px` };
    });
    return responsiveStyles;
  }, [responsiveStyles]);

  const labels = servar.metadata.option_labels;
  const tooltips = servar.metadata.option_tooltips ?? [];
  let options;
  const getOptions = (optionData: any) => {
    return optionData.map((option: any, i: number) => {
      const value = option.value ? option.value : option;
      const label = option.label ? option.label : option;
      const tooltip = option.tooltip ? option.tooltip : '';

      return (
        <div
          key={`${servar.key}-${i}`}
          css={{
            display: 'flex',
            ...styles.getTarget('row')
          }}
        >
          <input
            type='radio'
            id={`${servar.key}-${i}`}
            name={
              repeatIndex !== null ? `${servar.key}-${repeatIndex}` : servar.key
            }
            checked={fieldVal === value}
            required={required}
            disabled={disabled}
            onChange={onChange}
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
  };

  if (
    repeatIndex !== null &&
    servar.metadata.repeat_options !== undefined &&
    servar.metadata.repeat_options[repeatIndex] !== undefined
  ) {
    const repeatOptions = servar.metadata.repeat_options[repeatIndex];
    options = getOptions(repeatOptions);
  } else {
    const optionData = servar.metadata.options.map((opt: any, i: number) => ({
      value: opt,
      label: labels && labels[i] ? labels[i] : opt,
      tooltip: tooltips[i]
    }));
    options = getOptions(optionData);
  }

  return (
    <div
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
      {options}
      {servar.metadata.other && (
        <div style={{ display: 'flex' }}>
          <input
            type='radio'
            id={`${servar.key}-`}
            key={`${servar.key}-`}
            name={
              repeatIndex !== null ? `${servar.key}-${repeatIndex}` : servar.key
            }
            checked={otherChecked}
            disabled={disabled}
            onChange={(e) => {
              setOtherSelect({
                ...otherSelect,
                [servar.key]: true
              });
              onChange(e);
            }}
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
            maxLength={servar.max_length}
            minLength={servar.min_length}
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

export default RadioButtonGroupField;
