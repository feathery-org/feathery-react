import React from 'react';
import { create, act } from 'react-test-renderer';
import ImageElement from '../ImageElement';
import { getImageStyles } from '../../utils/styles';

describe('ImageElement', () => {
    it('renders an Image element', async () => {
        // Arrange
        const props = {
            element: {
                source_url: '',

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
        getImageStyles(props.element);

        // Act
        let image;
        act(() => {
            image = create(<ImageElement {...props} />);
        });

        // Assert
        expect(image).toMatchSnapshot();
    });
});
