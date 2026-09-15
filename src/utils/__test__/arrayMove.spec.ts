/**
 * arrayMove backs every repeat row reorder. Its identity-equal return on a
 * no-op is load-bearing: moveRepeatRowValue uses it to tell "nothing moved"
 * from "moved to the same place", and returns the caller's original array
 * untouched in the first case rather than a padded rebuild of it.
 */
import { arrayMove } from '../array';

describe('arrayMove', () => {
  it('moves an entry forward', () => {
    expect(arrayMove(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves an entry backward', () => {
    expect(arrayMove(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves to the last slot', () => {
    expect(arrayMove(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('does not mutate the input', () => {
    const input = ['a', 'b', 'c'];
    arrayMove(input, 0, 2);
    expect(input).toEqual(['a', 'b', 'c']);
  });

  it('returns the input itself when nothing moves', () => {
    const input = ['a', 'b', 'c'];
    expect(arrayMove(input, 1, 1)).toBe(input);
  });

  it('returns the input itself when an index is out of range', () => {
    const input = ['a', 'b', 'c'];
    expect(arrayMove(input, -1, 1)).toBe(input);
    expect(arrayMove(input, 0, 3)).toBe(input);
    expect(arrayMove(input, 3, 0)).toBe(input);
  });

  it('returns the input itself for an empty list', () => {
    const input: string[] = [];
    expect(arrayMove(input, 0, 0)).toBe(input);
  });
});
