import React from 'react';
import { QuillDeltaToHtmlConverter } from 'quill-delta-to-html';

/**
 * Construct a subset of Quill parser config options from the provide deltas.
 * Some config values for parsing the Quill deltas can be derived from the deltas themselves.
 * In this case, we can configure which font sizes and font families to support.
 * @param {Object[]} ops List of Quill deltas
 * @returns Object
 */
function constructConfigFromDeltas(ops) {
    const fontFamilies = {};
    const fontSizes = {};

    ops.forEach((op) => {
        const fontFamily = op.attributes?.font;
        const fontSize = op.attributes?.size;

        if (fontFamily) {
            fontFamilies[fontFamily] = `font-family: ${op.attributes.fontFull}`;
        }

        if (fontSize) {
            fontSizes[fontSize] = `font-size: ${fontSize}`;
        }
    });

    return {
        fontFamilies,
        fontSizes
    };
}

/**
 * Disambiguation: this is NOT a text "field" that receives input.
 * It just models a block of text in a form.
 */
function Text({ text }) {
    const { text_formatted: formattedText } = text;
    const constructedConfig = constructConfigFromDeltas(formattedText.ops);
    const config = {
        paragraphTag: 'div',
        inlineStyles: {
            size: constructedConfig.fontSizes,
            font: constructedConfig.fontFamilies
        }
    };

    const parser = new QuillDeltaToHtmlConverter(formattedText.ops, config);
    const html = parser.convert();

    return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

export default Text;
