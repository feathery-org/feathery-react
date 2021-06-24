import React from 'react';
import { create, act } from 'react-test-renderer';
import ButtonElement from '../ButtonElement';

describe('ButtonElement', () => {
    it('renders an empty Button element', async () => {
        // Arrange
        const props = {
            field: {
                text_formatted: [{ insert: '\n' }],
                column_index: 0,
                row_index: 0,
                column_index_end: 0,
                row_index_end: 0,
                border_color: '2954af',
                button_color: '2954af',
                layout: 'center'
            },
            fieldValues: {},
            conditions: [],
            displaySteps: [],
            submit: () => {},
            setElementKey: () => {},
            setRepeat: () => {}
        };

        // Act
        let button;
        act(() => {
            button = create(<ButtonElement {...props} />);
        });
        const tree = button.toJSON();

        // Assert
        expect(tree).toMatchSnapshot();
    });

    it('renders a button with plain text', async () => {
        // Arrange
        const props = {
            field: {
                text_formatted: [{ insert: 'Hello World!' }],
                column_index: 0,
                row_index: 0,
                column_index_end: 0,
                row_index_end: 0,
                border_color: '2954af',
                button_color: '2954af',
                layout: 'center'
            },
            fieldValues: {},
            conditions: [],
            displaySteps: [],
            submit: () => {},
            setElementKey: () => {},
            setRepeat: () => {}
        };

        // Act
        let button;
        act(() => {
            button = create(<ButtonElement {...props} />);
        });
        const tree = button.toJSON();

        // Assert
        expect(tree).toMatchSnapshot();
    });

    it('renders a button with custom styles', async () => {
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
                ],
                column_index: 0,
                row_index: 0,
                column_index_end: 0,
                row_index_end: 0,
                border_color: '2954af',
                button_color: '2954af',
                layout: 'center'
            },
            fieldValues: {},
            conditions: [],
            displaySteps: [],
            submit: () => {},
            setElementKey: () => {},
            setRepeat: () => {}
        };

        // Act
        let button;
        act(() => {
            button = create(<ButtonElement {...props} />);
        });
        const tree = button.toJSON();

        // Assert
        expect(tree).toMatchSnapshot();
    });
});
