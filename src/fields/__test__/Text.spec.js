import React from 'react';
import { create, act } from 'react-test-renderer';
import Text from '../Text';

describe('Text', () => {
    it('renders an empty text block', async () => {
        // Arrange
        const props = {
            text: {
                text_formatted: {
                    ops: [{ insert: '\n' }]
                }
            }
        };

        // Act
        let text;
        act(() => {
            text = create(<Text {...props} />);
        });
        const tree = text.toJSON();

        // Assert
        expect(tree).toMatchSnapshot();
    });

    it('renders a plaintext text block', async () => {
        // Arrange
        const props = {
            text: {
                text_formatted: {
                    ops: [{ insert: 'Hello World!' }]
                }
            }
        };

        // Act
        let text;
        act(() => {
            text = create(<Text {...props} />);
        });
        const tree = text.toJSON();

        // Assert
        expect(tree).toMatchSnapshot();
    });

    it('renders a text block with custom styles', async () => {
        // Arrange
        const props = {
            text: {
                text_formatted: {
                    ops: [
                        {
                            insert: 'Hello World!',
                            attributes: {
                                weight: 700,
                                color: '#000000',
                                italic: true,
                                size: '48px',
                                font: 'sans',
                                fontFull: 'sans-serif'
                            }
                        }
                    ]
                }
            }
        };

        // Act
        let text;
        act(() => {
            text = create(<Text {...props} />);
        });
        const tree = text.toJSON();

        // Assert
        expect(tree).toMatchSnapshot();
    });
});
