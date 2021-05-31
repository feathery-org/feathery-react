import React from 'react';
import Button from 'react-bootstrap/Button';
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
    isFilled,
    displaySteps,
    submit,
    setElementKey,
    setRepeat
}) {
    // TODO (jake): Make this in React
    const nodes = field.text_formatted
        .map((op) => {
            const attrs = op.attributes;
            const node = document.createElement(attrs?.link ? 'a' : 'span');

            // replace placeholder variables and populate newlines
            node.innerHTML = op.insert
                .replace(textVariablePattern, (pattern) => {
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
                })
                .replace(/\n/g, '<br>');

            if (attrs) {
                if (attrs.size) {
                    node.style.fontSize = `${attrs.size}px`;
                }

                if (attrs.family) {
                    node.style.fontFamily = attrs.family.replace(/"/g, "'");
                }

                if (attrs.color) {
                    node.style.color = `#${attrs.color}`;
                }

                if (attrs.weight) {
                    node.style.fontWeight = attrs.weight;
                }

                if (attrs.italic) {
                    node.style.fontStyle = 'italic';
                }

                if (attrs.link) {
                    node.href = attrs.link;
                }

                const lines = [];
                if (attrs.strike) {
                    lines.push('line-through');
                }

                if (attrs.underline) {
                    lines.push('underline');
                }

                if (lines.length > 0) {
                    node.style.textDecoration = lines.join(' ');
                }
            }

            return node.outerHTML;
        })
        .join('');

    setElementKey('b');
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
                    key={field.text}
                    style={{
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
                        const newElementKey = field.text;
                        const newRepeat = field.repeat || 0;
                        setElementKey(field.text);
                        setRepeat(newRepeat);
                        if (field.link === 'skip') {
                            submit(
                                false,
                                'button',
                                newElementKey,
                                'click',
                                newRepeat
                            );
                        }
                    }}
                    dangerouslySetInnerHTML={{
                        __html: nodes
                    }}
                />
            ) : (
                <div dangerouslySetInnerHTML={{ __html: nodes }} />
            )}
        </div>
    );
}

export default Text;
