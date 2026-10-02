import { entryIdsShifted } from '../useHubTableSource';

describe('entryIdsShifted', () => {
  test('entries a resync puts above the known rows shift every index', () => {
    expect(entryIdsShifted(['a', 'b'], ['new', 'a', 'b'])).toBe(true);
  });

  test('an entry deleted elsewhere shifts the rows after it', () => {
    expect(entryIdsShifted(['a', 'b', 'c'], ['a', 'c'])).toBe(true);
  });

  test('the same rows, a provisional row saved, or rows dropped off the end move nothing', () => {
    expect(entryIdsShifted(['a', 'b'], ['a', 'b'])).toBe(false);
    expect(entryIdsShifted([null, 'a'], ['x', 'a'])).toBe(false);
    expect(entryIdsShifted(['a', 'b'], ['a'])).toBe(false);
  });
});
