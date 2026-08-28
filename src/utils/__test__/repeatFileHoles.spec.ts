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
  isRepeatedFileField,
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
      normalizeRepeatArrayValue(stored, fileField.servar).slice(0, 3)
    ).toEqual([null, null, null]);
    // A text repeat still shows '' rather than 'null' for a cleared row.
    expect(
      normalizeRepeatArrayValue([null, 'a'], {
        type: 'text_field',
        repeated: true
      })
    ).toEqual(['', 'a']);
  });

  it('leaves an unknown key alone rather than destroying its holes', () => {
    // A key on no step of this form is rendered by nothing, so there is no
    // display to normalize -- and guessing wrong here would collapse a file
    // field's repeat indices.
    const stored = justInsert([], file, 3, fileField);
    expect(normalizeRepeatArrayValue(stored, undefined).slice(0, 3)).toEqual([
      null,
      null,
      null
    ]);
  });

  it('submitStep must not compact file holes out of the array', () => {
    const stored = justInsert([], file, 3, fileField);
    expect(stripEmptyRepeatEntries(stored, fileField.servar)).toHaveLength(4);
    // Non-file repeats keep compacting, as before.
    expect(
      stripEmptyRepeatEntries([null, 'a'], {
        type: 'text_field',
        repeated: true
      })
    ).toEqual(['a']);
  });

  it('only a repeated file field has holes worth keeping', () => {
    expect(isRepeatedFileField(fileField.servar)).toBe(true);
    expect(isRepeatedFileField({ type: 'signature', repeated: true })).toBe(
      true
    );
    // A non-repeated multi-file field is a flat list; its positions mean
    // nothing, so it keeps compacting and sends no repeat indices.
    expect(isRepeatedFileField({ type: 'file_upload', repeated: false })).toBe(
      false
    );
    expect(isRepeatedFileField({ type: 'text_field', repeated: true })).toBe(
      false
    );
    expect(isRepeatedFileField(undefined)).toBe(false);
  });

  it('a non-repeated multi-file field still compacts', () => {
    const servar = { type: 'file_upload', repeated: false };
    expect(stripEmptyRepeatEntries([null, file], servar)).toEqual([file]);
  });

  it('a repeated signature keeps its holes like a file upload', () => {
    const sigField = {
      servar: {
        key: 'my_sigs',
        type: 'signature',
        repeated: true,
        metadata: {}
      }
    };
    expect(getDefaultFieldValue(sigField)).toBeNull();
    const stored = justInsert([], file, 2, sigField);
    expect(stored).toHaveLength(3);
    expect(normalizeRepeatArrayValue(stored, sigField.servar)).toHaveLength(3);
    expect(stripEmptyRepeatEntries(stored, sigField.servar)).toHaveLength(3);
  });

  it('getServarRepeatNum does not add a phantom trailing row', () => {
    // Trailing hole stored as null: the row count is already right, so the
    // set_value trigger must not append another empty row.
    expect(getServarRepeatNum(setValueFileField, [file, null])).toBe(2);
    // Trailing hole stored as '' (today's shape). getServarRepeatNum already
    // treats '' as the default for a null-defaulting field, so neither shape
    // appends a row.
    expect(getServarRepeatNum(setValueFileField, [file, ''])).toBe(2);
  });
});
