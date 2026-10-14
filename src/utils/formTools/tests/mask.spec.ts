import { maskFieldValue } from '../mask';

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
});
