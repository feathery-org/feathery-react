import {
    borderStyleFromField,
    marginStyleFromField,
    fontStyles,
    bootstrapStyles
} from '../utils/styles';

import React from 'react';
import ReactForm from 'react-bootstrap/Form';
import { states } from '../utils/formHelperFunctions';

function Dropdown({
    field,
    fieldLabel,
    fieldVal,
    onClick,
    onChange,
    selectCSS,
    hoverCSS,
    inlineError,
    type = 'default'
}) {
    const { servar, styles } = field;

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

    const borderStyle = borderStyleFromField(field);
    if (inlineError) borderStyle.borderColor = '#F42525';
    return (
        <div
            style={{
                width: `${styles.width}${styles.width_unit}`,
                maxWidth: '100%',
                ...marginStyleFromField(field)
            }}
        >
            {fieldLabel}
            <ReactForm.Control
                style={{
                    ...bootstrapStyles,
                    ...borderStyle,
                    borderRadius: field.borderRadius,
                    height: `${styles.height}${styles.height_unit}`,
                    width: '100%',
                    backgroundColor: `#${styles.background_color}`,
                    boxShadow: `${styles.shadow_x_offset}px ${styles.shadow_y_offset}px ${styles.shadow_blur_radius}px #${styles.shadow_color}`,
                    ...fontStyles(styles, !fieldVal),
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    MozAppearance: 'none',
                    backgroundImage:
                        "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'><path d='M0 0.776454L0.970744 0L5 4.2094L9.02926 0L10 0.776454L5 6L0 0.776454Z' fill='black'/></svg>\")",
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 10px center'
                }}
                css={{
                    '&:focus': {
                        boxShadow: `${styles.shadow_x_offset}px ${styles.shadow_y_offset}px ${styles.shadow_blur_radius}px #${styles.shadow_color} !important`,
                        ...selectCSS
                    },
                    '&:hover': hoverCSS
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
                    style={{
                        alignSelf: 'flex-start',
                        fontFamily: field.styles.font_family,
                        fontSize: `${field.styles.font_size}px`,
                        marginTop: '3px',
                        color: '#F42525'
                    }}
                >
                    {inlineError}
                </span>
            )}
        </div>
    );
}

export default Dropdown;
