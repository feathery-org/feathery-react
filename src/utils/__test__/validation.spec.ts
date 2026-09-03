import {
  validateElement,
  validateElements,
  ResolvedCustomValidation,
  getStandardFieldError,
  loadPhoneValidator,
  phoneLibPromise
} from '../validation';
import { fieldValues } from '../init';
import { featheryDoc } from '../browser';

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

  describe('validateElements matrix inline storage', () => {
    const matrixServar = (repeated: boolean) => ({
      key: 'matrix',
      type: 'matrix',
      required: true,
      repeated,
      metadata: { questions: [{ id: 'q0' }, { id: 'q1' }] }
    });
    const run = (step: any, visiblePositions: any) =>
      validateElements({
        step,
        visiblePositions,
        triggerErrors: true,
        errorType: 'inline',
        formRef: { current: null } as any,
        setInlineErrors: jest.fn()
      });

    it('stores a non-repeat matrix error under the real servar key (not the question-suffixed key)', () => {
      Object.assign(fieldValues, { matrix: {} });
      const field = {
        servar: matrixServar(false),
        position: [0],
        validations: []
      };
      const step = { servar_fields: [field], buttons: [], subgrids: [] };

      const { inlineErrors } = run(step, { '0': [true] }) as any;

      // Renderer reads inlineErrors[servar.key], so it must live under 'matrix'.
      expect(inlineErrors.matrix?.message).toBe('This is a required field');
      // Must NOT be stored under the HTML5 question-suffixed key.
      expect(inlineErrors['matrix-0']).toBeUndefined();
    });

    it('stores repeated matrix errors per row under the real servar key', () => {
      Object.assign(fieldValues, { matrix: [{}, {}] });
      const field = {
        servar: matrixServar(true),
        position: [0, 1],
        validations: []
      };
      const step = {
        servar_fields: [field],
        buttons: [],
        subgrids: [{ position: [0], repeated: true, id: 'sg' }]
      };

      const { inlineErrors } = run(step, { '0,1': [true, true] }) as any;

      expect(inlineErrors.matrix?.byIndex?.[0]?.message).toBe(
        'This is a required field'
      );
      expect(inlineErrors.matrix?.byIndex?.[1]?.message).toBe(
        'This is a required field'
      );
      expect(inlineErrors['matrix-0']).toBeUndefined();
    });

    it('still targets the unanswered question control in html5 mode', () => {
      // Positive case guarding the `errorType === 'html5'` condition: native
      // browser validation must land on the question-suffixed DOM control.
      // This jsdom build doesn't define the RadioNodeList global that the
      // html5 branch instanceof-checks; a stub (never matched, so the single
      // element path is taken) is enough here.
      (global as any).RadioNodeList ??= class RadioNodeList {};
      Object.assign(fieldValues, { matrix: {} });
      const doc = featheryDoc();
      const form = doc.createElement('form');
      const questionInput = doc.createElement('input');
      questionInput.name = 'matrix-0';
      form.appendChild(questionInput);
      doc.body.appendChild(form);

      const field = {
        servar: matrixServar(false),
        position: [0],
        validations: []
      };
      const step = { servar_fields: [field], buttons: [], subgrids: [] };

      const { invalid } = validateElements({
        step,
        visiblePositions: { '0': [true] },
        triggerErrors: true,
        errorType: 'html5',
        formRef: { current: form } as any,
        setInlineErrors: jest.fn()
      });

      expect(questionInput.validationMessage).toBe('This is a required field');
      expect(invalid).toBe(true);
      form.remove();
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

    describe('audio_recording validation', () => {
      it('detects null as empty', () => {
        // Arrange
        const val = null;
        const servar = { required: true, type: 'audio_recording' };
        const expected = 'This is a required field';

        // Act
        const actual = getStandardFieldError(val, servar, null);

        // Assert
        expect(actual).toEqual(expected);
      });

      it('allows valid audio file Promise', () => {
        // Arrange
        const val = Promise.resolve(new File(['content'], 'audio.webm'));
        const servar = { required: true, type: 'audio_recording' };

        // Act
        const actual = getStandardFieldError(val, servar, null);

        // Assert
        expect(actual).toEqual('');
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
