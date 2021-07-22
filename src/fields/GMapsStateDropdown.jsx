import React from 'react';
import ReactForm from 'react-bootstrap/Form';
import { states } from '../utils/formHelperFunctions';

function GMapsStateDropdown({
    field,
    fieldLabel,
    fieldVal,
    onClick,
    onChange,
    selectCSS,
    hoverCSS
}) {
    const servar = field.servar;
    return (
        <>
            {fieldLabel}
            <ReactForm.Control
                style={{
                    height: `${field.field_height}${field.field_height_unit}`,
                    width: `${field.field_width}${field.field_width_unit}`,
                    maxWidth: '100%',
                    backgroundColor: `#${field.background_color}`,
                    border: `${field.border_width}px solid`,
                    borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`,
                    borderRadius: `${field.border_radius}px`,
                    fontSize: `${field.font_size}px`,
                    boxShadow: `${field.shadow_x_offset}px ${field.shadow_y_offset}px ${field.shadow_blur_radius}px #${field.shadow_color}`,
                    color: `#${
                        fieldVal
                            ? field.font_color
                            : field.metadata.placeholder_color
                    }`,
                    fontStyle: field.metadata.placeholder_italic
                        ? 'italic'
                        : 'normal'
                }}
                css={{
                    '&:focus': {
                        boxShadow: `${field.shadow_x_offset}px ${field.shadow_y_offset}px ${field.shadow_blur_radius}px #${field.shadow_color} !important`,
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
                <option
                    key=''
                    value=''
                    disabled
                    style={{
                        color: `#${field.metadata.placeholder_color}`,
                        fontStyle: field.metadata.placeholder_italic
                            ? 'italic'
                            : 'normal'
                    }}
                >
                    {field.metadata.placeholder || 'State'}
                </option>
                {states.map((state) => (
                    <option key={state} value={state}>
                        {state}
                    </option>
                ))}
            </ReactForm.Control>
        </>
    );
}

export default GMapsStateDropdown;
