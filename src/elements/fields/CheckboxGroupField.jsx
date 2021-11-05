import React from 'react';
import ReactForm from 'react-bootstrap/Form';
import { bootstrapStyles } from '../styles';

function CheckboxGroupField({
  element,
  applyStyles,
  fieldLabel,
  fieldVal = [],
  otherVal = '',
  onChange = () => {},
  onOtherChange = () => {},
  onClick = () => {}
}) {
  const servar = element.servar;
  const otherChecked = fieldVal.includes(otherVal);
  return (
    <div css={applyStyles.getTarget('fc')}>
      {fieldLabel}
      {servar.metadata.options.map((opt, i) => {
        return (
          <ReactForm.Check
            type='checkbox'
            id={`${servar.key}-${i}`}
            key={`${servar.key}-${i}`}
            name={opt}
            label={opt}
            checked={fieldVal.includes(opt)}
            onChange={onChange}
            onClick={onClick}
            style={{
              display: 'flex',
              alignItems: 'center',
              marginBottom: '5px'
            }}
            css={{
              'input[type="checkbox"]': {
                marginTop: 0,
                marginBottom: 0
              }
            }}
          />
        );
      })}
      {servar.metadata.other && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center'
          }}
        >
          <ReactForm.Check
            type='checkbox'
            id={`${servar.key}-`}
            key={`${servar.key}-`}
            name={otherVal}
            label='Other'
            checked={otherChecked}
            onChange={onChange}
            onClick={onClick}
            style={{
              display: 'flex',
              alignItems: 'center'
            }}
            css={{
              'input[type="checkbox"]': {
                marginTop: 0,
                marginBottom: 0
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
          />
        </div>
      )}
    </div>
  );
}

export default CheckboxGroupField;
