import React from 'react';
import Delta from 'quill-delta';
import generateNodes from './textNodes';
import { alignmentMap } from '../utils/formHelperFunctions';

/**
 * Disambiguation: this is NOT a text "field" that receives input.
 * It just models a block of text in a form.
 */
function TextElement({ field, fieldValues, conditions, submit }) {
    const elementKey = field.text;
    const repeat = field.repeat || 0;

    let delta = new Delta(field.text_formatted);

    conditions.forEach((cond) => {
        if (cond.element_type === 'text' && cond.element_key === elementKey) {
            const start = cond.metadata.start || 0;
            const end = cond.metadata.end || field.text.length;
            delta = delta.compose(
                new Delta().retain(start).retain(end - start, { start, end })
            );
        }
    });

    const nodes = generateNodes({
        delta,
        fieldValues,
        field,
        submit,
        repeat,
        elementKey
    });
    const style = {
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
    };
    if (field.border_color) style.border = `1px solid #${field.border_color}`;

    return (
        <div key={field.id} css={style}>
            <div>{nodes}</div>
        </div>
    );
}

export default TextElement;
