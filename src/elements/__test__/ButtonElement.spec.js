import React from 'react';
import { create, act } from 'react-test-renderer';
import ButtonElement from '../ButtonElement';
import { getButtonStyles } from '../../utils/styles';

describe('ButtonElement', () => {
    it('renders an empty Button element', async () => {
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
        getButtonStyles(props.element);

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
        getButtonStyles(props.element);

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
        getButtonStyles(props.element);

        // Act
        let button;
        act(() => {
            button = create(<ButtonElement {...props} />);
        });
        const tree = button.toJSON();

        // Assert
        expect(tree).toMatchSnapshot();
    });

    it('renders a button with link none', async () => {
        // Arrange
        const props = {
            element: {
                link: 'none',
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
        getButtonStyles(props.element);

        // Act
        let button;
        act(() => {
            button = create(<ButtonElement {...props} />);
        });
        button.root.findByType('button').props.onClick();
        const tree = button.toJSON();

        // Assert
        expect(tree).toMatchSnapshot();
    });

    it('renders a button with link submit', async () => {
        // Arrange
        const props = {
            element: {
                link: 'submit',
                text_formatted: [
                    {
                        insert: 'Hello World!'
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
        getButtonStyles(props.element);

        // Act
        let button;
        act(() => {
            button = create(<ButtonElement {...props} />);
        });
        button.root.findByType('button').props.onClick();
        const tree = button.toJSON();

        // Assert
        expect(tree).toMatchSnapshot();
    });

    // it('renders a button with link add_repeated_row', async () => {
    //     // Arrange
    //     const props = {
    //         element: {
    //             link: 'add_repeated_row',
    //             text_formatted: [
    //                 {
    //                     insert: 'Hello World!'
    //                 }
    //             ],
    //             column_index: 0,
    //             row_index: 0,
    //             column_index_end: 0,
    //             row_index_end: 0,
    //             styles: {
    //                 background_color: '2954af',
    //                 layout: 'center'
    //             },
    //             mobile_styles: {}
    //         },
    //         values: {},
    //         submit: () => {},
    //         setSubmitRef: () => {},
    //         onRepeatClick: () => {},
    //         handleRedirect: () => {}
    //     };
    //     getButtonStyles(props.element);

    //     // Act
    //     let button;
    //     act(() => {
    //         button = create(<ButtonElement {...props} />);
    //         console.log(button.root);
    //     });

    //     button.root.findByType('button').props.onClick();
    //     const tree = button.toJSON();

    //     // Assert
    //     expect(tree).toMatchSnapshot();
    // });
});
