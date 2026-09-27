import { init, initInfo, initState, registerTextVariableFields } from '../init';
import { clearOptionLabels, getOptionLabel } from '../optionLabels';

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

  describe('registerTextVariableFields', () => {
    const numberField = (key: string, metadata: any) => ({
      servar: { key, type: 'integer_field', format: 'currency', metadata }
    });
    const optionField = (key: string, metadata: any, properties?: any) => ({
      servar: { key, type: 'dropdown', metadata },
      properties
    });
    const schema = (fields: any[]) => ({
      steps: { s1: { servar_fields: fields } }
    });

    beforeEach(() => {
      initState.textVariableFormats = {};
      clearOptionLabels();
    });

    describe('number formats', () => {
      it('registers a field that opted in', () => {
        registerTextVariableFields(
          schema([numberField('amount', { show_format_in_text: true })])
        );
        expect(initState.textVariableFormats.amount).toMatchObject({
          format: 'currency'
        });
      });

      it('skips a field that did not, which is every pre-existing field', () => {
        registerTextVariableFields(schema([numberField('amount', {})]));
        expect(initState.textVariableFormats).toEqual({});
      });

      it('skips non-number fields even with the flag set', () => {
        registerTextVariableFields(
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
        registerTextVariableFields(
          schema([numberField('amount', { show_format_in_text: true })])
        );
        registerTextVariableFields(schema([numberField('amount', {})]));
        expect(initState.textVariableFormats).toEqual({});
      });

      it('walks every step', () => {
        registerTextVariableFields({
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
        registerTextVariableFields({
          steps: [
            { servar_fields: [numberField('a', { show_format_in_text: true })] }
          ]
        });
        expect(Object.keys(initState.textVariableFormats)).toEqual(['a']);
      });
    });

    describe('option labels', () => {
      it('registers the labels an option field renders its values as', () => {
        registerTextVariableFields(
          schema([
            optionField('plan', {
              options: ['pro'],
              option_labels: ['Professional']
            })
          ])
        );
        expect(getOptionLabel('plan', 'pro')).toBe('Professional');
      });

      it('registers an option field the number branch returns early on', () => {
        registerTextVariableFields(
          schema([
            optionField('plan', {
              options: ['pro'],
              option_labels: ['Professional']
            }),
            numberField('amount', { show_format_in_text: true })
          ])
        );
        expect(getOptionLabel('plan', 'pro')).toBe('Professional');
        expect(initState.textVariableFormats.amount).toMatchObject({
          format: 'currency'
        });
      });

      it('releases a key when a later load has the labels cleared', () => {
        registerTextVariableFields(
          schema([
            optionField('plan', {
              options: ['pro'],
              option_labels: ['Professional']
            })
          ])
        );
        registerTextVariableFields(
          schema([optionField('plan', { options: ['pro'], option_labels: [] })])
        );
        expect(getOptionLabel('plan', 'pro')).toBeUndefined();
      });

      it('walks every step', () => {
        registerTextVariableFields({
          steps: {
            s1: {
              servar_fields: [
                optionField('a', { options: ['1'], option_labels: ['One'] })
              ]
            },
            s2: {
              servar_fields: [
                optionField('b', { options: ['2'], option_labels: ['Two'] })
              ]
            }
          }
        });
        expect(getOptionLabel('a', '1')).toBe('One');
        expect(getOptionLabel('b', '2')).toBe('Two');
      });

      it('leaves a field whose type carries no options unregistered', () => {
        registerTextVariableFields(
          schema([
            { servar: { key: 'name', type: 'text_field', metadata: {} } }
          ])
        );
        expect(getOptionLabel('name', 'anything')).toBeUndefined();
      });

      // The country name comes from the country list rather than the servar,
      // and the element properties that override it live beside the servar on
      // the field, so this is the one path that needs both halves passed on.
      it('registers a country field off its element translations', () => {
        registerTextVariableFields(
          schema([
            {
              servar: {
                key: 'country',
                type: 'gmap_country',
                metadata: { store_abbreviation: true }
              },
              properties: { translate: { US: 'Estados Unidos' } }
            }
          ])
        );
        expect(getOptionLabel('country', 'US')).toBe('Estados Unidos');
        expect(getOptionLabel('country', 'CA')).toBe('Canada');
      });

      it('labels each selection of a multiselect value rather than the array as a whole', () => {
        registerTextVariableFields(
          schema([
            {
              servar: {
                key: 'colors',
                type: 'multiselect',
                metadata: {
                  options: ['r', 'g', 'b'],
                  option_labels: ['Red', 'Green', 'Blue']
                }
              }
            }
          ])
        );
        expect(getOptionLabel('colors', ['r', 'b'])).toBe('Red,Blue');
      });

      it('falls back to the raw value for selections without a label', () => {
        registerTextVariableFields(
          schema([
            {
              servar: {
                key: 'colors',
                type: 'multiselect',
                metadata: {
                  options: ['r', 'g'],
                  option_labels: ['Red', 'Green']
                }
              }
            }
          ])
        );
        expect(getOptionLabel('colors', ['r', 'purple'])).toBe('Red,purple');
      });
    });

    it.each([
      ['no schema', undefined],
      ['no steps', {}],
      ['a step with no fields', { steps: { s1: {} } }],
      ['a field with no servar', { steps: { s1: { servar_fields: [{}] } } }],
      [
        'a field with no properties',
        {
          steps: {
            s1: {
              servar_fields: [
                { servar: { key: 'country', type: 'gmap_country' } }
              ]
            }
          }
        }
      ]
    ])('tolerates %s', (_label, input) => {
      expect(() => registerTextVariableFields(input)).not.toThrow();
      expect(initState.textVariableFormats).toEqual({});
    });
  });
});
