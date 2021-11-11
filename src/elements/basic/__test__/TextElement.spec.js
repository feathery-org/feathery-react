import React from 'react';
import { create, act } from 'react-test-renderer';
import Elements from '../..';

describe('Text', () => {
  it('renders an empty text block', async () => {
    // Arrange
    const props = {
      element: {
        styles: {},
        mobile_styles: {},
        properties: { text_formatted: [{ insert: '\n' }] }
      },
      values: {},
      conditions: [],
      submit: () => {}
    };

    // Act
    let text;
    act(() => {
      text = create(<Elements.TextElement {...props} />);
    });
    const tree = text.toJSON();

    // Assert
    expect(tree).toMatchSnapshot();
  });

  it('renders a plaintext text block', async () => {
    // Arrange
    const props = {
      element: {
        styles: {},
        mobile_styles: {},
        properties: { text_formatted: [{ insert: 'Hello World!' }] }
      },
      values: {},
      conditions: [],
      submit: () => {}
    };

    // Act
    let text;
    act(() => {
      text = create(<Elements.TextElement {...props} />);
    });
    const tree = text.toJSON();

    // Assert
    expect(tree).toMatchSnapshot();
  });

  it('renders a text block with custom styles', async () => {
    // Arrange
    const props = {
      element: {
        styles: {},
        mobile_styles: {},
        properties: {
          text_formatted: [
            {
              insert: 'Hello World!',
              attributes: {
                weight: 700,
                color: '#000000FF',
                size: '48px',
                font: 'sans-serif',
                italic: true,
                strike: false,
                underline: false
              }
            }
          ]
        }
      },
      values: {},
      conditions: [],
      submit: () => {}
    };

    // Act
    let text;
    act(() => {
      text = create(<Elements.TextElement {...props} />);
    });
    const tree = text.toJSON();

    // Assert
    expect(tree).toMatchSnapshot();
  });
});
