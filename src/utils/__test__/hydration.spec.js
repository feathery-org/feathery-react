import { calculateStepCSS } from '../hydration';

describe('hydration', () => {
  describe('calculateDimensions', () => {
    it('calculates dimensions', () => {
      // Arrange
      const inputStep = {
        default_background_color: '000000FF',
        texts: [],
        buttons: [],
        servar_fields: [
          {
            properties: {
              text: 'First servar field {{foobar}}'
            }
          }
        ],
        images: [],
        videos: [],
        width: 'fit',
        mobile_width: '30px',
        progress_bars: [{}]
      };
      const expected = {
        backgroundColor: '#000000FF',
        width: 'auto',
        '@media (max-width: 478px)': {
          width: '100%',
          maxWidth: 30
        }
      };

      // Act
      const actual = calculateStepCSS(inputStep);

      // Assert
      expect(actual).toMatchObject(expected);
    });

    it('handles repeating elements', () => {
      // Arrange
      const inputStep = {
        default_background_color: '000000FF',
        texts: [
          {
            properties: { text: 'Repeated text field {{foobar}}' },
            repeat: 0
          },
          {
            properties: { text: 'Repeated text field {{foobar}}' },
            repeat: 1
          },
          {
            properties: { text: 'Repeated text field {{foobar}}' },
            repeat: 2
          }
        ],
        buttons: [
          {
            properties: { text: 'Repeated button field {{foobar}}' },
            repeat: 0
          },
          {
            properties: { text: 'Repeated button field {{foobar}}' },
            repeat: 1
          },
          {
            properties: { text: 'Repeated button field {{foobar}}' },
            repeat: 2
          }
        ],
        servar_fields: [],
        images: [],
        videos: [],
        width: 'fit',
        progress_bars: [{}]
      };
      const expected = {
        backgroundColor: '#000000FF',
        width: 'auto',
        '@media (max-width: 478px)': {
          width: '100%'
        }
      };

      // Act
      const actual = calculateStepCSS(inputStep);

      // Assert
      expect(actual).toMatchObject(expected);
    });
  });
});
