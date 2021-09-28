import React from 'react';

import ReactForm from 'react-bootstrap/Form';

function FileUploadField({
    element,
    fieldLabel,
    applyStyles,
    required = false,
    onChange = () => {},
    onClick = () => {}
}) {
    const servar = element.servar;
    return (
        <div css={applyStyles.getTarget('fc')}>
            {fieldLabel}
            <ReactForm.File
                id={servar.key}
                required={required}
                onChange={onChange}
                onClick={onClick}
                style={{ cursor: 'pointer' }}
            />
        </div>
    );
}

export default FileUploadField;
