import { bootstrapStyles } from '../../utils/styles';

import React from 'react';
import ReactForm from 'react-bootstrap/Form';
import { states } from '../../utils/formHelperFunctions';

function Dropdown({
    field,
    fieldLabel,
    fieldVal,
    onClick,
    onChange,
    inlineError,
    type = 'default'
}) {
    const { servar, applyStyles } = field;

    let placeholder, options;
    if (type === 'states') {
        placeholder = 'State';
        options = states.map((state) => (
            <option key={state} value={state}>
                {state}
            </option>
        ));
    } else {
        placeholder = 'Select...';
        options = servar.metadata.options.map((option) => (
            <option key={option} value={option}>
                {option}
            </option>
        ));
    }

    applyStyles.applyFontStyles('field', !fieldVal);
    return (
        <div
            css={{
                maxWidth: '100%',
                ...applyStyles.getTarget('fc')
            }}
        >
            {fieldLabel}
            <ReactForm.Control
                css={{
                    ...bootstrapStyles,
                    ...applyStyles.getTarget('field'),
                    ...(inlineError ? { borderColor: '#F42525' } : {}),
                    width: '100%',
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    MozAppearance: 'none',
                    backgroundImage:
                        "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'><path d='M0 0.776454L0.970744 0L5 4.2094L9.02926 0L10 0.776454L5 6L0 0.776454Z' fill='black'/></svg>\")",
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 10px center',
                    '&:focus': applyStyles.getTarget('active'),
                    '&:hover': applyStyles.getTarget('hover')
                }}
                as='select'
                id={servar.key}
                value={fieldVal}
                required={servar.required}
                onChange={onChange}
                onClick={onClick}
            >
                <option key='' value='' disabled>
                    {field.placeholder || placeholder}
                </option>
                {options}
            </ReactForm.Control>
            {inlineError && (
                <span
                    css={{
                        alignSelf: 'flex-start',
                        marginTop: '3px',
                        color: '#F42525',
                        ...applyStyles.getTarget('error')
                    }}
                >
                    {inlineError}
                </span>
            )}
        </div>
    );
}

export default Dropdown;
