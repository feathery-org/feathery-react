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
  children
}: any) {
  const servar = element.servar;
  const otherChecked = fieldVal.includes(otherVal);

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
  const allDisabled = element.properties.disabled ?? false;
  const otherDisabled =
    allDisabled ||
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
        const disabled =
          allDisabled ||
          (servar.max_length &&
            servar.max_length <= fieldVal.length &&
            !checked);
        return (
          <div
            key={`${servar.key}-${i}`}
            css={{
              display: 'flex',
              alignItems: 'center',
              pointerEvents: disabled ? 'none' : 'auto',
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
                lineHeight: 'normal',
                filter: disabled ? 'brightness(85%)' : 'none'
              }}
              css={{
                ...composeCheckableInputStyle(styles, allDisabled || disabled),
                ...styles.getTarget('checkboxGroup')
              }}
              disabled={allDisabled || disabled}
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
            disabled={allDisabled}
            onChange={onChange}
            style={{
              padding: 0,
              lineHeight: 'normal',
              filter: otherDisabled ? 'brightness(85%)' : 'none'
            }}
            css={composeCheckableInputStyle(styles, allDisabled)}
          />
          <label htmlFor={`${servar.key}-`}>Other</label>
          <ReactForm.Control
            type='text'
            css={{
              marginLeft: '5px',
              ...bootstrapStyles,
              paddingLeft: '0.4rem',
              filter: otherDisabled ? 'brightness(85%)' : 'none',
              ...responsiveStyles.getTarget('field')
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
            disabled={allDisabled || !otherChecked}
          />
        </div>
      )}
    </div>
  );
}

export default CheckboxGroupField;
