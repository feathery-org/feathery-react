import { isSameFieldValue } from '../fieldValueEquality';

describe('isSameFieldValue', () => {
  it('treats identical primitives as the same', () => {
    expect(isSameFieldValue('a', 'a')).toBe(true);
    expect(isSameFieldValue(5, 5)).toBe(true);
    expect(isSameFieldValue(null, null)).toBe(true);
    expect(isSameFieldValue(true, true)).toBe(true);
  });

  it('treats differing primitives as changed', () => {
    expect(isSameFieldValue('a', 'b')).toBe(false);
    expect(isSameFieldValue(5, '5')).toBe(false);
    expect(isSameFieldValue(null, '')).toBe(false);
    expect(isSameFieldValue(null, undefined)).toBe(false);
    expect(isSameFieldValue(0, false)).toBe(false);
  });

  it('compares repeated field arrays element-wise', () => {
    expect(isSameFieldValue(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(isSameFieldValue(['a', 'b'], ['a', 'c'])).toBe(false);
    expect(isSameFieldValue(['a'], ['a', 'b'])).toBe(false);
    expect(isSameFieldValue([], [])).toBe(true);
    expect(isSameFieldValue(['a'], 'a')).toBe(false);
  });

  it('does not treat holes in a sparse array as matching values', () => {
    const sparse = ['a'];
    sparse[2] = 'c';
    expect(isSameFieldValue(sparse, ['a', 'b', 'c'])).toBe(false);
    expect(isSameFieldValue(['a', 'b', 'c'], sparse)).toBe(false);
  });

  it('compares plain objects by their keys', () => {
    expect(isSameFieldValue({ a: 1, b: [2] }, { a: 1, b: [2] })).toBe(true);
    expect(isSameFieldValue({ a: 1 }, { a: 2 })).toBe(false);
    expect(isSameFieldValue({ a: 1 }, { a: 1, b: 1 })).toBe(false);
    expect(isSameFieldValue({ a: 1, b: 1 }, { a: 1 })).toBe(false);
    expect(isSameFieldValue({}, [])).toBe(false);
  });

  it('only treats files and promises as the same by reference', () => {
    const file = new File(['x'], 'x.txt');
    const promise = Promise.resolve(file);
    expect(isSameFieldValue(promise, promise)).toBe(true);
    expect(isSameFieldValue(promise, Promise.resolve(file))).toBe(false);
    expect(isSameFieldValue(file, new File(['x'], 'x.txt'))).toBe(false);
    expect(isSameFieldValue([promise], [promise])).toBe(true);
  });
});
