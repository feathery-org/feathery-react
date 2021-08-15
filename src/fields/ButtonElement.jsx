import React, { useState } from 'react';
import { adjustColor, alignmentMap } from '../utils/formHelperFunctions';
import { borderStyleFromField, marginStyleFromField } from '../utils/styles';

import Button from 'react-bootstrap/Button';
import Delta from 'quill-delta';
import Spinner from 'react-bootstrap/Spinner';
import generateNodes from './textNodes';

function ButtonElement({ field, values, submit, onRepeatClick, setSubmitRef }) {
    const [showSpinner, setShowSpinner] = useState(false);

    const elementID = field.id;
    const repeat = field.repeat || 0;
    const delta = new Delta(field.text_formatted);
    const nodes = generateNodes({
        delta,
        values,
        field,
        submit,
        repeat,
        elementID
    });

    async function buttonOnClick() {
        if (field.link === 'none') {
            return;
        }

        if (['add_repeated_row', 'remove_repeated_row'].includes(field.link)) {
            onRepeatClick();
            return;
        }

        if (field.link === 'submit' && field.styles.show_spinner_on_submit) {
            setShowSpinner(true);
        }

        // Perform the submit callback
        // Note: We only need to set the spinner if the submit request failed
        // If the request succeeded then the button unmounts and calling setShowSpinner is an error
        try {
            const newStep = await submit(
                field.link === 'submit',
                {
                    elementType: 'button',
                    elementIDs: [elementID],
                    trigger: 'click'
                },
                repeat
            );

            // If the submit failed we want to throw here to turn off the spinner
            if (!newStep) setShowSpinner(false);
        } catch {
            setShowSpinner(false);
        }
    }
    if (field.link === 'submit') setSubmitRef(buttonOnClick);

    let hoverStyles = borderStyleFromField(field, 'hover_');
    if (field.link !== 'none') {
        const color = `${adjustColor(
            field.styles.background_color,
            -30
        )} !important`;
        hoverStyles = {
            backgroundColor: color,
            borderColor: color,
            transition: 'background 0.3s !important',
            ...hoverStyles
        };
    }
    if (field.styles.hover_background_color)
        hoverStyles.backgroundColor = `#${field.styles.hover_background_color} !important`;
    const selectedStyles = borderStyleFromField(field, 'selected_');
    if (field.styles.selected_background_color)
        selectedStyles.backgroundColor = `#${field.styles.selected_background_color} !important`;

    const borderRadius = `${field.styles.corner_top_left_radius}px ${field.styles.corner_top_right_radius}px ${field.styles.corner_bottom_right_radius}px ${field.styles.corner_bottom_left_radius}px`;
    const halfHeight = Math.round(field.styles.height / 2);
    return (
        <div
            css={{
                gridColumnStart: field.column_index + 1,
                gridRowStart: field.row_index + 1,
                gridColumnEnd: field.column_index_end + 2,
                gridRowEnd: field.row_index_end + 2,
                display: 'flex',
                flexDirection: 'column',
                alignItems: alignmentMap[field.styles.layout],
                textAlign: field.styles.layout,
                justifyContent: field.styles.vertical_layout
            }}
        >
            <Button
                id={field.id}
                key={field.id}
                style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    cursor: field.link === 'none' ? 'default' : 'pointer',
                    backgroundColor: `#${field.styles.background_color}`,
                    boxShadow: 'none',
                    height: `${field.styles.height}${field.styles.height_unit}`,
                    width: `${field.styles.width}${field.styles.width_unit}`,
                    maxWidth: '100%',
                    borderRadius,
                    ...borderStyleFromField(field),
                    ...marginStyleFromField(field)
                }}
                css={{
                    '&:active': selectedStyles,
                    '&:hover:enabled': hoverStyles,
                    '&:disabled': {
                        cursor: 'default !important'
                    }
                }}
                disabled={field.link === 'none'}
                onClick={buttonOnClick}
            >
                <div style={{ display: 'flex', position: 'relative' }}>
                    {nodes}
                    {field.image_url && (
                        <img
                            src={field.image_url}
                            style={{
                                objectFit: 'contain',
                                width: '100%',
                                height: '100%'
                            }}
                        />
                    )}
                    {showSpinner && (
                        <Spinner
                            animation='border'
                            style={{
                                color: 'white',
                                position: 'absolute',
                                right: `-${field.styles.height}${field.styles.height_unit}`,
                                top: '50%',
                                bottom: '50%',
                                marginTop: 'auto',
                                marginBottom: 'auto',
                                width: `${halfHeight}${field.styles.height_unit}`,
                                height: `${halfHeight}${field.styles.height_unit}`,
                                border: '0.2em solid currentColor',
                                borderRightColor: 'transparent'
                            }}
                        />
                    )}
                </div>
            </Button>
        </div>
    );
}

export default ButtonElement;
