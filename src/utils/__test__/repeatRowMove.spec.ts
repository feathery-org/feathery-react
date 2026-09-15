/**
 * A repeat row belongs to the container, not to any one field, but each field
 * stores its own flat array and those arrays can be different lengths - a file
 * field is shorter than its siblings whenever it ends in empty rows. Moving
 * each array by its own indices would therefore move a *different* physical row
 * in the short field, silently shearing the row apart. moveRepeatRowValue pads
 * to the container's row count first so every field moves the same row.
 */
import { getRepeatContainerRowCount, moveRepeatRowValue } from '../repeat';

jest.mock('../init', () => ({
  initInfo: () => ({ sdkKey: 'key', userId: 'user' }),
  initFormsPromise: Promise.resolve(),
  initState: { defaultErrors: {}, language: '', formSessions: {} },
  fieldValues: {},
  filePathMap: {},
  fileDeduplicationCount: {},
  fileRetryStatus: {},
  setFieldValues: () => {},
  markStepCompleted: () => {},
  registerKnownFieldKeys: () => {},
  registerTextVariableFormats: () => {}
}));

const { fieldValues } = jest.requireMock('../init');

const textField = (key: string) => ({
  servar: { key, type: 'text_field', repeated: true, metadata: {} },
  position: [0, 0]
});
const fileField = (key: string) => ({
  servar: { key, type: 'file_upload', repeated: true, metadata: {} },
  position: [0, 1]
});

beforeEach(() => {
  Object.keys(fieldValues).forEach((k) => delete fieldValues[k]);
});

describe('getRepeatContainerRowCount', () => {
  const container = { position: [0], id: 'c', repeated: true };

  it('takes the longest field, not the first', () => {
    fieldValues.name = ['a', 'b', 'c'];
    fieldValues.doc = [null];
    const step = { servar_fields: [textField('name'), fileField('doc')] };
    expect(getRepeatContainerRowCount(step as any, container as any)).toBe(3);
  });

  it('is zero when the container holds no fields', () => {
    const step = { servar_fields: [] };
    expect(getRepeatContainerRowCount(step as any, container as any)).toBe(0);
  });

  it('ignores fields outside the container', () => {
    fieldValues.name = ['a', 'b'];
    fieldValues.outside = ['x', 'y', 'z', 'w'];
    const outside = {
      servar: { key: 'outside', type: 'text_field', repeated: true },
      position: [1, 0]
    };
    const step = { servar_fields: [textField('name'), outside] };
    expect(getRepeatContainerRowCount(step as any, container as any)).toBe(2);
  });

  it('treats a non-array value as no rows', () => {
    fieldValues.name = 'not an array';
    const step = { servar_fields: [textField('name')] };
    expect(getRepeatContainerRowCount(step as any, container as any)).toBe(0);
  });
});

describe('moveRepeatRowValue', () => {
  it('moves the row in a field that spans every row', () => {
    const field = textField('name');
    expect(moveRepeatRowValue(['a', 'b', 'c'], 0, 2, 3, field)).toEqual([
      'b',
      'c',
      'a'
    ]);
  });

  it('moves the same physical row in three fields of different lengths', () => {
    const text = textField('name');
    const file = fileField('doc');
    // Row 0 is the one being dragged to the end in all three.
    expect(moveRepeatRowValue(['a', 'b', 'c'], 0, 2, 3, text)).toEqual([
      'b',
      'c',
      'a'
    ]);
    // Two rows of data in a three-row container: row 2 is an implicit hole, so
    // 'x' lands last and the vacated slot 0 is filled, not shifted away.
    expect(moveRepeatRowValue(['x', 'y'], 0, 2, 3, text)).toEqual([
      'y',
      '',
      'x'
    ]);
    expect(moveRepeatRowValue(['p'], 0, 2, 3, file)).toEqual([null, null, 'p']);
  });

  it('trims trailing holes so the rendered row count cannot grow', () => {
    const field = textField('name');
    // Moving the last real row up leaves holes at the tail, which must not
    // survive as extra rows.
    expect(moveRepeatRowValue(['a', 'b'], 1, 0, 4, field)).toEqual(['b', 'a']);
  });

  it('fills an interior hole with null for a repeated file field', () => {
    const field = fileField('doc');
    // __feathery_file_indices addresses rows positionally, so the vacated slot
    // has to stay a slot rather than collapse.
    expect(moveRepeatRowValue(['p', 'q'], 0, 2, 3, field)).toEqual([
      'q',
      null,
      'p'
    ]);
  });

  it('fills an interior hole with the field default otherwise', () => {
    const field = textField('name');
    // A null here would be rewritten to '' by updateFieldValues anyway, but
    // stripEmptyRepeatEntries would have compacted the row away first.
    expect(moveRepeatRowValue(['p', 'q'], 0, 2, 3, field)).toEqual([
      'q',
      '',
      'p'
    ]);
  });

  it('returns the input untouched when the move is out of range', () => {
    const field = textField('name');
    const input = ['a', 'b'];
    expect(moveRepeatRowValue(input, 0, 5, 2, field)).toBe(input);
    expect(moveRepeatRowValue(input, 1, 1, 2, field)).toBe(input);
  });

  it('keeps the row count invariant across a move', () => {
    const field = textField('name');
    const before = ['a', 'b', 'c', 'd'];
    expect(moveRepeatRowValue(before, 3, 0, 4, field)).toHaveLength(
      before.length
    );
  });
});
