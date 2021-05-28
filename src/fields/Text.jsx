import React from 'react';

/**
 * Disambiguation: this is NOT a text "field" that receives input.
 * It just models a block of text in a form.
 */
function Text({ text }) {
    const { text_formatted: formattedText } = text;

    // TODO: Make this in React
    const nodes = formattedText.ops
        .map((op) => {
            const attrs = op.attributes;

            const node = document.createElement(attrs?.link ? 'a' : 'span');
            node.innerHTML = op.insert.replace(/\n/g, '<br>');

            if (attrs) {
                if (attrs.size) {
                    node.style.fontSize = attrs.size;
                }

                if (attrs.font) {
                    node.style.fontFamily = attrs.fontFull.replace(/"/g, "'");
                }

                if (attrs.color) {
                    node.style.color = attrs.color;
                }

                if (attrs.weight) {
                    node.style.fontWeight = attrs.weight;
                }

                if (attrs.italic) {
                    node.style.fontStyle = 'italic';
                }

                if (attrs.link) {
                    node.href = attrs.link;
                }

                const lines = [];
                if (attrs.strike) {
                    lines.push('line-through');
                }

                if (attrs.underline) {
                    lines.push('underline');
                }

                if (lines.length > 0) {
                    node.style.textDecoration = lines.join(' ');
                }
            }

            return node.outerHTML;
        })
        .join('');

    return <div dangerouslySetInnerHTML={{ __html: nodes }} />;
}

export default Text;
