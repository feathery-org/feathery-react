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
  const servar = { required: true, type: 'text_field', key: fieldKey };
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
      const actual = validateElement(field());

      // Assert
      expect(actual).toEqual(expected);
    });
    it('triggers a custom validation message', () => {
      // Arrange
      Object.assign(fieldValues, { [fieldKey]: '100' });

      // Act
      const actual = validateElement({ servar, validations });

      // Assert
      expect(actual).toEqual(customErrorMessage);
    });
    it('works if the field has no validations property', () => {
      // Arrange
      Object.assign(fieldValues, { [fieldKey]: '100' });

      // Act
      const actual = validateElement({ servar });

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
      const actual = getStandardFieldError(val, servar);

      // Assert
      expect(actual).toEqual(expected);
    });
  });
});
