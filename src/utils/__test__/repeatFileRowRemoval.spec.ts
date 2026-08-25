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
import { removeFilePathMapEntry } from '../formHelperFunctions';

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
  it.each(FILE_FIELD_TYPES)('classifies %s as a file field', (type) => {
    expect(FILE_FIELD_TYPES.includes(type)).toBe(true);
  });

  it('includes audio_recording', () => {
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

  it('leaves a non-array path map alone', () => {
    filePathMap.single = 's3/only.webm';
    removeFilePathMapEntry('single', 0);
    expect(filePathMap.single).toBe('s3/only.webm');
  });
});
