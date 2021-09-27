import React from 'react';
import { create, act } from 'react-test-renderer';
import CheckboxGroup from '../CheckboxGroup';
import { getFieldStyles } from '../../../utils/styles';

// import user from '@testing-library/user-event';
// import { render } from '@testing-library/react';

describe('CheckboxGroup', () => {
    it('renders a Radio Button group', () => {
        // Arrange
        const field = {
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
        };
        const props = {
            field: field,
            fieldLabel: 'label',
            fieldVal: 'val',
            otherVal: 'otherVal',
            step: { servar_fields: [field] },
            fieldValues: { key: 'val' },
            updateFieldValues: { newKey: 'newVal' },
            onChange: jest.fn(),
            handleOtherStateChange: jest.fn(),
            onClick: jest.fn()
        };
        getFieldStyles(props.field);

        // Act
        let component;
        act(() => {
            component = create(<CheckboxGroup {...props} />);
        });

        // Assert
        const tree = component.toJSON();
        expect(tree).toMatchSnapshot();
    });
});
