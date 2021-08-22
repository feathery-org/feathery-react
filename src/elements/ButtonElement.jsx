import React, { useState } from 'react';

import Button from 'react-bootstrap/Button';
import Delta from 'quill-delta';
import Spinner from 'react-bootstrap/Spinner';
import generateNodes from '../components/TextNodes';

function ButtonElement({
    element,
    values,
    handleRedirect,
    submit,
    onRepeatClick,
    setSubmitRef
}) {
    const [showSpinner, setShowSpinner] = useState(false);

    const elementID = element.id;
    const delta = new Delta(element.text_formatted);
    const nodes = generateNodes({
        element,
        delta,
        values,
        handleRedirect,
        elementID
    });

    async function buttonOnClick() {
        if (element.link === 'none') {
            return;
        }

        if (
            ['add_repeated_row', 'remove_repeated_row'].includes(element.link)
        ) {
            onRepeatClick();
            return;
        }

        if (element.link === 'submit') {
            setShowSpinner(true);
        }

        // Perform the submit callback
        // Note: We only need to set the spinner if the submit request failed
        // If the request succeeded then the button unmounts and calling setShowSpinner is an error
        try {
            const metadata = {
                elementType: 'button',
                elementIDs: [elementID],
                trigger: 'click'
            };
            let newStep;
            if (element.link === 'submit') {
                newStep = await submit(metadata, element.repeat || 0);
            } else {
                newStep = handleRedirect({ metadata });
            }

            // If the submit failed we want to throw here to turn off the spinner
            if (!newStep) setShowSpinner(false);
        } catch {
            setShowSpinner(false);
        }
    }
    if (element.link === 'submit') setSubmitRef(buttonOnClick);

    const styles = element.applyStyles;
    return (
        <div
            css={{
                display: 'flex',
                flexDirection: 'column',
                ...styles.getLayout(),
                ...styles.getTarget('container')
            }}
        >
            <Button
                id={element.id}
                key={element.id}
                style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    cursor: element.link === 'none' ? 'default' : 'pointer',
                    boxShadow: 'none',
                    maxWidth: '100%'
                }}
                css={{
                    '&:disabled': {
                        cursor: 'default !important'
                    },
                    '&:active': styles.getTarget('buttonActive'),
                    '&:hover:enabled': styles.getTarget('buttonHover'),
                    ...styles.getTarget('button')
                }}
                disabled={element.link === 'none'}
                onClick={buttonOnClick}
            >
                <div style={{ display: 'flex', position: 'relative' }}>
                    {nodes}
                    {element.image_url && (
                        <img
                            src={element.image_url}
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
                                top: '50%',
                                bottom: '50%',
                                marginTop: 'auto',
                                marginBottom: 'auto',
                                border: '0.2em solid currentColor',
                                borderRightColor: 'transparent'
                            }}
                            css={{
                                ...styles.getTarget('spinner'),
                                '@-webkit-keyframes spinner-border': {
                                    to: {
                                        WebkitTransform: 'rotate(360deg)',
                                        transform: 'rotate(360deg)'
                                    }
                                },
                                '@keyframes spinner-border': {
                                    to: {
                                        WebkitTransform: 'rotate(360deg)',
                                        transform: 'rotate(360deg)'
                                    }
                                },
                                '&.spinner-border': {
                                    borderRadius: '50%',
                                    animation:
                                        '0.75s linear infinite spinner-border'
                                }
                            }}
                        />
                    )}
                </div>
            </Button>
        </div>
    );
}

export default ButtonElement;
