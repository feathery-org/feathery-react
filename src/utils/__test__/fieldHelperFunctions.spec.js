import {
  formatAllFormFields,
  formatStepFields,
  getDefaultFieldValue,
  getDefaultFormFieldValue,
  saveInitialValuesAndUrlParams
} from '../fieldHelperFunctions';
import { featheryWindow } from '../browser';
import { fieldValues } from '../init';
import { normalizeAsciiValue } from '../ascii';

jest.mock('../init');

describe('fieldHelperFunctions', () => {
  describe('getDefaultFieldValue', () => {
    const arrayField = (type, metadata, servarExtras = {}) => ({
      servar: { key: 'key1', type, metadata, ...servarExtras }
    });

    it.each([
      ['text_field', { default_value: 'São Paulo' }, 'Sao Paulo'],
      ['gmap_state', { default_state: 'Pará' }, 'Para'],
      ['dropdown_multi', { default_value: 'Pará, Ceará' }, ['Para', 'Ceara']]
    ])(
      'keeps %s reset defaults equal to normalized repeated values',
      (type, metadata, expected) => {
        const field = arrayField(type, metadata, { repeated: true });
        const originalMetadata = { ...metadata };
        const originalDefault = getDefaultFieldValue(field);
        const storedValue = normalizeAsciiValue(
          getDefaultFormFieldValue(field)
        );

        expect(getDefaultFieldValue(field, true)).toEqual(expected);
        expect(getDefaultFieldValue(field, true)).toEqual(storedValue[0]);
        expect(getDefaultFormFieldValue(field, true)).toEqual(storedValue);
        expect(getDefaultFieldValue(field)).toEqual(originalDefault);
        expect(field.servar.metadata).toEqual(originalMetadata);
      }
    );

    it('preserves password and file defaults when ASCII conversion is enabled', () => {
      const password = arrayField('password', { default_value: 'sëcret' });
      const file = arrayField('file_upload', {});
      expect(getDefaultFieldValue(password, true)).toBe('sëcret');
      expect(getDefaultFormFieldValue(file, true)).toEqual([]);
    });

    it('splits a comma-separated dropdown_multi default into every entry', () => {
      const actual = getDefaultFieldValue(
        arrayField('dropdown_multi', { default_value: 'a, b, c' })
      );

      expect(actual).toEqual(['a', 'b', 'c']);
    });

    it('clamps a dropdown_multi default to one entry at max_length 1', () => {
      const actual = getDefaultFieldValue(
        arrayField(
          'dropdown_multi',
          { default_value: 'a, b, c' },
          { max_length: 1 }
        )
      );

      expect(actual).toEqual(['a']);
    });

    it('clamps a dropdown_multi default when max_length is the string "1"', () => {
      const actual = getDefaultFieldValue(
        arrayField(
          'dropdown_multi',
          { default_value: 'a, b, c' },
          { max_length: '1' }
        )
      );

      expect(actual).toEqual(['a']);
    });

    it('does not clamp a dropdown_multi default above max_length 1', () => {
      const actual = getDefaultFieldValue(
        arrayField(
          'dropdown_multi',
          { default_value: 'a, b, c' },
          { max_length: 2 }
        )
      );

      expect(actual).toEqual(['a', 'b', 'c']);
    });

    it('leaves other array field types unclamped at max_length 1', () => {
      const actual = getDefaultFieldValue(
        arrayField('multiselect', { default_value: 'a, b' }, { max_length: 1 })
      );

      expect(actual).toEqual(['a', 'b']);
    });

    it('keeps the button_group single-selection carve-out', () => {
      const actual = getDefaultFieldValue(
        arrayField('button_group', { default_value: 'a, b', multiple: false })
      );

      expect(actual).toEqual(['a, b']);
    });
  });

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

  describe('saveInitialValuesAndUrlParams', () => {
    const saveParams = (search) => {
      featheryWindow().history.replaceState({}, '', `/to/form${search}`);
      const updateFieldValues = jest.fn();
      const client = { submitCustom: jest.fn() };

      saveInitialValuesAndUrlParams({
        updateFieldValues,
        client,
        saveUrlParams: true,
        initialValues: {},
        steps: null,
        hiddenFields: {}
      });

      return updateFieldValues.mock.calls[0]?.[0] ?? {};
    };

    it('submits ordinary url params as field values', () => {
      expect(saveParams('?utm_source=email')).toEqual({
        utm_source: 'email'
      });
    });

    it('never submits the access link token, which is a credential', () => {
      expect(saveParams('?_lt=tok&utm_source=email')).toEqual({
        utm_source: 'email'
      });
    });
  });
});
