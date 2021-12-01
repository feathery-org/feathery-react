import React from 'react';
import { create, act } from 'react-test-renderer';
import CheckboxGroupField from '../CheckboxGroupField';
import ApplyStyles from '../../styles';

describe('CheckboxGroupField', () => {
  it('renders a Radio Button group', () => {
    // Arrange
    const element = {
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
      properties: { icon_url: 'https://feathery.tech' }
    };
    const props = {
      element,
      fieldLabel: 'label',
      fieldVal: 'val',
      otherVal: 'otherVal',
      step: { servar_fields: [element] },
      fieldValues: { key: 'val' },
      updateFieldValues: { newKey: 'newVal' },
      onChange: jest.fn(),
      handleOtherStateChange: jest.fn(),
      onClick: jest.fn(),
      applyStyles: new ApplyStyles(element, [])
    };

    // Act
    let component;
    act(() => {
      component = create(<CheckboxGroupField {...props} />);
    });

    // Assert
    const tree = component.toJSON();
    expect(tree).toMatchSnapshot();
  });
});
