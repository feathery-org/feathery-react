import React from 'react';
import OtpInput from 'react-otp-input';
import { reactFriendlyKey } from '../utils/formHelperFunctions';
import { borderStyleFromField, marginStyleFromField } from '../utils/styles';

function FeatheryPinInput({
    field,
    fieldLabel,
    fieldVal,
    onClick,
    onChange,
    selectCSS,
    hoverCSS,
    inlineError
}) {
    const servar = field.servar;
    const borderStyle = borderStyleFromField(field);
    if (inlineError) borderStyle.borderColor = '#F42525';
    return (
        <div
            key={reactFriendlyKey(field)}
            style={{
                display: 'flex',
                flexDirection: 'row',
                ...marginStyleFromField(field)
            }}
        >
            {fieldLabel}
            <OtpInput
                id={servar.key}
                value={fieldVal}
                onChange={onChange}
                onClick={onClick}
                numInputs={servar.max_length}
                inputStyle={{
                    textAlign: 'center',
                    marginLeft: '8px',
                    outline: 'none',
                    height: `${field.styles.field_height}${field.styles.field_height_unit}`,
                    width: `${field.styles.field_width}${field.styles.field_width_unit}`,
                    backgroundColor: `#${field.styles.background_color}`,
                    boxShadow: `${field.styles.shadow_x_offset}px ${field.styles.shadow_y_offset}px ${field.styles.shadow_blur_radius}px #${field.styles.shadow_color}`,
                    fontSize: `${field.styles.font_size}px`,
                    color: `#${field.styles.font_color}`,
                    borderRadius: field.borderRadius,
                    ...borderStyle
                }}
                css={{
                    '&::placeholder': {
                        color: `#${field.styles.font_color} !important`
                    },
                    '&:focus': {
                        boxShadow: `${field.styles.shadow_x_offset}px ${field.styles.shadow_y_offset}px ${field.styles.shadow_blur_radius}px #${field.styles.shadow_color} !important`,
                        ...selectCSS
                    },
                    '&:hover': hoverCSS
                }}
            />
        </div>
    );
}

export default FeatheryPinInput;
