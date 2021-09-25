import React, { useMemo, useState } from 'react';

import ReactButton from 'react-bootstrap/Button';
import Spinner from 'react-bootstrap/Spinner';
import TextNodes from '../components/TextNodes';

function adjustColor(color, amount) {
    return (
        '#' +
        color
            .replace(/^#/, '')
            .replace(/../g, (color) =>
                (
                    '0' +
                    Math.min(
                        255,
                        Math.max(0, parseInt(color, 16) + amount)
                    ).toString(16)
                ).substr(-2)
            )
    );
}

function applyButtonStyles(element, applyStyles) {
    applyStyles.addTargets('button', 'buttonActive', 'buttonHover', 'spinner');

    applyStyles.apply('button', 'background_color', (a) => ({
        backgroundColor: `#${a}`
    }));
    applyStyles.applyHeight('button');
    applyStyles.applyWidth('button');
    applyStyles.applyCorners('button');
    applyStyles.applyBorders('button');
    applyStyles.applyMargin('button');

    applyStyles.applyBorders('buttonHover', 'hover_');
    if (element.link !== 'none') {
        applyStyles.apply('buttonHover', 'background_color', (a) => {
            const color = `${adjustColor(a, -30)} !important`;
            return {
                backgroundColor: color,
                borderColor: color,
                transition: 'background 0.3s !important'
            };
        });
    }
    if (element.styles.hover_background_color) {
        applyStyles.apply('buttonHover', 'hover_background_color', (a) => ({
            backgroundColor: `#${a} !important`
        }));
    }

    applyStyles.applyBorders('buttonActive', 'selected_');
    if (element.styles.selected_background_color) {
        applyStyles.apply('buttonHover', 'selected_background_color', (a) => ({
            backgroundColor: `#${a} !important`
        }));
    }

    applyStyles.apply('spinner', 'show_spinner_on_submit', (a) => ({
        display: a ? 'default' : 'none'
    }));
    applyStyles.apply('spinner', ['height', 'height_unit'], (a, b) => {
        const thirdHeight = Math.round(a / 3);
        return {
            right: `-${a}${b}`,
            width: `${thirdHeight}${b}`,
            height: `${thirdHeight}${b}`
        };
    });

    return applyStyles;
}

function ButtonElement({
    element,
    applyStyles,
    values = null,
    handleRedirect = () => {},
    submit = () => {},
    onRepeatClick = () => {},
    setSubmitRef = () => {}
}) {
    const [showSpinner, setShowSpinner] = useState(false);

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
                elementIDs: [element.id],
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

    const styles = useMemo(() => applyButtonStyles(element, applyStyles), [
        applyStyles
    ]);
    return (
        <ReactButton
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
            disabled={element.link === 'none' || showSpinner}
            onClick={buttonOnClick}
        >
            <div style={{ display: 'flex', position: 'relative' }}>
                <TextNodes
                    element={element}
                    values={values}
                    applyStyles={applyStyles}
                    handleRedirect={handleRedirect}
                />
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
        </ReactButton>
    );
}

export default ButtonElement;
export { adjustColor };
