import React from 'react';
import { create, act } from 'react-test-renderer';
import { MultiFileUploader } from '..';

const defaultFieldProperty = {
    field_height: '50',
    field_height_unit: '%',
    field_width: '50',
    field_width_unit: 'px',
    background_color: '000000',
    servar: {
        key: 'key',
        name: 'Upload file...',
        required: true,
        metadata: {
            file_types: 'image/*'
        }
    },
    metadata: {
        icon_url: 'https://feathery.tech',
        uploader_padding_top: '0',
        uploader_padding_bottom: '0',
        uploader_padding_left: '0',
        uploader_padding_right: '0',
        cta_padding_top: '0',
        cta_padding_bottom: '0',
        cta_padding_left: '0',
        cta_padding_right: '0'
    }
};

describe('MultiFileUploader', () => {
    it('renders a basic multi-file upload component', () => {
        // Arrange
        const props = {
            field: defaultFieldProperty,
            onChange: jest.fn(),
            onClick: jest.fn()
        };

        // Act
        let component;
        act(() => {
            component = create(<MultiFileUploader {...props} />);
        });

        // Assert
        const tree = component.toJSON();
        expect(tree).toMatchSnapshot();
    });

    it('renders a multi-file upload component with initial files', () => {
        // Arrange
        const props = {
            field: defaultFieldProperty,
            onChange: jest.fn(),
            onClick: jest.fn(),
            initialFiles: [
                {
                    path: '/some/path',
                    url: 'www.google.com'
                },
                {
                    path: '/some/other/path',
                    url: 'www.feathery.biz.org.com.ru'
                }
            ]
        };

        // Act
        let component;
        act(() => {
            component = create(<MultiFileUploader {...props} />);
        });

        // Assert
        const tree = component.toJSON();
        expect(tree).toMatchSnapshot();
    });
});
