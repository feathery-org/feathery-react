import React, { useMemo, useState } from 'react';
import ReactForm from 'react-bootstrap/Form';
import { bootstrapStyles } from '../styles';
import {
  applyCheckableInputStyles,
  applyHeightAndWidthByFontSize,
  composeCheckableInputStyle
} from './CheckboxField';

const applyRadioGroupStyles = (element: any, applyStyles: any) => {
  applyStyles.addTargets('radioGroup');
  applyHeightAndWidthByFontSize(applyStyles, 'radioGroup');
  return applyStyles;
};

function RadioButtonGroupField({
  element,
  applyStyles,
  fieldLabel,
  required = false,
  fieldVal = '',
  otherVal = '',
  onChange = () => {},
  onOtherChange = () => {},
  elementProps = {},
  children
}: any) {
  const servar = element.servar;
  const [otherSelect, setOtherSelect] = useState({});
  const otherChecked =
    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    (otherSelect[servar.key] || fieldVal) && fieldVal === otherVal;

  const styles = useMemo(() => {
    applyCheckableInputStyles(element, applyStyles);
    applyRadioGroupStyles(element, applyStyles);

    return applyStyles;
  }, [applyStyles]);

  return (
    <div
      css={{ ...applyStyles.getTarget('fc'), position: 'relative' }}
      {...elementProps}
    >
      {children}
      {fieldLabel}
      {servar.metadata.options.map((opt: any, i: any) => {
        return (
          <div key={`${servar.key}-${i}`} css={{ display: 'flex' }}>
            <input
              type='radio'
              id={`${servar.key}-${i}`}
              // All radio buttons in group must have same name to be evaluated
              // together
              name={servar.key}
              checked={fieldVal === opt}
              required={required}
              onChange={onChange}
              value={opt}
              style={{
                marginBottom: '18px',
                padding: 0,
                lineHeight: 'normal'
              }}
              css={{
                ...composeCheckableInputStyle(styles, true, true),
                ...styles.getTarget('radioGroup')
              }}
            />
            <label htmlFor={`${servar.key}-${i}`}>{opt}</label>
          </div>
        );
      })}
      {servar.metadata.other && (
        <div style={{ display: 'flex' }}>
          <input
            type='radio'
            id={`${servar.key}-`}
            key={`${servar.key}-`}
            name={servar.key}
            checked={otherChecked}
            onChange={(e) => {
              setOtherSelect({
                ...otherSelect,
                [servar.key]: true
              });
              onChange(e);
            }}
            value={otherVal || ''}
            style={{ padding: 0, lineHeight: 'normal' }}
            css={composeCheckableInputStyle(styles, true, true)}
          />
          <label htmlFor={`${servar.key}-`}>Other</label>
          <ReactForm.Control
            type='text'
            css={{
              marginLeft: '5px',
              ...bootstrapStyles,
              paddingLeft: '0.4rem',
              ...applyStyles.getTarget('field')
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

export default RadioButtonGroupField;
