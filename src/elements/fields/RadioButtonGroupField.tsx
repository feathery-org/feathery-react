import React, { useMemo, useState } from 'react';
import ReactForm from 'react-bootstrap/Form';
import { bootstrapStyles } from '../styles';
import {
  applyCheckableInputStyles,
  composeCheckableInputStyle
} from './CheckboxField';

const applyRadioGroupStyles = (element: any, applyStyles: any) => {
  applyStyles.addTargets(['radioGroup']);
  applyStyles.applyWidth('radioGroup');
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
      {fieldLabel}
      {servar.metadata.options.map((opt: any, i: any) => {
        return (
          <ReactForm.Check
            type='radio'
            id={`${servar.key}-${i}`}
            key={`${servar.key}-${i}`}
            // All radio buttons in group must have same name to be evaluated
            // together
            name={servar.key}
            label={opt}
            checked={fieldVal === opt}
            required={required}
            onChange={onChange}
            value={opt}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              marginBottom: '18px',
              padding: 0,
              lineHeight: 'normal'
            }}
            css={{
              ...composeCheckableInputStyle(styles, true, 'radio'),
              ...styles.getTarget('radioGroup')
            }}
          />
        );
      })}
      {servar.metadata.other && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: '18px',
            ...styles.getTarget('radioGroup')
          }}
        >
          <ReactForm.Check
            type='radio'
            id={`${servar.key}-`}
            key={`${servar.key}-`}
            name={servar.key}
            label='Other'
            checked={otherChecked}
            onChange={(e) => {
              setOtherSelect({
                ...otherSelect,
                [servar.key]: true
              });
              onChange(e);
            }}
            value={otherVal || ''}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              padding: 0,
              lineHeight: 'normal'
            }}
            css={composeCheckableInputStyle(styles, true, 'radio')}
          />
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
      {children}
    </div>
  );
}

export default RadioButtonGroupField;
