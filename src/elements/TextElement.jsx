import React from 'react';
import Delta from 'quill-delta';
import generateNodes from '../components/textNodes';

function TextElement({ element, values, conditions, submit }) {
    const elementID = element.id;
    let delta = new Delta(element.text_formatted);

    conditions.forEach((cond) => {
        if (cond.element_type === 'text' && cond.element_id === elementID) {
            const start = cond.metadata.start || 0;
            const end = cond.metadata.end || element.text.length;
            delta = delta.compose(
                new Delta().retain(start).retain(end - start, { start, end })
            );
        }
    });

    const repeat = element.repeat || 0;
    const nodes = generateNodes({
        element,
        delta,
        values,
        submit,
        repeat,
        elementID
    });

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
            <div css={styles.getTarget('text')}>{nodes}</div>
        </div>
    );
}

export default TextElement;
