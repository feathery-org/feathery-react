import {
  validateElement,
  validateElements,
  storeAlignedSliderValues,
  ResolvedCustomValidation,
  getStandardFieldError,
  loadPhoneValidator,
  phoneLibPromise
} from '../validation';
import { fieldValues } from '../init';
import { getSliderRange } from '../valueBounds';
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
      pin_input: 'Please enter a full code',
      minimum_value: 'Your entry must be at least {value}',
      maximum_value: 'Your entry must be at most {value}'
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

      const { invalid, inlineErrors } = validateElements({
        step,
        visiblePositions: { '0': [true] },
        triggerErrors: true,
        errorType: 'html5',
        formRef: { current: form } as any,
        setInlineErrors: jest.fn()
      });

      expect(inlineErrors.matrix?.message).toBe('This is a required field');
      expect(inlineErrors['matrix-0']).toBeUndefined();
      expect(questionInput.validationMessage).toBe('This is a required field');
      expect(invalid).toBe(true);
      form.remove();
    });
  });

  describe('slider linked bounds', () => {
    const slider = (key: string, metadata: any, overrides = {}) => ({
      servar: {
        key,
        type: 'slider',
        required: false,
        repeated: false,
        metadata,
        ...overrides
      },
      validations: []
    });
    const numberField = (key: string, metadata: any) => ({
      servar: {
        key,
        type: 'integer_field',
        required: false,
        repeated: false,
        metadata
      },
      validations: []
    });
    const stepOf = (fields: any[]) => ({
      servar_fields: fields.map((field, i) => ({ ...field, position: [i] })),
      buttons: [],
      subgrids: []
    });
    const visibleOf = (fields: any[]) =>
      Object.fromEntries(fields.map((_, i) => [String(i), [true]]));
    const run = (fields: any[]) =>
      validateElements({
        step: stepOf(fields),
        visiblePositions: visibleOf(fields),
        triggerErrors: false,
        errorType: 'inline',
        formRef: { current: null } as any,
        setInlineErrors: jest.fn()
      });
    const store = (fields: any[]) =>
      storeAlignedSliderValues(stepOf(fields), visibleOf(fields));
    // One repeated slider whose container shows `rows` rows
    const storeRows = (field: any, rows = 2) =>
      storeAlignedSliderValues(
        {
          servar_fields: [{ ...field, position: [0, 1] }],
          buttons: [],
          subgrids: [{ position: [0], repeated: true, id: 'sg' }]
        },
        { '0,1': Array(rows).fill(true) }
      );

    // The slider can't show a value past its range, so submit stores what it shows
    it.each([
      ['below the min', 5, 10],
      ['above the max', 150, 100],
      ['inside the bounds', 50, 50]
    ])(
      'stores a value %s within the range',
      (_: string, value: number, stored: number) => {
        Object.assign(fieldValues, { floor: 10, limit: 100, amount: value });
        store([
          slider('amount', {
            min_value_field_key: 'floor',
            max_value_field_key: 'limit'
          })
        ]);
        expect(fieldValues.amount).toEqual(stored);
      }
    );

    // A blocked submit puts back the answers it replaced, but keeps any a
    // submit rule changed since
    it('restores the answers it replaced', () => {
      Object.assign(fieldValues, { limit: 60, amount: 80, total: 90 });
      const fields = [
        slider('amount', { max_value_field_key: 'limit' }),
        slider('total', { max_value_field_key: 'limit' })
      ];
      const { restore } = store(fields);
      expect([fieldValues.amount, fieldValues.total]).toEqual([60, 60]);
      fieldValues.total = 70;
      restore();
      expect([fieldValues.amount, fieldValues.total]).toEqual([80, 70]);
    });

    // rc-slider snaps the handle to a step from the min, so submit stores that
    it('stores the step the handle snaps to when a linked min moves', () => {
      Object.assign(fieldValues, { floor: 2, amount: 10 });
      store([
        slider(
          'amount',
          { min_value_field_key: 'floor', step_size: 5 },
          { max_length: 100 }
        )
      ]);
      expect(fieldValues.amount).toEqual(12);
    });

    it('clamps each row of a repeated slider', () => {
      Object.assign(fieldValues, { floor: 10, limit: 100, amount: [5, 150] });
      storeRows(
        slider(
          'amount',
          { min_value_field_key: 'floor', max_value_field_key: 'limit' },
          { repeated: true }
        )
      );
      expect(fieldValues.amount).toEqual([10, 100]);
    });

    // Clamping the auto-added default row would turn it into an answer, and the
    // form would add another row for it
    it.each([
      ['after an answered row', [5, 0], [10, 0]],
      ['as the only row', [0], [0]]
    ])(
      "leaves a set_value repeat's default row alone %s",
      (_: string, value: number[], stored: number[]) => {
        Object.assign(fieldValues, { floor: 10, amount: value });
        storeRows(
          slider(
            'amount',
            { min_value_field_key: 'floor' },
            { repeated: true, repeat_trigger: 'set_value' }
          ),
          value.length
        );
        expect(fieldValues.amount).toEqual(stored);
      }
    );

    it('keeps a min above the max as the value', () => {
      Object.assign(fieldValues, { floor: 60, limit: 40, amount: 70 });
      store([
        slider('amount', {
          min_value_field_key: 'floor',
          max_value_field_key: 'limit'
        })
      ]);
      expect(fieldValues.amount).toEqual(60);
    });

    it('leaves fixed bounds alone', () => {
      Object.assign(fieldValues, { amount: 500 });
      store([slider('amount', {}, { max_length: 100 })]);
      expect(fieldValues.amount).toEqual(500);
    });

    it('passes an unlinked fixed range through unchanged', () => {
      const servar = { metadata: {}, min_length: 50, max_length: 20 };
      expect(getSliderRange(servar)).toEqual({ min: 50, max: 20 });
    });

    it('leaves a value alone while its linked fields are empty', () => {
      Object.assign(fieldValues, { floor: '', limit: undefined, amount: 500 });
      store([
        slider(
          'amount',
          { min_value_field_key: 'floor', max_value_field_key: 'limit' },
          { max_length: 100 }
        )
      ]);
      expect(fieldValues.amount).toEqual(500);
    });

    // The range collapses to the fixed min, as the slider renders it
    it('keeps a fixed min above a linked max as the value', () => {
      Object.assign(fieldValues, { limit: 10, amount: 15 });
      store([
        slider('amount', { max_value_field_key: 'limit' }, { min_length: 20 })
      ]);
      expect(fieldValues.amount).toEqual(20);
    });

    // amount=80 is bounded by ceiling, a slider showing 100 but capped at 50
    it.each([
      ['before', true],
      ['after', false]
    ])(
      'validates a field against a slider listed %s it at its clamped value',
      (_: string, numberFirst: boolean) => {
        Object.assign(fieldValues, { cap: 50, ceiling: 100, amount: 80 });
        const amount = numberField('amount', {
          max_value_field_key: 'ceiling'
        });
        const ceiling = slider('ceiling', { max_value_field_key: 'cap' });
        const { invalid, errors } = run(
          numberFirst ? [amount, ceiling] : [ceiling, amount]
        );
        expect(invalid).toBe(true);
        expect(errors.amount).toEqual('Your entry must be at most 50');
        // Validation alone doesn't store the clamped value
        expect(fieldValues.ceiling).toEqual(100);
      }
    );

    // Validation also runs without submitting, e.g. on a failed submit or from
    // validateStep(), so it must leave slider answers alone
    it("doesn't store slider values when only validating", () => {
      Object.assign(fieldValues, { budget: 30, amount: 80 });
      const fields = [
        slider('budget', {}),
        slider('amount', { max_value_field_key: 'budget' })
      ];
      run(fields);
      expect(fieldValues.amount).toEqual(80);
      // Once the source is raised again, submit stores the original answer
      fieldValues.budget = 100;
      store(fields);
      expect(fieldValues.amount).toEqual(80);
    });

    it('settles a slider bounded by another slider listed after it', () => {
      Object.assign(fieldValues, { cap: 50, ceiling: 100, amount: 80 });
      store([
        slider('amount', { max_value_field_key: 'ceiling' }),
        slider('ceiling', { max_value_field_key: 'cap' })
      ]);
      expect(fieldValues.ceiling).toEqual(50);
      expect(fieldValues.amount).toEqual(50);
    });

    // amount=80 has its min set by ceiling, a slider holding 100 but capped at 50.
    // Clamping amount against the unsettled 100 would raise it for good
    it.each([
      ['before', true],
      ['after', false]
    ])(
      'keeps an answer clamped against a slider listed %s it in range',
      (_: string, amountFirst: boolean) => {
        Object.assign(fieldValues, { cap: 50, ceiling: 100, amount: 80 });
        const amount = slider('amount', { min_value_field_key: 'ceiling' });
        const ceiling = slider('ceiling', { max_value_field_key: 'cap' });
        store(amountFirst ? [amount, ceiling] : [ceiling, amount]);
        expect(fieldValues.ceiling).toEqual(50);
        expect(fieldValues.amount).toEqual(80);
      }
    );
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

    describe('integer_field linked bounds', () => {
      const servar = (overrides = {}) => ({
        required: false,
        type: 'integer_field',
        metadata: {
          min_value_field_key: 'floor',
          max_value_field_key: 'limit'
        },
        ...overrides
      });

      const atLeast = (n: number) => `Your entry must be at least ${n}`;
      const atMost = (n: number) => `Your entry must be at most ${n}`;

      it.each([
        ['inside the bounds', 50, ''],
        ['at the min', 9.5, ''],
        ['just above the min', 9.75, ''],
        ['at the max', 100.6, ''],
        ['below the min', 9.4, atLeast(9.5)],
        ['above the max', 100.8, atMost(100.6)],
        ['stored as a string', '101', atMost(100.6)]
      ])(
        'checks a value %s',
        (_: string, value: number | string, error: string) => {
          // Number fields hold decimals, so bounds compare as stored; the max
          // arrives as a string, as text-like stored values do
          Object.assign(fieldValues, { floor: 9.5, limit: '100.6' });
          expect(getStandardFieldError(value, servar(), null)).toEqual(error);
        }
      );

      it('enforces a bound of 0', () => {
        Object.assign(fieldValues, { floor: 0, limit: 0 });
        expect(getStandardFieldError(-1, servar(), null)).toEqual(atLeast(0));
        expect(getStandardFieldError(1, servar(), null)).toEqual(atMost(0));
      });

      // Blank text and booleans must not become 0 or 1, and non-numbers can't
      // bound anything
      it.each([
        [''],
        ['  '],
        [true],
        [false],
        [null],
        [undefined],
        [[5]],
        [{}],
        ['abc'],
        ['Infinity']
      ])('ignores a linked value of %p', (linked: unknown) => {
        Object.assign(fieldValues, { floor: linked, limit: linked });
        expect(getStandardFieldError(-1e9, servar(), null)).toEqual('');
        expect(getStandardFieldError(1e9, servar(), null)).toEqual('');
      });

      it('ignores missing links', () => {
        Object.assign(fieldValues, { floor: 10, limit: 100 });
        expect(
          getStandardFieldError(1e9, servar({ metadata: {} }), null)
        ).toEqual('');
        expect(
          getStandardFieldError(1e9, servar({ metadata: undefined }), null)
        ).toEqual('');
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
