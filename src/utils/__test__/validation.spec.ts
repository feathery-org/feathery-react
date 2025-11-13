import {
  validateElement,
  ResolvedCustomValidation,
  getStandardFieldError
} from '../validation';
import { fieldValues } from '../init';

jest.mock('../init', () => ({
  initInfo: jest.fn().mockReturnValue({
    sdkKey: 'dummy_key',
    defaultErrors: {
      required: 'This is a required field',
      phone_number: 'Invalid phone number',
      email: 'Invalid email format',
      url: 'Invalid URL',
      ssn: 'Invalid social security number',
      pin_input: 'Please enter a full code'
    }
  }),
  fieldValues: {}
}));

describe('validation', () => {
  const fieldKey = 'text-field-1';
  const servar = {
    required: true,
    type: 'text_field',
    key: fieldKey,
    repeated: false
  };
  const field = (modifiedProps = {}) =>
    Object.assign({ servar, validations: [] }, modifiedProps);
  const customErrorMessage = 'Custom error message';

  const validations: ResolvedCustomValidation[] = [
    {
      message: customErrorMessage,
      rules: [
        {
          field_type: 'servar',
          comparison: 'equal',
          values: ['100'],
          field_id: null,
          field_key: fieldKey
        }
      ]
    }
  ];

  describe('validateElement', () => {
    it('gets the default error for an empty required value', () => {
      // Arrange
      Object.assign(fieldValues, { [fieldKey]: '' });
      const expected = 'This is a required field';

      // Act
      const actual = validateElement(field(), 0);

      // Assert
      expect(actual).toEqual(expected);
    });
    it('triggers a custom validation message', () => {
      // Arrange
      Object.assign(fieldValues, { [fieldKey]: '100' });

      // Act
      const actual = validateElement({ servar, validations }, 0);

      // Assert
      expect(actual).toEqual(customErrorMessage);
    });
    it('works if the field has no validations property', () => {
      // Arrange
      Object.assign(fieldValues, { [fieldKey]: '100' });

      // Act
      const actual = validateElement({ servar }, 0);

      // Assert
      expect(actual).toEqual('');
    });
  });

  describe('getStandardFieldError', () => {
    it('gets the error for an empty required value', () => {
      // Arrange
      const val = '';
      const servar = { required: true, type: 'text_field' };
      const expected = 'This is a required field';

      // Act
      const actual = getStandardFieldError(val, servar, null);

      // Assert
      expect(actual).toEqual(expected);
    });

    describe('file_upload validation', () => {
      it('detects [null] as empty', () => {
        // Arrange
        const val = [null];
        const servar = { required: true, type: 'file_upload' };
        const expected = 'This is a required field';

        // Act
        const actual = getStandardFieldError(val, servar, null);

        // Assert
        expect(actual).toEqual(expected);
      });

      it('detects [undefined] as empty', () => {
        // Arrange
        const val = [undefined];
        const servar = { required: true, type: 'file_upload' };
        const expected = 'This is a required field';

        // Act
        const actual = getStandardFieldError(val, servar, null);

        // Assert
        expect(actual).toEqual(expected);
      });

      it('detects [""] as empty', () => {
        // Arrange
        const val = [''];
        const servar = { required: true, type: 'file_upload' };
        const expected = 'This is a required field';

        // Act
        const actual = getStandardFieldError(val, servar, null);

        // Assert
        expect(actual).toEqual(expected);
      });

      it('detects [null, null] as empty', () => {
        // Arrange
        const val = [null, null];
        const servar = { required: true, type: 'file_upload' };
        const expected = 'This is a required field';

        // Act
        const actual = getStandardFieldError(val, servar, null);

        // Assert
        expect(actual).toEqual(expected);
      });

      it('allows valid file Promise', () => {
        // Arrange
        const val = [Promise.resolve(new File(['content'], 'test.jpg'))];
        const servar = { required: true, type: 'file_upload' };

        // Act
        const actual = getStandardFieldError(val, servar, null);

        // Assert
        expect(actual).toEqual('');
      });

      it('detects empty array as empty', () => {
        // Arrange
        const val: any[] = [];
        const servar = { required: true, type: 'file_upload' };
        const expected = 'This is a required field';

        // Act
        const actual = getStandardFieldError(val, servar, null);

        // Assert
        expect(actual).toEqual(expected);
      });
    });

    describe('button_group validation', () => {
      it('detects [null] as empty for button_group', () => {
        // Arrange
        const val = [null];
        const servar = { required: true, type: 'button_group' };
        const expected = 'This is a required field';

        // Act
        const actual = getStandardFieldError(val, servar, null);

        // Assert
        expect(actual).toEqual(expected);
      });

      it('allows valid button_group value', () => {
        // Arrange
        const val = ['option1'];
        const servar = { required: true, type: 'button_group' };

        // Act
        const actual = getStandardFieldError(val, servar, null);

        // Assert
        expect(actual).toEqual('');
      });
    });
  });
});
