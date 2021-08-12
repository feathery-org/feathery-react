import React from 'react';
import Delta from 'quill-delta';
import generateNodes from './textNodes';
import { alignmentMap } from '../utils/formHelperFunctions';
import { marginStyleFromField } from '../utils/styles';

/**
 * Disambiguation: this is NOT a text "field" that receives input.
 * It just models a block of text in a form.
 */
function TextElement({ field, values, conditions, submit }) {
    const elementID = field.id;
    let delta = new Delta(field.text_formatted);

    conditions.forEach((cond) => {
        if (cond.element_type === 'text' && cond.element_id === elementID) {
            const start = cond.metadata.start || 0;
            const end = cond.metadata.end || field.text.length;
            delta = delta.compose(
                new Delta().retain(start).retain(end - start, { start, end })
            );
        }
    });

    const repeat = field.repeat || 0;
    const nodes = generateNodes({
        delta,
        values,
        field,
        submit,
        repeat,
        elementID
    });
    const containerStyle = {
        gridColumnStart: field.column_index + 1,
        gridRowStart: field.row_index + 1,
        gridColumnEnd: field.column_index_end + 2,
        gridRowEnd: field.row_index_end + 2,
        display: 'flex',
        flexDirection: 'column',
        alignItems: alignmentMap[field.styles.layout],
        textAlign: field.styles.layout,
        justifyContent: field.styles.vertical_layout
    };
    if (field.styles.border_color)
        containerStyle.border = `1px solid #${field.styles.border_color}`;
    const textStyle = marginStyleFromField(field);
    if (field.styles.line_height)
        textStyle.lineHeight = `${field.styles.line_height}px`;

    return (
        <div key={field.id} css={containerStyle}>
            <div style={textStyle}>{nodes}</div>
        </div>
    );
}

export default TextElement;
