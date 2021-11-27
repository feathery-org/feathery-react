import { calculateStepCSS, calculateRepeatedRowCount } from '../hydration';

describe('hydration', () => {
  describe('calculateDimensions', () => {
    it('calculates dimensions', () => {
      // Arrange
      const inputStep = {
        default_background_color: '000000FF',
        repeat_row_start: 2,
        repeat_row_end: 3,
        texts: [],
        buttons: [],
        servar_fields: [
          {
            properties: {
              text: 'First servar field {{foobar}}'
            },
            row_index: 1,
            row_index_end: 1,
            column_index: 2
          }
        ],
        images: [],
        grid_rows: ['50px', '150px', '50px'],
        grid_columns: ['150px', '1fr'],
        mobile_grid_columns: ['30px'],
        progress_bars: [
          {
            column_index: 0
          }
        ]
      };
      const expected = {
        backgroundColor: '#000000FF',
        display: 'grid',
        maxWidth: '100%',
        gridTemplateRows:
          'minmax(50px,min-content) minmax(150px,min-content) minmax(50px,min-content)',
        width: '100%',
        gridTemplateColumns: '150px 1fr',
        '@media (max-width: 478px)': {
          width: '30px',
          gridTemplateRows:
            'minmax(50px,min-content) minmax(150px,min-content) minmax(50px,min-content)',
          gridTemplateColumns: '30px'
        },
        '@media (max-width: 150px)': {
          width: '150px',
          gridTemplateColumns: '100% 0'
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
        repeat_row_start: 1,
        repeat_row_end: 1,
        texts: [
          {
            properties: { text: 'Repeated text field {{foobar}}' },
            column_index: 2,
            repeat: 0,
            row_index: 1,
            row_index_end: 1
          },
          {
            properties: { text: 'Repeated text field {{foobar}}' },
            column_index: 2,
            repeat: 1,
            row_index: 2,
            row_index_end: 2
          },
          {
            properties: { text: 'Repeated text field {{foobar}}' },
            column_index: 2,
            repeat: 2,
            row_index: 3,
            row_index_end: 3
          }
        ],
        buttons: [
          {
            properties: { text: 'Repeated button field {{foobar}}' },
            column_index: 2,
            repeat: 0,
            row_index: 1,
            row_index_end: 1
          },
          {
            properties: { text: 'Repeated button field {{foobar}}' },
            column_index: 2,
            repeat: 1,
            row_index: 2,
            row_index_end: 2
          },
          {
            properties: { text: 'Repeated button field {{foobar}}' },
            column_index: 2,
            repeat: 2,
            row_index: 3,
            row_index_end: 3
          }
        ],
        servar_fields: [],
        images: [],
        grid_rows: ['50px', '150px', '150px', '150px', '50px'],
        grid_columns: ['150px', '50%'],
        progress_bars: [
          {
            column_index: 0
          }
        ]
      };
      const expected = {
        backgroundColor: '#000000FF',
        display: 'grid',
        maxWidth: '100%',
        gridTemplateRows:
          'minmax(50px,min-content) minmax(150px,min-content) minmax(150px,min-content) minmax(150px,min-content) minmax(50px,min-content)',
        width: '100%',
        gridTemplateColumns: '150px 50%',
        '@media (max-width: 478px)': {
          width: '100%',
          gridTemplateRows:
            'minmax(50px,min-content) minmax(150px,min-content) minmax(150px,min-content) minmax(150px,min-content) minmax(50px,min-content)',
          gridTemplateColumns: '150px 50%'
        },
        '@media (max-width: 150px)': {
          width: '150px',
          gridTemplateColumns: '100% 0'
        }
      };

      // Act
      const actual = calculateStepCSS(inputStep);

      // Assert
      expect(actual).toMatchObject(expected);
    });
  });

  describe('calculateRepeatedRowCount', () => {
    it('calculates one row', () => {
      // Arrange
      const step = {
        texts: [],
        buttons: [],
        servar_fields: []
      };
      const values = {};
      const expected = 1;

      // Act
      const actual = calculateRepeatedRowCount({ step, values });

      // Assert
      expect(actual).toEqual(expected);
    });

    it('calculates with text elements', () => {
      // Arrange
      const step = {
        repeat_row_start: 0,
        repeat_row_end: 0,
        texts: [
          {
            row_index: 0,
            row_index_end: 0,
            properties: { text: '{{foobar}}' }
          }
        ],
        buttons: [
          {
            row_index: 0,
            row_index_end: 0,
            properties: { text: '{{foobar}}' }
          }
        ],
        servar_fields: []
      };
      const values = {
        foobar: [1, 2, 3]
      };
      const expected = 3;

      // Act
      const actual = calculateRepeatedRowCount({ step, values });

      // Assert
      expect(actual).toEqual(expected);
    });

    it('calculates with servar elements', () => {
      // Arrange
      const step = {
        repeat_row_start: 0,
        repeat_row_end: 0,
        texts: [],
        buttons: [],
        servar_fields: [
          {
            servar: {
              repeated: true,
              key: 'foobar'
            }
          }
        ]
      };
      const values = {
        foobar: [1, 2, 3]
      };
      const expected = 3;

      // Act
      const actual = calculateRepeatedRowCount({ step, values });

      // Assert
      expect(actual).toEqual(expected);
    });

    it('calculates with servar and text elements', () => {
      // Arrange
      const step = {
        repeat_row_start: 0,
        repeat_row_end: 0,
        texts: [
          {
            row_index: 0,
            row_index_end: 0,
            properties: { text: '{{foobar}}' }
          }
        ],
        buttons: [
          {
            row_index: 0,
            row_index_end: 0,
            properties: { text: '{{foobar}}' }
          }
        ],
        servar_fields: [
          {
            servar: {
              repeated: true,
              key: 'foobar2'
            }
          }
        ]
      };
      const values = {
        foobar: [1, 2, 3],
        foobar2: [1, 2]
      };
      const expected = 3;

      // Act
      const actual = calculateRepeatedRowCount({ step, values });

      // Assert
      expect(actual).toEqual(expected);
    });
  });
});
