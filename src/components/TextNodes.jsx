import React from 'react';
import { TEXT_VARIABLE_PATTERN } from '../utils/hydration';
import { isNum } from '../utils/primitives';

// TODO (jake): Make this in React
const generateNodes = ({
    element,
    delta,
    values,
    handleRedirect,
    elementID
}) => {
    return delta
        .filter((op) => op.insert)
        .map((op, i) => {
            // replace placeholder variables and populate newlines
            const text = op.insert.replace(TEXT_VARIABLE_PATTERN, (pattern) => {
                const pStr = pattern.slice(2, -2);
                if (pStr in values) {
                    const pVal = values[pStr];
                    if (Array.isArray(pVal)) {
                        if (pVal.length === 0) {
                            return pattern;
                        } else if (
                            isNaN(element.repeat) ||
                            element.repeat >= pVal.length
                        ) {
                            return pVal[0];
                        } else {
                            return pVal[element.repeat];
                        }
                    } else return pVal;
                } else return pattern;
            });

            let onClick = () => {};
            const attrs = op.attributes || {};
            if (attrs.font_link) {
                onClick = () => window.open(attrs.font_link, '_blank');
            } else if (isNum(attrs.start) && isNum(attrs.end)) {
                onClick = () => {
                    handleRedirect({
                        metadata: {
                            elementType: 'text',
                            elementIDs: [elementID],
                            trigger: 'click',
                            start: attrs.start,
                            end: attrs.end
                        }
                    });
                };
            }

            return (
                <span
                    key={i}
                    css={{
                        whiteSpace: 'pre-wrap',
                        ...element.richFontStyles[i]
                    }}
                    onClick={onClick}
                >
                    {text}
                </span>
            );
        });
};

export default generateNodes;
