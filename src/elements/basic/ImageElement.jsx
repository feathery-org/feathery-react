import React, { useMemo } from 'react';

function applyImageStyles(element, applyStyles) {
    applyStyles.addTargets('image');
    applyStyles.applyMargin('image');
    applyStyles.applyWidth('image');

    if (element.styles.line_height) {
        applyStyles.apply('text', 'line_height', (a) => ({
            lineHeight: `${a}px`
        }));
    }

    return applyStyles;
}

function ImageElement({ element, applyStyles }) {
    const styles = useMemo(() => applyImageStyles(element, applyStyles), [
        applyStyles
    ]);
    return (
        <img
            src={element.source_url}
            alt='Form Image'
            css={{
                objectFit: 'contain',
                ...styles.getTarget('image')
            }}
        />
    );
}

export default ImageElement;
