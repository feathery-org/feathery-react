import React from 'react';
import { PinInput, PinInputField } from '@chakra-ui/pin-input';
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
            <PinInput
                id={servar.key}
                defaultValue={fieldVal}
                onChange={onChange}
                onClick={onClick}
                otp
            >
                {Array(servar.max_length)
                    .fill(0)
                    .map((_, i) => (
                        <PinInputField
                            key={`pin-${i}`}
                            style={{
                                textAlign: 'center',
                                marginLeft: '8px',
                                outline: 'none',
                                height: `${field.field_height}${field.field_height_unit}`,
                                width: `${field.field_width}${field.field_width_unit}`,
                                backgroundColor: `#${field.background_color}`,
                                boxShadow: `${field.shadow_x_offset}px ${field.shadow_y_offset}px ${field.shadow_blur_radius}px #${field.shadow_color}`,
                                fontSize: `${field.font_size}px`,
                                color: `#${field.font_color}`,
                                borderRadius: field.borderRadius,
                                ...borderStyle
                            }}
                            css={{
                                '&::placeholder': {
                                    color: `#${field.font_color} !important`
                                },
                                '&:focus': {
                                    boxShadow: `${field.shadow_x_offset}px ${field.shadow_y_offset}px ${field.shadow_blur_radius}px #${field.shadow_color} !important`,
                                    ...selectCSS
                                },
                                '&:hover': hoverCSS
                            }}
                        />
                    ))}
            </PinInput>
        </div>
    );
}

export default FeatheryPinInput;
