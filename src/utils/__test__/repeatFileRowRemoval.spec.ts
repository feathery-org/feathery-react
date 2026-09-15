/**
 * Deleting a repeat row has to take the same slot out of filePathMap.
 *
 * fieldValues and filePathMap are two parallel arrays indexed by repeat row.
 * Splicing only the first leaves every later path off by one, so the surviving
 * file resolves to the *removed* row's S3 path: the request keeps the deleted
 * file and deletes the one the user meant to keep. fileDeduplicationCount has
 * to go too, or the corrected list is treated as a duplicate and never sent.
 */
import { FILE_FIELD_TYPES } from '../fieldHelperFunctions';
import {
  moveFilePathMapEntry,
  removeFilePathMapEntry
} from '../formHelperFunctions';

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

const { filePathMap, fileDeduplicationCount } = jest.requireMock('../init');

beforeEach(() => {
  Object.keys(filePathMap).forEach((k) => delete filePathMap[k]);
  Object.keys(fileDeduplicationCount).forEach(
    (k) => delete fileDeduplicationCount[k]
  );
});

describe('removing a repeat row that holds a file', () => {
  // audio_recording routes through the same multipart submit and the same
  // indexed filePathMap as the other two, so it must classify with them.
  it('covers every type that submits through the indexed file path', () => {
    expect(FILE_FIELD_TYPES).toEqual([
      'file_upload',
      'signature',
      'audio_recording'
    ]);
  });

  it('shifts the surviving path up when row 0 is deleted', () => {
    // Two recordings; the user deletes the first.
    filePathMap.notes = ['s3/deleted.webm', 's3/survivor.webm'];
    fileDeduplicationCount.notes = 2;

    removeFilePathMapEntry('notes', 0);

    // Without the splice, index 0 would still be the deleted row's path, and
    // the submit would keep that recording and drop the survivor.
    expect(filePathMap.notes).toEqual(['s3/survivor.webm']);
    expect(filePathMap.notes[0]).not.toBe('s3/deleted.webm');
  });

  it('clears the dedup count so the corrected list is resent', () => {
    filePathMap.notes = ['s3/a.webm', 's3/b.webm'];
    fileDeduplicationCount.notes = 2;

    removeFilePathMapEntry('notes', 0);

    expect(fileDeduplicationCount.notes).toBeUndefined();
  });

  it('takes out the middle row and closes the gap', () => {
    filePathMap.notes = ['s3/a.webm', 's3/b.webm', 's3/c.webm'];

    removeFilePathMapEntry('notes', 1);

    expect(filePathMap.notes).toEqual(['s3/a.webm', 's3/c.webm']);
  });

  it('takes out the last row without touching the others', () => {
    filePathMap.notes = ['s3/a.webm', 's3/b.webm', 's3/c.webm'];

    removeFilePathMapEntry('notes', 2);

    expect(filePathMap.notes).toEqual(['s3/a.webm', 's3/b.webm']);
  });

  it('leaves the map alone for a row past the end', () => {
    // A file column ends in empty rows, so it is shorter than its siblings and
    // the container's last-row index can land past it. Dropping slot 0 here is
    // what deleted the wrong file.
    filePathMap.notes = ['s3/only.webm'];

    removeFilePathMapEntry('notes', 3);

    expect(filePathMap.notes).toEqual(['s3/only.webm']);
  });

  it('leaves a non-array path map alone', () => {
    filePathMap.single = 's3/only.webm';
    removeFilePathMapEntry('single', 0);
    expect(filePathMap.single).toBe('s3/only.webm');
  });
});

/**
 * Reordering a repeat row has the same hazard as deleting one, and a worse
 * failure mode: nothing shrinks, so an off-by-one is invisible until the wrong
 * file shows up against the wrong row after submit.
 */
describe('moving a repeat row that holds a file', () => {
  const { fileRetryStatus } = jest.requireMock('../init');

  it('permutes the paths rather than shifting them', () => {
    filePathMap.doc = ['a.pdf', 'b.pdf', 'c.pdf'];
    moveFilePathMapEntry('doc', 0, 2, 3);
    expect(filePathMap.doc).toEqual(['b.pdf', 'c.pdf', 'a.pdf']);
  });

  it('moves a row backwards', () => {
    filePathMap.doc = ['a.pdf', 'b.pdf', 'c.pdf'];
    moveFilePathMapEntry('doc', 2, 0, 3);
    expect(filePathMap.doc).toEqual(['c.pdf', 'a.pdf', 'b.pdf']);
  });

  it('pads a short map so it moves the same row as its siblings', () => {
    // The field only ever uploaded one file, but the container has three rows.
    // Without padding, moving row 0 to row 2 would be out of range and the map
    // would keep pointing the surviving path at row 0.
    filePathMap.doc = ['a.pdf'];
    moveFilePathMapEntry('doc', 0, 2, 3);
    expect(filePathMap.doc).toEqual([null, null, 'a.pdf']);
  });

  it('keeps holes as holes', () => {
    filePathMap.doc = ['a.pdf', null, 'c.pdf'];
    moveFilePathMapEntry('doc', 2, 0, 3);
    expect(filePathMap.doc).toEqual(['c.pdf', 'a.pdf', null]);
  });

  it('resets deduplication so the corrected list is resent', () => {
    filePathMap.doc = ['a.pdf', 'b.pdf'];
    fileDeduplicationCount.doc = '2:0,1:';
    moveFilePathMapEntry('doc', 0, 1, 2);
    expect('doc' in fileDeduplicationCount).toBe(false);
  });

  it('leaves fileRetryStatus alone', () => {
    // It records whether the last submit succeeded. Clearing it would change
    // the no-files early return, suppressing a clear request that is needed.
    filePathMap.doc = ['a.pdf', 'b.pdf'];
    fileRetryStatus.doc = true;
    moveFilePathMapEntry('doc', 0, 1, 2);
    expect(fileRetryStatus.doc).toBe(true);
    delete fileRetryStatus.doc;
  });

  it('leaves a non-repeated map untouched', () => {
    // filePathMap holds a bare string for a field that is not repeated.
    filePathMap.doc = 'single.pdf';
    moveFilePathMapEntry('doc', 0, 1, 2);
    expect(filePathMap.doc).toBe('single.pdf');
  });

  it('leaves an absent map untouched', () => {
    expect(() => moveFilePathMapEntry('missing', 0, 1, 2)).not.toThrow();
    expect(filePathMap.missing).toBeUndefined();
  });

  it('is a no-op when the row does not move', () => {
    filePathMap.doc = ['a.pdf', 'b.pdf'];
    moveFilePathMapEntry('doc', 1, 1, 2);
    expect(filePathMap.doc).toEqual(['a.pdf', 'b.pdf']);
  });
});
