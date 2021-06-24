import React from 'react';
import { create, act } from 'react-test-renderer';
import TextElement from '../TextElement';

describe('Text', () => {
    it('renders an empty text block', async () => {
        // Arrange
        const props = {
            field: { text_formatted: [{ insert: '\n' }] },
            fieldValues: {},
            conditions: [],
            displaySteps: [],
            submit: () => {},
            setElementKey: () => {},
            setRepeat: () => {}
        };

        // Act
        let text;
        act(() => {
            text = create(<TextElement {...props} />);
        });
        const tree = text.toJSON();

        // Assert
        expect(tree).toMatchSnapshot();
    });

    it('renders a plaintext text block', async () => {
        // Arrange
        const props = {
            field: { text_formatted: [{ insert: 'Hello World!' }] },
            fieldValues: {},
            conditions: [],
            displaySteps: [],
            submit: () => {},
            setElementKey: () => {},
            setRepeat: () => {}
        };

        // Act
        let text;
        act(() => {
            text = create(<TextElement {...props} />);
        });
        const tree = text.toJSON();

        // Assert
        expect(tree).toMatchSnapshot();
    });

    it('renders a text block with custom styles', async () => {
        // Arrange
        const props = {
            field: {
                text_formatted: [
                    {
                        insert: 'Hello World!',
                        attributes: {
                            weight: 700,
                            color: '#000000FF',
                            size: '48px',
                            font: 'sans-serif',
                            italic: true,
                            strike: false,
                            underline: false
                        }
                    }
                ]
            },
            fieldValues: {},
            conditions: [],
            displaySteps: [],
            submit: () => {},
            setElementKey: () => {},
            setRepeat: () => {}
        };

        // Act
        let text;
        act(() => {
            text = create(<TextElement {...props} />);
        });
        const tree = text.toJSON();

        // Assert
        expect(tree).toMatchSnapshot();
    });
});
