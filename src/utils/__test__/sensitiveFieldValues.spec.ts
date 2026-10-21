import { isMaskedValue, maskFieldValue } from '../sensitiveFieldValues';

describe('maskFieldValue', () => {
  it.each([
    ['pin_input', '4242', '••••'],
    ['ssn', '12', '••'],
    ['password', '', ''],
    ['ssn', '123456789', '••••6789'],
    ['password', 'hunter22', '••••'],
    ['pin_input', '482915', '••••'],
    ['text_field', '4242', '4242']
  ])('masks %s value %j as %j', (type, value, expected) => {
    expect(maskFieldValue(type, value)).toBe(expected);
  });

  it.each([[null], [undefined]])('passes %s through unchanged', (value) => {
    expect(maskFieldValue('ssn', value)).toBe(value);
  });

  it('masks each row of a repeated field', () => {
    expect(maskFieldValue('ssn', ['123456789', null])).toEqual([
      '••••6789',
      null
    ]);
  });

  it('leaves a value with no field type unchanged', () => {
    expect(maskFieldValue(undefined, '123456789')).toBe('123456789');
  });
});

describe('isMaskedValue', () => {
  it.each(['••••', '••', '••••6789'])('recognizes %j as masked', (value) => {
    expect(isMaskedValue(value)).toBe(true);
  });

  it.each(['123456789', '• first item', '•••••6789', ''])(
    'treats %j as a real value',
    (value) => {
      expect(isMaskedValue(value)).toBe(false);
    }
  );
});
