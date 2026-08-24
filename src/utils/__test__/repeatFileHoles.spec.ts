/**
 * Reproduction for the repeatable file_upload index-collapse bug.
 *
 * A repeatable file field must be able to leave an individual index empty.
 * Today every empty slot is compacted away before the value reaches the wire,
 * so a file uploaded at repeat index 3 arrives at the backend as index 0 and
 * desyncs from every sibling repeatable field on the same form.
 */
import { justInsert } from '../array';
import {
  getDefaultFieldValue,
  normalizeRepeatArrayValue,
  stripEmptyRepeatEntries
} from '../fieldHelperFunctions';
import { getServarRepeatNum } from '../repeat';

const fileField = {
  servar: { key: 'my_files', type: 'file_upload', repeated: true, metadata: {} }
};

const setValueFileField = {
  servar: {
    key: 'my_files',
    type: 'file_upload',
    repeated: true,
    repeat_trigger: 'set_value',
    metadata: {}
  }
};

describe('repeatable file_upload empty indices', () => {
  const file = Promise.resolve(new Blob(['x']));

  it('justInsert pads intermediate holes with null', () => {
    const stored = justInsert([], file, 3, fileField);
    expect(stored).toHaveLength(4);
    expect(stored.slice(0, 3)).toEqual([null, null, null]);
    expect(getDefaultFieldValue(fileField)).toBeNull();
  });

  it('updateFieldValues must not rewrite file holes to empty string', () => {
    const stored = justInsert([], file, 3, fileField);
    expect(
      normalizeRepeatArrayValue(stored, 'file_upload').slice(0, 3)
    ).toEqual([null, null, null]);
    // A text repeat still shows '' rather than 'null' for a cleared row.
    expect(normalizeRepeatArrayValue([null, 'a'], 'text_field')).toEqual([
      '',
      'a'
    ]);
  });

  it('submitStep must not compact file holes out of the array', () => {
    const stored = justInsert([], file, 3, fileField);
    expect(stripEmptyRepeatEntries(stored, 'file_upload')).toHaveLength(4);
    // Non-file repeats keep compacting, as before.
    expect(stripEmptyRepeatEntries([null, 'a'], 'text_field')).toEqual(['a']);
  });

  it('getServarRepeatNum does not add a phantom trailing row', () => {
    // Trailing hole stored as null: the row count is already right, so the
    // set_value trigger must not append another empty row.
    expect(getServarRepeatNum(setValueFileField, [file, null])).toBe(2);
    // Trailing hole stored as '' (today's shape): '' !== null, so the last row
    // reads as "filled" and a phantom row is appended.
    expect(getServarRepeatNum(setValueFileField, [file, ''])).toBe(2);
  });
});
