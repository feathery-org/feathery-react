import {
  init,
  initInfo,
  initState,
  registerTextVariableFormats
} from '../init';

describe('init', () => {
  describe('init', () => {
    it('initializes with API and user keys', () => {
      // Arrange
      const sdkKey = 'sdkKey';
      const userId = 'userId';
      const expected = { sdkKey, userId };

      // Act
      init(sdkKey, { userId: userId });
      const actual = initInfo();

      // Assert
      expect(actual).toMatchObject(expected);
    });
  });

  describe('registerTextVariableFormats', () => {
    const numberField = (key: string, metadata: any) => ({
      servar: { key, type: 'integer_field', format: 'currency', metadata }
    });
    const schema = (servar_fields: any[]) => ({
      steps: { s1: { servar_fields } }
    });

    beforeEach(() => {
      initState.textVariableFormats = {};
    });

    it('registers a field that opted in', () => {
      registerTextVariableFormats(
        schema([numberField('amount', { show_format_in_text: true })])
      );
      expect(initState.textVariableFormats.amount).toMatchObject({
        format: 'currency'
      });
    });

    it('skips a field that did not, which is every pre-existing field', () => {
      registerTextVariableFormats(schema([numberField('amount', {})]));
      expect(initState.textVariableFormats).toEqual({});
    });

    it('skips non-number fields even with the flag set', () => {
      registerTextVariableFormats(
        schema([
          {
            servar: {
              key: 'name',
              type: 'text_field',
              metadata: { show_format_in_text: true }
            }
          }
        ])
      );
      expect(initState.textVariableFormats).toEqual({});
    });

    it('releases a key when a later load has the option turned off', () => {
      registerTextVariableFormats(
        schema([numberField('amount', { show_format_in_text: true })])
      );
      registerTextVariableFormats(schema([numberField('amount', {})]));
      expect(initState.textVariableFormats).toEqual({});
    });

    it('walks every step', () => {
      registerTextVariableFormats({
        steps: {
          s1: {
            servar_fields: [numberField('a', { show_format_in_text: true })]
          },
          s2: {
            servar_fields: [numberField('b', { show_format_in_text: true })]
          }
        }
      });
      expect(Object.keys(initState.textVariableFormats).sort()).toEqual([
        'a',
        'b'
      ]);
    });

    it('accepts steps as an array, which is the form-off shape', () => {
      registerTextVariableFormats({
        steps: [
          { servar_fields: [numberField('a', { show_format_in_text: true })] }
        ]
      });
      expect(Object.keys(initState.textVariableFormats)).toEqual(['a']);
    });

    it.each([
      ['no schema', undefined],
      ['no steps', {}],
      ['a step with no fields', { steps: { s1: {} } }],
      ['a field with no servar', { steps: { s1: { servar_fields: [{}] } } }]
    ])('tolerates %s', (_label, input) => {
      expect(() => registerTextVariableFormats(input)).not.toThrow();
      expect(initState.textVariableFormats).toEqual({});
    });
  });
});
