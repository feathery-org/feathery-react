import { calculateStepCSS } from '../hydration';

describe('hydration', () => {
  describe('calculateDimensions', () => {
    it('calculates dimensions', () => {
      // Arrange
      const inputStep = {
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
        progress_bars: [{}],
        subgrids: [
          {
            position: [],
            styles: { background_color: '000000FF' },
            width: 'fit',
            mobile_width: '30px'
          }
        ]
      };
      const expected = {
        backgroundColor: '#000000FF',
        width: '100%',
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
        progress_bars: [{}],
        subgrids: [
          {
            position: [],
            styles: { background_color: '000000FF' },
            width: 'fit'
          }
        ]
      };
      const expected = {
        backgroundColor: '#000000FF',
        width: '100%',
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
