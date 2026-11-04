/**
 * Replacing a file field's value wholesale (`field.value = ...` or
 * `field.value[i] = ...` from a logic rule) has to keep filePathMap aligned.
 *
 * filePathMap is indexed by repeat row. If the rule removes row 0 and the map
 * is left alone, the file that moved into row 0 resolves to the *removed*
 * row's S3 path on the next submit, so the backend keeps the deleted file.
 */
import { realignFilePathMap } from '../formHelperFunctions';

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
  registerTextVariableFields: () => {}
}));

const { filePathMap, fileDeduplicationCount } = jest.requireMock('../init');

const fileA = Promise.resolve(new File(['a'], 'a.pdf'));
const fileB = Promise.resolve(new File(['b'], 'b.pdf'));
const fileC = Promise.resolve(new File(['c'], 'c.pdf'));

beforeEach(() => {
  Object.keys(filePathMap).forEach((k) => delete filePathMap[k]);
  Object.keys(fileDeduplicationCount).forEach(
    (k) => delete fileDeduplicationCount[k]
  );
});

describe('realignFilePathMap', () => {
  it('moves paths with their files when a row is spliced out', () => {
    filePathMap.docs = ['s3/a.pdf', 's3/b.pdf', 's3/c.pdf'];
    const prev = [fileA, fileB, fileC];

    realignFilePathMap('docs', prev, prev.toSpliced(0, 1));

    expect(filePathMap.docs).toEqual(['s3/b.pdf', 's3/c.pdf']);
  });

  it('leaves a hole in the map for a row cleared to null', () => {
    filePathMap.docs = ['s3/a.pdf', 's3/b.pdf'];
    const prev = [fileA, fileB];

    realignFilePathMap('docs', prev, [null, fileB]);

    expect(filePathMap.docs).toEqual([null, 's3/b.pdf']);
  });

  it('gives a brand-new file no path so it is uploaded', () => {
    filePathMap.docs = ['s3/a.pdf'];
    const prev = [fileA];

    realignFilePathMap('docs', prev, [fileA, fileC]);

    expect(filePathMap.docs).toEqual(['s3/a.pdf', null]);
  });

  it('follows a reorder', () => {
    filePathMap.docs = ['s3/a.pdf', 's3/b.pdf'];
    const prev = [fileA, fileB];

    realignFilePathMap('docs', prev, [fileB, fileA]);

    expect(filePathMap.docs).toEqual(['s3/b.pdf', 's3/a.pdf']);
  });

  it('drops the path when a single file is replaced', () => {
    filePathMap.sig = 's3/sig.png';

    realignFilePathMap('sig', fileA, fileB);

    expect(filePathMap.sig).toBeNull();
  });

  it('resets the dedup count so the corrected list is resent', () => {
    filePathMap.docs = ['s3/a.pdf', 's3/b.pdf'];
    fileDeduplicationCount.docs = 'fingerprint';

    realignFilePathMap('docs', [fileA, fileB], [fileB]);

    expect(fileDeduplicationCount.docs).toBeUndefined();
  });

  it('ignores fields with nothing stored and same-reference assigns', () => {
    const prev = [fileA];
    realignFilePathMap('plain', ['x'], ['y']);
    expect('plain' in filePathMap).toBe(false);

    filePathMap.docs = ['s3/a.pdf'];
    fileDeduplicationCount.docs = 'fingerprint';
    realignFilePathMap('docs', prev, prev);
    expect(filePathMap.docs).toEqual(['s3/a.pdf']);
    expect(fileDeduplicationCount.docs).toBe('fingerprint');
  });
});
