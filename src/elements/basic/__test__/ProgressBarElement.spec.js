import React from 'react';
import { create, act } from 'react-test-renderer';
import ProgressBarElement from '../ProgressBarElement';
import ApplyStyles from '../../styles';

describe('ProgressBarElement', () => {
  it('renders an empty progress bar element', async () => {
    // Arrange
    const props = {
      element: {
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
    let progressBar;
    act(() => {
      progressBar = create(<ProgressBarElement {...props} />);
    });

    // Assert
    expect(progressBar).toMatchSnapshot();
  });

  it('renders a non-empty progress bar element', async () => {
    // Arrange
    const props = {
      element: {
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
      },
      curDepth: 20,
      maxDepth: 100
    };
    props.applyStyles = new ApplyStyles(props.element, []);

    // Act
    let progressBar;
    act(() => {
      progressBar = create(<ProgressBarElement {...props} />);
    });

    // Assert
    expect(progressBar).toMatchSnapshot();
  });

  it('renders a progress bar with top positioned percent text', async () => {
    // Arrange
    const props = {
      element: {
        column_index: 0,
        row_index: 0,
        column_index_end: 0,
        row_index_end: 0,
        styles: {
          layout: 'center',
          percent_text_layout: 'top'
        },
        mobile_styles: {}
      },
      curDepth: 20,
      maxDepth: 100
    };
    props.applyStyles = new ApplyStyles(props.element, []);

    // Act
    let progressBar;
    act(() => {
      progressBar = create(<ProgressBarElement {...props} />);
    });

    // Assert
    expect(progressBar).toMatchSnapshot();
  });

  it('renders a progress bar with bottom positioned percent text', async () => {
    // Arrange
    const props = {
      element: {
        column_index: 0,
        row_index: 0,
        column_index_end: 0,
        row_index_end: 0,
        styles: {
          layout: 'center',
          percent_text_layout: 'bottom'
        },
        mobile_styles: {}
      },
      curDepth: 20,
      maxDepth: 100
    };
    props.applyStyles = new ApplyStyles(props.element, []);

    // Act
    let progressBar;
    act(() => {
      progressBar = create(<ProgressBarElement {...props} />);
    });

    // Assert
    expect(progressBar).toMatchSnapshot();
  });
});
