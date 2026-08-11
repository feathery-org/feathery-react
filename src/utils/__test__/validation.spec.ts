import {
  validateElement,
  ResolvedCustomValidation,
  getStandardFieldError,
  loadPhoneValidator,
  phoneLibPromise
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

    describe('phone_number validation', () => {
      const phoneKey = 'phone-1';
      const phoneServar = (repeated = false) => ({
        required: true,
        type: 'phone_number',
        key: phoneKey,
        repeated,
        metadata: {}
      });

      beforeAll(async () => {
        loadPhoneValidator();
        await phoneLibPromise;
      });

      it('allows a valid number', () => {
        // Arrange
        const val = '12025550123';
        Object.assign(fieldValues, { [phoneKey]: val });

        // Act
        const actual = getStandardFieldError(val, phoneServar(), null);

        // Assert
        expect(actual).toEqual('');
      });

      it('errors for an invalid number', () => {
        // Arrange
        const val = '1555123';
        Object.assign(fieldValues, { [phoneKey]: val });

        // Act
        const actual = getStandardFieldError(val, phoneServar(), null);

        // Assert
        expect(actual).toEqual('Invalid phone number');
      });

      it('allows a valid number with a leading + and strips it', () => {
        // Arrange: a custom logic rule may erroneously store a leading +
        const val = '+12025550123';
        Object.assign(fieldValues, { [phoneKey]: val });

        // Act
        const actual = getStandardFieldError(val, phoneServar(), null);

        // Assert
        expect(actual).toEqual('');
        expect((fieldValues as any)[phoneKey]).toEqual('12025550123');
      });

      it('strips a leading + for repeated phone values', () => {
        // Arrange
        const val = '+12025550123';
        Object.assign(fieldValues, { [phoneKey]: ['12025550188', val] });

        // Act
        const actual = getStandardFieldError(val, phoneServar(true), 1);

        // Assert
        expect(actual).toEqual('');
        expect((fieldValues as any)[phoneKey]).toEqual([
          '12025550188',
          '12025550123'
        ]);
      });

      it('still errors for an invalid number with a leading +', () => {
        // Arrange
        const val = '+1555123';
        Object.assign(fieldValues, { [phoneKey]: val });

        // Act
        const actual = getStandardFieldError(val, phoneServar(), null);

        // Assert
        expect(actual).toEqual('Invalid phone number');
        expect((fieldValues as any)[phoneKey]).toEqual(val);
      });
    });
  });
});
