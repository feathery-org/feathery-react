import React from 'react';
import { QuillDeltaToHtmlConverter } from 'quill-delta-to-html';

const fontFamilies = {
    'system-font':
        'font-family: 1em / 1.5 system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, Cantarell, "Noto Sans", sans-serif',
    actor: "font-family: 'Actor', sans-serif",
    arial: 'font-family: Arial, sans-serif',
    calistoga: 'font-family: calistoga, serif',
    caslon: 'font-family: adobe-caslon-pro, serif',
    'chronicle-display': 'font-family: Chronicle Display, serif',
    'circular-std': "font-family: 'Circular std', sans-serif",
    'ff-sero-std': "font-family: 'FF Sero Std', sans-serif",
    gotham:
        'font-family: Gotham,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Oxygen,Ubuntu,Cantarell,Droid Sans,Helvetica Neue,sans-serif',
    'open-sans': 'font-family: Open Sans, sans-serif',
    overpass: 'font-family: Overpass, sans-serif',
    'source-sans-pro': "font-family: 'Source Sans Pro', sans-serif"
};
const fontSizes = [
    '8px',
    '9px',
    '10px',
    '12px',
    '14px',
    '16px',
    '20px',
    '24px',
    '32px',
    '42px',
    '54px',
    '68px',
    '84px',
    '98px'
];
const config = {
    paragraphTag: 'div',
    inlineStyles: {
        size: fontSizes.reduce(
            (sizes, size) => ({ [size]: `font-size: ${size}`, ...sizes }),
            {}
        ),
        font: fontFamilies
    }
};

/**
 * Disambiguation: this is NOT a text "field" that receives input.
 * It just models a block of text in a form.
 */
function Text({ text }) {
    const { text_formatted: formattedText } = text;
    const parser = new QuillDeltaToHtmlConverter(formattedText.ops, config);
    const html = parser.convert();

    return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

export default Text;
