import React from 'react';
import Button from 'react-bootstrap/Button';
import Delta from 'quill-delta';

import { adjustColor, textVariablePattern } from '../utils/formHelperFunctions';

const buttonAlignmentMap = {
    left: 'flex-start',
    center: 'center',
    right: 'flex-end'
};

/**
 * Disambiguation: this is NOT a text "field" that receives input.
 * It just models a block of text in a form.
 */
function Text({
    field,
    fieldValues,
    conditions,
    isFilled,
    displaySteps,
    submit,
    setElementKey,
    setRepeat
}) {
    const elementKey = field.text;
    const repeat = field.repeat || 0;

    let delta = new Delta(field.text_formatted);
    if (!field.is_button) {
        conditions.forEach((cond) => {
            if (
                cond.element_type === 'text' &&
                cond.element_key === elementKey
            ) {
                const start = cond.metadata.start || 0;
                const end = cond.metadata.end || field.text.length;
                delta = delta.compose(
                    new Delta()
                        .retain(start)
                        .retain(end - start, { start, end })
                );
            }
        });
    }

    // TODO (jake): Make this in React
    const nodes = delta.map((op, i) => {
        // replace placeholder variables and populate newlines
        const text = op.insert.replace(textVariablePattern, (pattern) => {
            const pStr = pattern.slice(2, -2);
            if (pStr in fieldValues) {
                const pVal = fieldValues[pStr];
                if (Array.isArray(pVal)) {
                    if (pVal.length === 0) {
                        return pattern;
                    } else if (
                        isNaN(field.repeat) ||
                        field.repeat >= pVal.length
                    ) {
                        return pVal[0];
                    } else {
                        return pVal[field.repeat];
                    }
                } else return pVal;
            } else return pattern;
        });
        const styles = { whiteSpace: 'pre-wrap' };
        let onClick = () => {};

        const attrs = op.attributes;
        if (attrs) {
            if (attrs.start && attrs.end) {
                styles.cursor = 'pointer';
                onClick = () => {
                    setElementKey(elementKey);
                    setRepeat(repeat);
                    submit(
                        false,
                        {
                            elementType: 'text',
                            elementKeys: [elementKey],
                            trigger: 'click',
                            start: attrs.start,
                            end: attrs.end
                        },
                        repeat
                    );
                };
            }

            if (attrs.size) {
                styles.fontSize = `${attrs.size}px`;
            }

            if (attrs.family) {
                styles.fontFamily = attrs.family.replace(/"/g, "'");
            }

            if (attrs.color) {
                styles.color = `#${attrs.color}`;
            }

            if (attrs.weight) {
                styles.fontWeight = attrs.weight;
            }

            if (attrs.italic) {
                styles.fontStyle = 'italic';
            }

            const lines = [];
            if (attrs.strike) {
                lines.push('line-through');
            }

            if (attrs.underline) {
                lines.push('underline');
            }

            if (lines.length > 0) {
                styles.textDecoration = lines.join(' ');
            }
        }

        return (
            <span key={i} style={styles} onClick={onClick}>
                {text}
            </span>
        );
    });

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
                alignItems: buttonAlignmentMap[field.layout],
                textAlign: field.layout,
                justifyContent: field.vertical_layout
            }}
        >
            {field.is_button ? (
                <Button
                    key={elementKey}
                    style={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        cursor: field.link ? 'pointer' : 'default',
                        borderRadius: `${field.border_radius}px`,
                        borderColor: `#${field.border_color}`,
                        backgroundColor: `#${field.button_color}`,
                        boxShadow: 'none',
                        height: `${field.button_height}${field.button_height_unit}`,
                        width: `${field.button_width}${field.button_width_unit}`,
                        maxWidth: '100%'
                    }}
                    css={{
                        '&:disabled': {
                            cursor: 'default !important'
                        },
                        '&:hover:enabled': field.link
                            ? {
                                  backgroundColor: `${adjustColor(
                                      field.button_color,
                                      -30
                                  )} !important`,
                                  borderColor: `${adjustColor(
                                      field.button_color,
                                      -30
                                  )} !important`,
                                  transition: 'background 0.3s !important'
                              }
                            : {}
                    }}
                    disabled={
                        field.link === 'none' ||
                        (field.link === 'submit' && !isFilled)
                    }
                    type={
                        !displaySteps && field.link === 'submit'
                            ? 'submit'
                            : undefined
                    }
                    onClick={() => {
                        setElementKey(elementKey);
                        setRepeat(repeat);
                        if (field.link === 'skip') {
                            submit(
                                false,
                                {
                                    elementType: 'button',
                                    elementKeys: [elementKey],
                                    trigger: 'click'
                                },
                                repeat
                            );
                        }
                    }}
                >
                    {nodes}
                </Button>
            ) : (
                <div>{nodes}</div>
            )}
        </div>
    );
}

export default Text;
