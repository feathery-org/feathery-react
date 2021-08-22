import React from 'react';

function ImageElement({ element }) {
    const styles = element.applyStyles;
    return (
        <div
            css={{
                display: 'flex',
                ...styles.getLayout(),
                ...styles.getTarget('container')
            }}
        >
            <img
                src={element.source_url}
                alt='Form Image'
                css={{
                    objectFit: 'contain',
                    ...styles.getTarget('image')
                }}
            />
        </div>
    );
}

export default ImageElement;
