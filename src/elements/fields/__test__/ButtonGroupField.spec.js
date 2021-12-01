import React from 'react';
import { create, act } from 'react-test-renderer';
import ButtonGroupField from '../ButtonGroupField';
import ApplyStyles from '../../styles';

describe('ButtonGroupField', () => {
  it('renders an empty Button group', () => {
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
          name: 'Name',
          metadata: {
            options: []
          },
          type: 'select'
        },
        properties: { icon_url: 'https://feathery.tech' }
      },
      required: true,
      onChange: jest.fn(),
      onClick: jest.fn()
    };
    props.applyStyles = new ApplyStyles(props.element, []);

    // Act
    let component;
    act(() => {
      component = create(<ButtonGroupField {...props} />);
    });

    // Assert
    const tree = component.toJSON();
    expect(tree).toMatchSnapshot();
  });

  it('renders an empty Button group with options', () => {
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
          name: 'Name',
          metadata: {
            options: ['opt1', 'opt2'],
            option_image_urls: ['', '']
          },
          type: 'select'
        },
        properties: { icon_url: 'https://feathery.tech' }
      },
      required: true,
      onChange: jest.fn(),
      onClick: jest.fn()
    };
    props.applyStyles = new ApplyStyles(props.element, []);

    // Act
    let component;
    act(() => {
      component = create(<ButtonGroupField {...props} />);
    });

    // Assert
    const tree = component.toJSON();
    expect(tree).toMatchSnapshot();
  });
});
