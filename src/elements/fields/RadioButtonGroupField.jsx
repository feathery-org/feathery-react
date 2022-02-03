import React, { useState } from 'react';
import ReactForm from 'react-bootstrap/Form';
import { bootstrapStyles } from '../styles';

function RadioButtonGroupField({
  element,
  applyStyles,
  fieldLabel,
  required = false,
  fieldVal = '',
  otherVal = '',
  onChange = () => {},
  onOtherChange = () => {},
  onClick = () => {},
  elementProps = {},
  children
}) {
  const servar = element.servar;
  const [otherSelect, setOtherSelect] = useState({});
  const otherChecked =
    (otherSelect[servar.key] || fieldVal) && fieldVal === otherVal;
  return (
    <div
      css={{ ...applyStyles.getTarget('fc'), position: 'relative' }}
      {...elementProps}
    >
      {fieldLabel}
      {servar.metadata.options.map((opt, i) => {
        return (
          <ReactForm.Check
            type='radio'
            id={`${servar.key}-${i}`}
            key={`${servar.key}-${i}`}
            label={opt}
            checked={fieldVal === opt}
            required={required}
            onChange={onChange}
            onClick={onClick}
            value={opt}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              marginBottom: '18px',
              padding: 0,
              lineHeight: 'normal'
            }}
            css={{
              'input[type="radio"]': {
                margin: '5px 10px 5px 0',
                position: 'static'
              }
            }}
          />
        );
      })}
      {servar.metadata.other && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: '18px'
          }}
        >
          <ReactForm.Check
            type='radio'
            id={`${servar.key}-`}
            key={`${servar.key}-`}
            label='Other'
            checked={otherChecked}
            onChange={(e) => {
              setOtherSelect({
                ...otherSelect,
                [servar.key]: true
              });
              onChange(e);
            }}
            onClick={onClick}
            value={otherVal || ''}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              padding: 0,
              lineHeight: 'normal'
            }}
            css={{
              'input[type="radio"]': {
                margin: '5px 10px 5px 0',
                position: 'static'
              }
            }}
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
            onClick={onClick}
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
