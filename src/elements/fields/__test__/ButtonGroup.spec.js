import React from 'react';
import { create, act } from 'react-test-renderer';
import ButtonGroup from '../ButtonGroup';
import { getFieldStyles } from '../../../utils/styles';

import user from '@testing-library/user-event';
import { render } from '@testing-library/react';

describe('ButtonGroup', () => {
    it('renders an empty Button group', () => {
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
                    name: 'Name',
                    metadata: {
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
            component = create(<ButtonGroup {...props} />);
        });

        // Assert
        const tree = component.toJSON();
        expect(tree).toMatchSnapshot();
    });

    it('renders an empty Button group with options', () => {
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
                    name: 'Name',
                    metadata: {
                        options: ['opt1', 'opt2']
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
            component = create(<ButtonGroup {...props} />);
        });

        // Assert
        const tree = component.toJSON();
        expect(tree).toMatchSnapshot();
    });

    // it('renders an empty Button group with options and user interactions', () => {
    //     // Arrange
    //     const props = {
    //         field: {
    //             id: 'fieldId',
    //             apply_styles: {},
    //             styles: {
    //                 height: '50',
    //                 height_unit: '%',
    //                 width: '50',
    //                 width_unit: 'px',
    //                 background_color: '000000',
    //                 uploader_padding_top: '0',
    //                 uploader_padding_bottom: '0',
    //                 uploader_padding_left: '0',
    //                 uploader_padding_right: '0',
    //                 cta_padding_top: '0',
    //                 cta_padding_bottom: '0',
    //                 cta_padding_left: '0',
    //                 cta_padding_right: '0'
    //             },
    //             mobile_styles: {},
    //             servar: {
    //                 key: 'key',
    //                 name: 'Name',
    //                 metadata: {
    //                     options: ['opt1', 'opt2']
    //                 }
    //             },
    //             icon_url: 'https://feathery.tech'
    //         },
    //         required: true,
    //         onChange: jest.fn(),
    //         onClick: jest.fn(),
    //         updateFieldValues: jest.fn()
    //     };
    //     getFieldStyles(props.field);

    //     // // Act
    //     // let component;
    //     // act(() => {
    //     //     component = create(<ButtonGroup {...props} />);
    //     // });

    //     // // Assert
    //     // const tree = component.toJSON();
    //     // expect(tree).toMatchSnapshot();

    //     const { getByText } = render(<ButtonGroup {...props} />);

    //     const otherRadioButton = getByText('opt1');
    //     // console.log(otherRadioButton);
    //     // console.log(expect(otherRadioButton).not.toBeChecked());
    //     user.click(otherRadioButton);
    //     // console.log(expect(otherRadioButton).toBeChecked);
    //     // expect(otherRadioButton).toBeChecked();
    // });
});
