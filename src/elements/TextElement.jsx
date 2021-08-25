import React from 'react';
import Delta from 'quill-delta';
import generateNodes from '../components/TextNodes';

function TextElement({ element, values, handleRedirect }) {
    const nodes = generateNodes({
        element,
        values,
        handleRedirect,
        delta: new Delta(element.text_formatted),
        elementID: element.id
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
