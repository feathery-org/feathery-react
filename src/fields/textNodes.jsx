import React from 'react';
import { TEXT_VARIABLE_PATTERN } from '../utils/hydration';

// TODO (jake): Make this in React
const generateNodes = ({
    delta,
    fieldValues,
    field,
    submit,
    repeat,
    elementID
}) => {
    return delta.map((op, i) => {
        // replace placeholder variables and populate newlines
        const text = op.insert.replace(TEXT_VARIABLE_PATTERN, (pattern) => {
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
                    submit(
                        false,
                        {
                            elementType: 'text',
                            elementIDs: [elementID],
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
};

export default generateNodes;
