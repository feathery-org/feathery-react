import React from 'react';

import { MuiThemeProvider, createMuiTheme } from '@material-ui/core/styles';
import Step from '@material-ui/core/Step';
import Stepper from '@material-ui/core/Stepper';
import StepLabel from '@material-ui/core/StepLabel';
import TextField from '@material-ui/core/TextField';

function MuiProgress({ curStep, maxStep, progressBar }) {
    const muiTheme = createMuiTheme({
        overrides: {
            MuiStepIcon: {
                root: {
                    '&$completed': {
                        color: `#${progressBar.bar_color}`
                    },
                    '&$active': {
                        color: `#${progressBar.bar_color}`
                    }
                },
                text: {
                    color: `#${progressBar.font_color}`,
                    'font-style': progressBar.font_italic ? 'italic' : 'normal',
                    'font-weight': progressBar.font_weight,
                    'font-family': progressBar.font_family,
                    'font-size': `${progressBar.font_size}px`
                }
            },
            MuiSvgIcon: {
                root: {
                    'font-size': '1.8rem'
                }
            }
        }
    });
    return (
        <MuiThemeProvider theme={muiTheme}>
            <Stepper
                activeStep={curStep}
                style={{
                    width: `${progressBar.bar_width}%`,
                    maxWidth: '100%',
                    padding: 0,
                    background: 'none'
                }}
            >
                {[...Array(maxStep).keys()].map((step) => (
                    <Step key={step}>
                        <StepLabel />
                    </Step>
                ))}
            </Stepper>
        </MuiThemeProvider>
    );
}

function MuiField({
    field,
    selectStyle,
    hoverStyle,
    type,
    fieldValue,
    onChange,
    onClick,
    pattern,
    multiline = false,
    props
}) {
    const servar = field.servar;
    const rows = multiline ? field.metadata.num_rows : null;
    const inputProps = pattern ? { pattern } : {};
    if (props && props.inputRef) {
        inputProps.inputRef = props.inputRef;
        delete props.inputRef;
    }
    inputProps.maxLength = servar.max_length;
    inputProps.minLength = servar.min_length;
    if (selectStyle.selected_border_color)
        selectStyle.color = selectStyle.selected_border_color;
    return (
        <TextField
            label={servar.name}
            type={type}
            style={{
                height: `${field.field_height}${field.field_height_unit}`,
                width: `${field.field_width}${field.field_width_unit}`,
                maxWidth: '100%',
                backgroundColor: `#${field.background_color}`,
                border: `${field.border_width}px solid`,
                borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`,
                boxShadow: `${field.shadow_x_offset}px ${field.shadow_y_offset}px ${field.shadow_blur_radius}px #${field.shadow_color}`
            }}
            css={{
                '&::placeholder': {
                    color: `#${field.metadata.placeholder_color} !important`,
                    fontSize: `${field.font_size}px`,
                    fontStyle: field.metadata.placeholder_italic
                        ? 'italic !important'
                        : 'normal !important'
                },
                '&:hover': hoverStyle,
                '& label.Mui-focused': selectStyle,
                '& .MuiInput-underline:after': {
                    borderBottomColor: `#${field.focus_color} !important`
                }
            }}
            InputLabelProps={{
                style: {
                    color: `#${field.font_color}`,
                    fontStyle: field.font_italic ? 'italic' : 'normal',
                    fontWeight: field.font_weight,
                    fontFamily: field.font_family,
                    fontSize: `${field.font_size}px`
                }
            }}
            InputProps={{
                style: {
                    color: `#${field.font_color}`,
                    fontStyle: field.font_italic ? 'italic' : 'normal',
                    fontWeight: field.font_weight,
                    fontFamily: field.font_family,
                    fontSize: `${field.font_size}px`
                }
            }}
            inputProps={inputProps}
            id={servar.key}
            value={fieldValue || ''}
            required={servar.required}
            onChange={onChange}
            onClick={onClick}
            placeholder={field.metadata.placeholder || ''}
            multiline={multiline}
            rows={rows}
            {...props}
        />
    );
}

export { MuiField, MuiProgress };
