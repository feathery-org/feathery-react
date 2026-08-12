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

  it('substitutes the built-in user id token', () => {
    expect(replaceTextVariables('id: {{feathery_user_id}}')).toBe('id: user-1');
  });

  it('returns empty for empty text', () => {
    expect(replaceTextVariables('')).toBe('');
  });
});
