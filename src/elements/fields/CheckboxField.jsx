import React from 'react';
import Form from 'react-bootstrap/Form';

function CheckboxField({
  element,
  applyStyles,
  fieldLabel,
  fieldVal = true,
  onChange = () => {},
  onClick = () => {},
  elementProps = {}
}) {
  const servar = element.servar;
  return (
    <div css={applyStyles.getTarget('fc')} {...elementProps}>
      {fieldLabel}
      <Form.Check
        id={servar.key}
        type='checkbox'
        checked={fieldVal}
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
    </div>
  );
}

export default CheckboxField;
