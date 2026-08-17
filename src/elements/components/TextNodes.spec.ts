import { replaceTextVariables } from './TextNodes';
import { fieldValues, initState } from '../../utils/init';

const setFieldValues = (values: Record<string, any>) => {
  Object.keys(fieldValues).forEach((key) => delete fieldValues[key]);
  Object.assign(fieldValues, values);
};

describe('replaceTextVariables', () => {
  beforeEach(() => {
    setFieldValues({});
    initState.knownFieldKeys.clear();
    initState.textVariableFormats = {};
    initState.sdkKey = 'test-sdk-key';
    initState.userId = 'user-1';
  });

  describe('known fields', () => {
    beforeEach(() => initState.knownFieldKeys.add('f'));

    it('substitutes a filled value', () => {
      setFieldValues({ f: 1 });
      expect(replaceTextVariables('hello: {{f}}')).toBe('hello: 1');
    });

    it.each([
      ['empty string', ''],
      ['null', null],
      ['undefined', undefined],
      ['empty array', []]
    ])('renders empty for %s', (_label, value) => {
      setFieldValues({ f: value });
      expect(replaceTextVariables('hello: {{f}}')).toBe('hello: ');
    });

    it('renders empty when the field has no value at all', () => {
      // Hidden fields the user never filled are absent from fieldValues
      expect(replaceTextVariables('hello: {{f}}')).toBe('hello: ');
    });
  });

  describe('unknown fields', () => {
    it('leaves the token literal so authors see the name they typed', () => {
      expect(replaceTextVariables('hello: {{nope}}')).toBe('hello: {{nope}}');
    });

    it('does not trim whitespace inside the braces', () => {
      setFieldValues({ f: 'val' });
      initState.knownFieldKeys.add('f');
      expect(replaceTextVariables('{{ f }}')).toBe('{{ f }}');
    });

    it('resolves each token independently', () => {
      initState.knownFieldKeys.add('empty');
      setFieldValues({ filled: 'x' });
      initState.knownFieldKeys.add('filled');
      expect(replaceTextVariables('{{filled}}|{{empty}}|{{nope}}')).toBe(
        'x||{{nope}}'
      );
    });
  });

  describe('array values', () => {
    beforeEach(() => {
      initState.knownFieldKeys.add('f');
      setFieldValues({ f: ['a', 'b'] });
    });

    it('joins every entry outside a repeat', () => {
      expect(replaceTextVariables('{{f}}')).toBe('a, b');
    });

    it('picks the entry at the repeat index', () => {
      expect(replaceTextVariables('{{f}}', 1)).toBe('b');
    });

    it('falls back to the first entry past the end of the array', () => {
      expect(replaceTextVariables('{{f}}', 5)).toBe('a');
    });
  });

  describe('number fields showing their format', () => {
    const registerFormatted = (key: string, servar: any = {}) => {
      initState.knownFieldKeys.add(key);
      initState.textVariableFormats[key] = {
        type: 'integer_field',
        format: 'currency',
        metadata: {},
        ...servar
      };
    };

    it('renders the value with its units', () => {
      // No trailing zero, because pad_decimals defaults off — the same value
      // the field's own input shows.
      registerFormatted('amount');
      setFieldValues({ amount: 1234.5 });
      expect(replaceTextVariables('total: {{amount}}')).toBe('total: $1,234.5');
    });

    it('pads to the field precision when the field does', () => {
      registerFormatted('amount', { metadata: { pad_decimals: true } });
      setFieldValues({ amount: 1234.5 });
      expect(replaceTextVariables('total: {{amount}}')).toBe(
        'total: $1,234.50'
      );
    });

    it('leaves an unregistered field raw, which is the default', () => {
      // The opt-in contract. A number field that never enables the option is
      // absent from the registry and must interpolate exactly as before.
      initState.knownFieldKeys.add('amount');
      setFieldValues({ amount: 1234.5 });
      expect(replaceTextVariables('total: {{amount}}')).toBe('total: 1234.5');
    });

    it('renders empty for an unfilled field rather than a bare symbol', () => {
      registerFormatted('amount');
      expect(replaceTextVariables('total: {{amount}}')).toBe('total: ');
    });

    it('formats every entry of a repeating field', () => {
      registerFormatted('amount');
      setFieldValues({ amount: [1234.5, 6] });
      expect(replaceTextVariables('{{amount}}')).toBe('$1,234.5, $6');
    });

    it('formats the entry at the repeat index', () => {
      registerFormatted('amount');
      setFieldValues({ amount: [1234.5, 6] });
      expect(replaceTextVariables('{{amount}}', 1)).toBe('$6');
    });

    it('formats only the fields that opted in', () => {
      registerFormatted('amount');
      initState.knownFieldKeys.add('plain');
      setFieldValues({ amount: 1234.5, plain: 1234.5 });
      expect(replaceTextVariables('{{amount}} vs {{plain}}')).toBe(
        '$1,234.5 vs 1234.5'
      );
    });

    it('honors the field precision and affixes', () => {
      registerFormatted('rate', {
        format: 'percentage',
        metadata: { decimal_places: 1, pad_decimals: true }
      });
      setFieldValues({ rate: 7 });
      expect(replaceTextVariables('{{rate}}')).toBe('7.0%');
    });
  });

  it('substitutes the built-in user id token', () => {
    expect(replaceTextVariables('id: {{feathery_user_id}}')).toBe('id: user-1');
  });

  it('returns empty for empty text', () => {
    expect(replaceTextVariables('')).toBe('');
  });
});
