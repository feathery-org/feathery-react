import React from 'react';

import ReactForm from 'react-bootstrap/Form';

function FileUploadField({
  element,
  fieldLabel,
  applyStyles,
  required = false,
  onChange = () => {},
  onClick = () => {},
  elementProps = {},
  children
}) {
  const servar = element.servar;
  return (
    <div
      css={{ ...applyStyles.getTarget('fc'), position: 'relative' }}
      {...elementProps}
    >
      {fieldLabel}
      <ReactForm.File
        id={servar.key}
        required={required}
        onChange={onChange}
        onClick={onClick}
        style={{ cursor: 'pointer' }}
      />
      {children}
    </div>
  );
}

export default FileUploadField;
