import {
  insertRowKey,
  makeRowKeyMinter,
  reconcileRowKeys,
  removeRowKey
} from '../rowKeys';

const minter = () => makeRowKeyMinter('t1');

describe('reconcileRowKeys', () => {
  test('mints a key for every row of a table it has not seen before', () => {
    const keys = reconcileRowKeys([], 3, minter());
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
  });

  test('is idempotent: reconciling an unchanged table keeps every key', () => {
    const mint = minter();
    const first = reconcileRowKeys([], 3, mint);
    const second = reconcileRowKeys(first, 3, mint);
    expect(second).toEqual(first);
  });

  test('rows appended outside a tracked mutation get fresh keys at the end', () => {
    const mint = minter();
    const before = reconcileRowKeys([], 2, mint);
    const after = reconcileRowKeys(before, 4, mint);
    expect(after.slice(0, 2)).toEqual(before);
    expect(new Set(after).size).toBe(4);
  });

  test('rows lost outside a tracked mutation drop their keys from the end', () => {
    const mint = minter();
    const before = reconcileRowKeys([], 4, mint);
    const after = reconcileRowKeys(before, 2, mint);
    expect(after).toEqual(before.slice(0, 2));
  });

  test('a key is never reused after the row holding it is gone', () => {
    const mint = minter();
    const before = reconcileRowKeys([], 3, mint);
    const shrunk = reconcileRowKeys(before, 1, mint);
    const regrown = reconcileRowKeys(shrunk, 3, mint);
    expect(regrown.slice(1)).not.toEqual(expect.arrayContaining(before.slice(1)));
  });

  test('does not mutate the array it is given', () => {
    const mint = minter();
    const before = reconcileRowKeys([], 2, mint);
    const snapshot = [...before];
    reconcileRowKeys(before, 5, mint);
    expect(before).toEqual(snapshot);
  });
});

describe('insertRowKey', () => {
  test('a row inserted above keeps every key below it on the same row', () => {
    const mint = minter();
    const before = reconcileRowKeys([], 3, mint);
    const after = insertRowKey(before, 0, mint);
    expect(after).toHaveLength(4);
    expect(after.slice(1)).toEqual(before);
    // The row that was at index 1 is now at index 2, still under its own key.
    expect(after.indexOf(before[1])).toBe(2);
  });

  test('clamps an index past the end to appending', () => {
    const mint = minter();
    const before = reconcileRowKeys([], 2, mint);
    const after = insertRowKey(before, 99, mint);
    expect(after.slice(0, 2)).toEqual(before);
    expect(after).toHaveLength(3);
  });
});

describe('removeRowKey', () => {
  test('drops that row and closes the gap', () => {
    const mint = minter();
    const before = reconcileRowKeys([], 3, mint);
    const after = removeRowKey(before, 1);
    expect(after).toEqual([before[0], before[2]]);
  });

  test('an index the table does not have leaves the keys alone', () => {
    const mint = minter();
    const before = reconcileRowKeys([], 2, mint);
    expect(removeRowKey(before, 7)).toEqual(before);
  });
});

describe('makeRowKeyMinter', () => {
  test('keys are unique across tables, so one table cannot resolve another one', () => {
    const a = reconcileRowKeys([], 2, makeRowKeyMinter('t1'));
    const b = reconcileRowKeys([], 2, makeRowKeyMinter('t2'));
    expect(a.filter((key) => b.includes(key))).toEqual([]);
  });
});
