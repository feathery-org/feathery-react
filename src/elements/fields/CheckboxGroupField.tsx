import React, { useMemo } from 'react';
import ReactForm from 'react-bootstrap/Form';
import { bootstrapStyles } from '../styles';
import {
  applyCheckableInputStyles,
  applyHeightAndWidthByFontSize,
  composeCheckableInputStyle
} from './CheckboxField';

const applyCheckboxGroupStyles = (element: any, applyStyles: any) => {
  applyStyles.addTargets('checkboxGroup');
  applyHeightAndWidthByFontSize(applyStyles, 'checkboxGroup');
  return applyStyles;
};

function CheckboxGroupField({
  element,
  applyStyles,
  fieldLabel,
  fieldVal = [],
  otherVal = '',
  onChange = () => {},
  onOtherChange = () => {},
  elementProps = {},
  children
}: any) {
  const servar = element.servar;
  const otherChecked = fieldVal.includes(otherVal);

  const styles = useMemo(() => {
    applyCheckableInputStyles(element, applyStyles);
    applyCheckboxGroupStyles(element, applyStyles);

    return applyStyles;
  }, [applyStyles]);

  return (
    <div
      css={{
        position: 'relative',
        ...applyStyles.getTarget('fc')
      }}
      {...elementProps}
    >
      {children}
      {fieldLabel}
      {servar.metadata.options.map((opt: any, i: any) => {
        return (
          <div key={`${servar.key}-${i}`} css={{ display: 'flex' }}>
            <input
              type='checkbox'
              id={`${servar.key}-${i}`}
              name={opt}
              checked={fieldVal.includes(opt)}
              onChange={onChange}
              style={{
                marginBottom: '18px',
                padding: 0,
                lineHeight: 'normal'
              }}
              css={{
                ...composeCheckableInputStyle(styles, true),
                ...styles.getTarget('checkboxGroup')
              }}
            />
            <label htmlFor={`${servar.key}-${i}`}>{opt}</label>
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
            onChange={onChange}
            style={{ padding: 0, lineHeight: 'normal' }}
            css={composeCheckableInputStyle(styles, true)}
          />
          <label htmlFor={`${servar.key}-`}>Other</label>
          <ReactForm.Control
            type='text'
            css={{
              marginLeft: '5px',
              ...bootstrapStyles,
              ...applyStyles.getTarget('field'),
              '&:focus': applyStyles.getTarget('active'),
              '&:hover': applyStyles.getTarget('hover')
            }}
            id={servar.key}
            value={otherVal || ''}
            onChange={onOtherChange}
            maxLength={servar.max_length}
            minLength={servar.min_length}
            required={otherChecked}
            disabled={!otherChecked}
          />
        </div>
      )}
    </div>
  );
}

export default CheckboxGroupField;
