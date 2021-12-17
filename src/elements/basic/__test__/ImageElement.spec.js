import React from 'react';
import { create, act } from 'react-test-renderer';
import ImageElement from '../ImageElement';
import ApplyStyles from '../../styles';

describe('ImageElement', () => {
  it('renders an Image element', async () => {
    // Arrange
    const props = {
      element: {
        properties: { source_image: '' },
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
      }
    };
    props.applyStyles = new ApplyStyles(props.element, []);

    // Act
    let image;
    act(() => {
      image = create(<ImageElement {...props} />);
    });

    // Assert
    expect(image).toMatchSnapshot();
  });
});
