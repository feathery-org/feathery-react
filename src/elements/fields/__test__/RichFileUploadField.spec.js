import React from 'react';
import { create, act } from 'react-test-renderer';
import RichFileUploadField from '../RichFileUploadField';
import ApplyStyles from '../../styles';

describe('RichFileUploadField', () => {
  it('renders a basic file upload component', () => {
    // Arrange
    const props = {
      element: {
        id: 'fieldId',
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
        properties: {
          required: true,
          metadata: {
            file_types: 'image/*'
          },
          icon_url: 'https://feathery.io'
        }
      },
      required: true,
      onChange: jest.fn(),
      onClick: jest.fn()
    };
    props.applyStyles = new ApplyStyles(props.element, []);

    // Act
    let tree;
    act(() => {
      tree = create(<RichFileUploadField {...props} />).toJSON();
    });

    // Assert
    expect(tree).toMatchSnapshot();
  });
});
