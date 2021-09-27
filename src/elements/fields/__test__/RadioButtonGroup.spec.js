import React from 'react';
import { create, act } from 'react-test-renderer';
import { RadioButtonGroup } from '../..';
import { getFieldStyles } from '../../../utils/styles';

// import user from '@testing-library/user-event';
// import { render } from '@testing-library/react';

describe('RadioButtonGroup', () => {
    it('renders a Radio Button group', () => {
        // Arrange
        const props = {
            field: {
                id: 'fieldId',
                apply_styles: {},
                styles: {
                    height: '50',
                    height_unit: '%',
                    width: '50',
                    width_unit: 'px',
                    background_color: '000000',
                    uploader_padding_top: '0',
                    uploader_padding_bottom: '0',
                    uploader_padding_left: '0',
                    uploader_padding_right: '0',
                    cta_padding_top: '0',
                    cta_padding_bottom: '0',
                    cta_padding_left: '0',
                    cta_padding_right: '0'
                },
                mobile_styles: {},
                servar: {
                    key: 'key',
                    name: 'Upload file...',
                    metadata: {
                        file_types: 'image/*',
                        options: []
                    },
                    type: 'select'
                },
                icon_url: 'https://feathery.tech'
            },
            required: true,
            onChange: jest.fn(),
            onClick: jest.fn()
        };
        getFieldStyles(props.field);

        // Act
        let component;
        act(() => {
            component = create(<RadioButtonGroup {...props} />);
        });

        // Assert
        const tree = component.toJSON();
        expect(tree).toMatchSnapshot();
    });

    it('renders a Radio Button group with metadata options', () => {
        // Arrange
        const props = {
            field: {
                id: 'fieldId',
                apply_styles: {},
                styles: {
                    height: '50',
                    height_unit: '%',
                    width: '50',
                    width_unit: 'px',
                    background_color: '000000',
                    uploader_padding_top: '0',
                    uploader_padding_bottom: '0',
                    uploader_padding_left: '0',
                    uploader_padding_right: '0',
                    cta_padding_top: '0',
                    cta_padding_bottom: '0',
                    cta_padding_left: '0',
                    cta_padding_right: '0'
                },
                mobile_styles: {},
                servar: {
                    key: 'key',
                    name: 'Upload file...',
                    metadata: {
                        file_types: 'image/*',
                        options: ['opt1']
                    },
                    type: 'select'
                },
                icon_url: 'https://feathery.tech'
            },
            required: true,
            onChange: jest.fn(),
            onClick: jest.fn()
        };
        getFieldStyles(props.field);

        // Act
        let component;
        act(() => {
            component = create(<RadioButtonGroup {...props} />);
        });

        // Assert
        const tree = component.toJSON();
        expect(tree).toMatchSnapshot();
    });

    it('renders a Radio Button group with metadata options and others field enabled', () => {
        // Arrange
        const props = {
            field: {
                id: 'fieldId',
                apply_styles: {},
                styles: {
                    height: '50',
                    height_unit: '%',
                    width: '50',
                    width_unit: 'px',
                    background_color: '000000',
                    uploader_padding_top: '0',
                    uploader_padding_bottom: '0',
                    uploader_padding_left: '0',
                    uploader_padding_right: '0',
                    cta_padding_top: '0',
                    cta_padding_bottom: '0',
                    cta_padding_left: '0',
                    cta_padding_right: '0'
                },
                mobile_styles: {},
                servar: {
                    key: 'key',
                    name: 'Upload file...',
                    metadata: {
                        file_types: 'image/*',
                        options: ['opt1']
                    },
                    type: 'select',
                    other: true
                },
                icon_url: 'https://feathery.tech'
            },
            required: true,
            onChange: jest.fn(),
            onClick: jest.fn()
        };
        getFieldStyles(props.field);

        // Act
        let component;
        act(() => {
            component = create(<RadioButtonGroup {...props} />);
        });

        // Assert
        const tree = component.toJSON();
        expect(tree).toMatchSnapshot();
    });

    // it('renders a Radio Button group and simulates user onClick event', () => {
    //     // Arrange
    //     const field = {
    //         id: 'fieldId',
    //         apply_styles: {},
    //         styles: {
    //             height: '50',
    //             height_unit: '%',
    //             width: '50',
    //             width_unit: 'px',
    //             background_color: '000000',
    //             uploader_padding_top: '0',
    //             uploader_padding_bottom: '0',
    //             uploader_padding_left: '0',
    //             uploader_padding_right: '0',
    //             cta_padding_top: '0',
    //             cta_padding_bottom: '0',
    //             cta_padding_left: '0',
    //             cta_padding_right: '0'
    //         },
    //         mobile_styles: {},
    //         servar: {
    //             key: 'key',
    //             name: 'Upload file...',
    //             metadata: {
    //                 options: ['opt1'],
    //                 other: true
    //             },
    //             type: 'select'
    //         },
    //         icon_url: 'https://feathery.tech'
    //     };
    //     const props = {
    //         field,
    //         required: true,
    //         fieldLabel: 'Field Label',
    //         fieldVal: 'opt1',
    //         otherVal: 'otherVal1',
    //         onChange: jest.fn(),
    //         handleOtherStateChange: jest.fn(),
    //         onClick: jest.fn()
    //     };
    //     getFieldStyles(props.field);

    //     // Act
    //     let component;
    //     act(() => {
    //         component = create(<RadioButtonGroup {...props} />);
    //     });

    //     // Assert
    //     const tree = component.toJSON();
    //     expect(tree).toMatchSnapshot();

    //     // const { getByText } = render(<RadioButtonGroup {...props} />);

    //     // const otherRadioButton = getByText('opt1');
    //     // // console.log(otherRadioButton);
    //     // // console.log(expect(otherRadioButton).not.toBeChecked());
    //     // user.click(otherRadioButton);
    //     // // console.log(otherRadioButton);
    //     // // console.log(expect(otherRadioButton).toBeChecked);
    //     // // expect(otherRadioButton).toBeChecked();
    // });
});
