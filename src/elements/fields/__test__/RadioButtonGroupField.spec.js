import React from 'react';
import { create, act } from 'react-test-renderer';
import RadioButtonGroupField from '../RadioButtonGroupField';
import ApplyStyles from '../../styles';

describe('RadioButtonGroupField', () => {
  it('renders a Radio Button group', () => {
    // Arrange
    const props = {
      element: {
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
        properties: { icon: 'https://feathery.tech' }
      },
      required: true,
      onChange: jest.fn(),
      onClick: jest.fn()
    };
    props.applyStyles = new ApplyStyles(props.element, []);

    // Act
    let component;
    act(() => {
      component = create(<RadioButtonGroupField {...props} />);
    });

    // Assert
    const tree = component.toJSON();
    expect(tree).toMatchSnapshot();
  });

  it('renders a Radio Button group with metadata options', () => {
    // Arrange
    const props = {
      element: {
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
        properties: { icon: 'https://feathery.tech' }
      },
      required: true,
      onChange: jest.fn(),
      onClick: jest.fn()
    };
    props.applyStyles = new ApplyStyles(props.element, []);

    // Act
    let component;
    act(() => {
      component = create(<RadioButtonGroupField {...props} />);
    });

    // Assert
    const tree = component.toJSON();
    expect(tree).toMatchSnapshot();
  });

  it('renders a Radio Button group with metadata options and others field enabled', () => {
    // Arrange
    const props = {
      element: {
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
        properties: { icon: 'https://feathery.tech' }
      },
      required: true,
      onChange: jest.fn(),
      onClick: jest.fn()
    };
    props.applyStyles = new ApplyStyles(props.element, []);

    // Act
    let component;
    act(() => {
      component = create(<RadioButtonGroupField {...props} />);
    });

    // Assert
    const tree = component.toJSON();
    expect(tree).toMatchSnapshot();
  });
});
