import React, { useMemo } from 'react';
import { isNum } from '../../utils/primitives';
import Delta from 'quill-delta';

const TEXT_VARIABLE_PATTERN = /{{.*?}}/g;

function TextNodes({
    element,
    values,
    applyStyles,
    handleRedirect,
    conditions = []
}) {
    return useMemo(() => {
        let delta = new Delta(element.text_formatted);
        conditions.forEach((cond) => {
            if (
                cond.element_type === 'text' &&
                cond.element_id === element.id
            ) {
                const start = cond.metadata.start || 0;
                const end = cond.metadata.end || element.text.length;
                delta = delta.compose(
                    new Delta()
                        .retain(start)
                        .retain(end - start, { start, end })
                );
            }
        });
        return delta
            .filter((op) => op.insert)
            .map((op, i) => {
                let text = op.insert;
                if (values) {
                    // replace placeholder variables and populate newlines
                    text = op.insert.replace(
                        TEXT_VARIABLE_PATTERN,
                        (pattern) => {
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
                        }
                    );
                }

                let onClick = () => {};
                const attrs = op.attributes || {};
                if (attrs.font_link) {
                    onClick = () => window.open(attrs.font_link, '_blank');
                } else if (isNum(attrs.start) && isNum(attrs.end)) {
                    onClick = () => {
                        handleRedirect({
                            metadata: {
                                elementType: 'text',
                                elementIDs: [element.id],
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
                            ...applyStyles.getRichFontStyles(attrs)
                        }}
                        onClick={onClick}
                    >
                        {text}
                    </span>
                );
            });
    }, [element, applyStyles]);
}

export default TextNodes;
