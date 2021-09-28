import React from 'react';
import { create, act } from 'react-test-renderer';
import { adjustColor } from '../ButtonElement';
import Elements from '../..';

describe('ButtonElement', () => {
    describe('adjustColor', () => {
        it('adjusts color up', () => {
            // Arrange
            const color = '#000000';
            const amount = 30;
            const expected = '#1e1e1e';

            // Act
            const actual = adjustColor(color, amount);

            // Assert
            expect(actual).toEqual(expected);
        });

        it('adjusts color down', () => {
            // Arrange
            const color = '#ffffff';
            const amount = -30;
            const expected = '#e1e1e1';

            // Act
            const actual = adjustColor(color, amount);

            // Assert
            expect(actual).toEqual(expected);
        });
    });

    it('renders an empty ButtonElement element', async () => {
        // Arrange
        const props = {
            element: {
                text_formatted: [{ insert: '\n' }],
                column_index: 0,
                row_index: 0,
                column_index_end: 0,
                row_index_end: 0,
                styles: {
                    border_top_color: '2954af',
                    border_right_color: '2954af',
                    border_bottom_color: '2954af',
                    border_left_color: '2954af',
                    background_color: '2954af',
                    layout: 'center'
                },
                mobile_styles: {}
            },
            values: {},
            submit: () => {},
            setSubmitRef: () => {},
            onRepeatClick: () => {}
        };

        // Act
        let button;
        act(() => {
            button = create(<Elements.ButtonElement {...props} />);
        });
        const tree = button.toJSON();

        // Assert
        expect(tree).toMatchSnapshot();
    });

    it('renders a button with plain text', async () => {
        // Arrange
        const props = {
            element: {
                text_formatted: [{ insert: 'Hello World!' }],
                column_index: 0,
                row_index: 0,
                column_index_end: 0,
                row_index_end: 0,
                styles: {
                    background_color: '2954af',
                    layout: 'center'
                },
                mobile_styles: {}
            },
            values: {},
            submit: () => {},
            setSubmitRef: () => {},
            onRepeatClick: () => {}
        };

        // Act
        let button;
        act(() => {
            button = create(<Elements.ButtonElement {...props} />);
        });
        const tree = button.toJSON();

        // Assert
        expect(tree).toMatchSnapshot();
    });

    it('renders a button with custom styles', async () => {
        // Arrange
        const props = {
            element: {
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
                styles: {
                    background_color: '2954af',
                    layout: 'center'
                },
                mobile_styles: {}
            },
            values: {},
            submit: () => {},
            setSubmitRef: () => {},
            onRepeatClick: () => {}
        };

        // Act
        let button;
        act(() => {
            button = create(<Elements.ButtonElement {...props} />);
        });
        const tree = button.toJSON();

        // Assert
        expect(tree).toMatchSnapshot();
    });
});
