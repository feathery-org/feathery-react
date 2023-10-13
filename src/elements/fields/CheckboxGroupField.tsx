import React, { useMemo } from 'react';
import ReactForm from 'react-bootstrap/Form';
import { bootstrapStyles } from '../styles';
import {
  applyCheckableInputStyles,
  applyHeightWidthMarginByFontSize,
  composeCheckableInputStyle
} from './CheckboxField';

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
      return { marginBottom: `${a}px` };
    });
    return responsiveStyles;
  }, [responsiveStyles]);

  const labels = servar.metadata.option_labels;
  const otherDisabled =
    disabled ||
    (servar.max_length &&
      servar.max_length <= fieldVal.length &&
      !otherChecked);

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
      {servar.metadata.options.map((opt: any, i: number) => {
        const optionLabel = labels && labels[i] ? labels[i] : opt;
        const checked = fieldVal.includes(opt);
        const optionDisabled =
          disabled ||
          (servar.max_length &&
            servar.max_length <= fieldVal.length &&
            !checked);
        return (
          <div
            key={`${servar.key}-${i}`}
            css={{
              display: 'flex',
              alignItems: 'center',
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
                ...(optionDisabled
                  ? responsiveStyles.getTarget('disabled')
                  : {})
              }}
              disabled={optionDisabled}
            />
            <label htmlFor={`${servar.key}-${i}`}>{optionLabel}</label>
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
            style={{
              padding: 0,
              lineHeight: 'normal'
            }}
            css={{
              ...composeCheckableInputStyle(styles, otherDisabled),
              ...(otherDisabled ? responsiveStyles.getTarget('disabled') : {})
            }}
          />
          <label htmlFor={`${servar.key}-`}>{otherLabel}</label>
          <ReactForm.Control
            type='text'
            css={{
              marginLeft: '5px',
              ...bootstrapStyles,
              paddingLeft: '0.4rem',
              ...responsiveStyles.getTarget('field'),
              ...(otherDisabled ? responsiveStyles.getTarget('disabled') : {})
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
            disabled={otherDisabled || !otherChecked}
          />
        </div>
      )}
    </div>
  );
}

export default CheckboxGroupField;
