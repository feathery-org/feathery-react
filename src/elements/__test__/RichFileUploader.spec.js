import React from 'react';
import { create, act } from 'react-test-renderer';
import { RichFileUploader } from '..';
import { getFieldStyles } from '../../utils/styles';

describe('RichFileUploader', () => {
    it('renders a basic file upload component', () => {
        // Arrange
        const props = {
            field: {
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
                    required: true,
                    metadata: {
                        file_types: 'image/*'
                    }
                },
                icon_url: 'https://feathery.tech'
            },
            onChange: jest.fn(),
            onClick: jest.fn()
        };
        getFieldStyles(props.field);

        // Act
        let component;
        act(() => {
            component = create(<RichFileUploader {...props} />);
        });

        // Assert
        const tree = component.toJSON();
        expect(tree).toMatchSnapshot();
    });
});
