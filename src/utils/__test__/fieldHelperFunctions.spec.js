import { formatAllFormFields, formatStepFields } from '../fieldHelperFunctions';
import { fieldValues } from '../init';

jest.mock('../init');

describe('fieldHelperFunctions', () => {
  describe('formatStepFields', () => {
    it('formats zero elements correctly', () => {
      // Arrange
      const step = {
        servar_fields: []
      };
      const expected = {};

      // Act
      const actual = formatStepFields(step, null, false);

      // Assert
      expect(actual).toMatchObject(expected);
    });

    it('formats more than zero elements correctly', () => {
      // Arrange
      const step = {
        servar_fields: [
          {
            servar: {
              key: 'key1',
              type: 'text',
              name: 'Name 1',
              metadata: {}
            },
            hide_ifs: [],
            show_logic: false,
            position: [0, 0]
          },
          {
            servar: {
              key: 'key2',
              type: 'file_upload',
              name: 'Name 2',
              metadata: {}
            },
            hide_ifs: [],
            show_logic: false,
            position: [1, 0]
          }
        ]
      };

      Object.assign(fieldValues, { key1: 'value1' });

      const fileObject = new Blob();
      const expected = {
        key1: {
          value: 'value1',
          type: 'text',
          displayText: 'Name 1',
          position: [0, 0]
        },
        key2: {
          value: fileObject,
          type: 'file_upload',
          displayText: 'Name 2',
          position: [1, 0]
        }
      };

      // Act
      const actual = formatStepFields(step, null, false);

      // Assert
      expect(actual).toMatchObject(expected);
    });
  });

  describe('formatAllFormFields', () => {
    it('formats zero steps correctly', () => {
      // Arrange
      const steps = [];
      const expected = {};

      // Act
      const actual = formatAllFormFields(steps);

      // Assert
      expect(actual).toMatchObject(expected);
    });

    it('formats more than zero steps correctly', () => {
      // Arrange
      const steps = [
        {
          servar_fields: [
            {
              servar: {
                key: 'key1',
                type: 'text',
                name: 'Name 1',
                metadata: {}
              },
              hide_ifs: [],
              show_logic: false,
              position: [0, 0]
            }
          ]
        },
        {
          servar_fields: [
            {
              servar: {
                key: 'key2',
                type: 'file_upload',
                name: 'Name 2',
                metadata: {}
              },
              hide_ifs: [],
              show_logic: false,
              position: [1, 0]
            }
          ]
        }
      ];

      Object.assign(fieldValues, { key1: 'value1' });

      const fileObject = new Blob();
      const expected = {
        key1: {
          value: 'value1',
          type: 'text',
          displayText: 'Name 1',
          position: [0, 0]
        },
        key2: {
          value: fileObject,
          type: 'file_upload',
          displayText: 'Name 2',
          position: [1, 0]
        }
      };

      // Act
      const actual = formatAllFormFields(steps);

      // Assert
      expect(actual).toMatchObject(expected);
    });
  });
});
