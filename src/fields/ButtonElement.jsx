import React, { useState } from 'react';
import Button from 'react-bootstrap/Button';
import Spinner from 'react-bootstrap/Spinner';
import Delta from 'quill-delta';

import { adjustColor, alignmentMap } from '../utils/formHelperFunctions';
import generateNodes from './textNodes';

function ButtonElement({
    field,
    fieldValues,
    displaySteps,
    addRepeatedRow,
    removeRepeatedRow,
    submit,
    setSubmitRef
}) {
    const [showSpinner, setShowSpinner] = useState(false);

    const hoverStyles =
        field.link === 'none'
            ? {}
            : {
                  backgroundColor: `${adjustColor(
                      field.button_color,
                      -30
                  )} !important`,
                  borderColor: `${adjustColor(
                      field.button_color,
                      -30
                  )} !important`,
                  transition: 'background 0.3s !important'
              };
    const selectedStyles = {};
    if (field.hover_border_color)
        hoverStyles.borderColor = `#${field.hover_border_color} !important`;
    if (field.hover_background_color)
        hoverStyles.backgroundColor = `#${field.hover_background_color} !important`;
    if (field.hover_font_color)
        hoverStyles.color = `#${field.hover_font_color} !important`;
    if (field.selected_border_color)
        selectedStyles.borderColor = `#${field.selected_border_color} !important`;
    if (field.selected_background_color)
        selectedStyles.backgroundColor = `#${field.selected_background_color} !important`;
    if (field.selected_font_color)
        selectedStyles.color = `#${field.selected_font_color} !important`;

    const elementKey = field.text;
    const repeat = field.repeat || 0;
    const delta = new Delta(field.text_formatted);
    const nodes = generateNodes({
        delta,
        fieldValues,
        field,
        submit,
        repeat,
        elementKey
    });

    async function buttonOnClick() {
        if (displaySteps || field.link === 'none') {
            return;
        }

        if (field.link === 'add_repeated_row') {
            addRepeatedRow();
            return;
        }

        if (field.link === 'remove_repeated_row') {
            removeRepeatedRow(field.repeat);
            return;
        }

        if (field.link === 'submit' && field.show_spinner_on_submit) {
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
                    elementKeys: [elementKey],
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

    const halfHeight = Math.round(field.button_height / 2);
    return (
        <div
            css={{
                gridColumnStart: field.column_index + 1,
                gridRowStart: field.row_index + 1,
                gridColumnEnd: field.column_index_end + 2,
                gridRowEnd: field.row_index_end + 2,
                paddingBottom: `${field.padding_bottom}px`,
                paddingTop: `${field.padding_top}px`,
                paddingLeft: `${field.padding_left}px`,
                paddingRight: `${field.padding_right}px`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: alignmentMap[field.layout],
                textAlign: field.layout,
                justifyContent: field.vertical_layout
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
                    borderRadius: `${field.border_radius}px`,
                    borderColor: `#${field.border_color}`,
                    backgroundColor: `#${field.button_color}`,
                    boxShadow: 'none',
                    height: `${field.button_height}${field.button_height_unit}`,
                    width: `${field.button_width}${field.button_width_unit}`,
                    maxWidth: '100%'
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
                                right: `-${field.button_height}${field.button_height_unit}`,
                                width: `${halfHeight}${field.button_height_unit}`,
                                height: `${halfHeight}${field.button_height_unit}`,
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
