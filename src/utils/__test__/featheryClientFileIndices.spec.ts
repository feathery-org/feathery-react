/**
 * The multipart body for a repeatable file field must carry the repeat index of
 * every file it sends, so a file uploaded into row 3 is stored at row 3.
 */
import FeatheryClient from '../featheryClient';

// init.ts constructs a FeatheryClient at module load, so pulling in the real
// module from here would be circular. Stub it with the same mutable stores the
// client reads. babel-plugin-jest-hoist lifts this above the import, and the
// factory owns the stores because that hoist also clears any const.
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

const { fieldValues, filePathMap, fileDeduplicationCount } =
  jest.requireMock('../init');

const servar = { key: 'f', type: 'file_upload', repeated: true };

function newClient() {
  const client: any = new FeatheryClient('form', Promise.resolve());
  jest
    .spyOn(client.offlineRequestHandler, 'runOrSaveRequest')
    .mockImplementation((run: any) => run());
  jest
    .spyOn(client.offlineRequestHandler, 'resetRetryAttemptsByUrl')
    .mockResolvedValue(undefined);
  jest
    .spyOn(client.offlineRequestHandler, 'clearFailedRequestByUrl')
    .mockResolvedValue(undefined);
  jest.spyOn(client, '_fetch').mockResolvedValue({} as any);
  return client;
}

const bodyOf = (client: any) => client._fetch.mock.calls[0][1].body as FormData;
const indicesOf = (body: FormData) => body.get('__feathery_file_indices');

beforeEach(() => {
  Object.keys(filePathMap).forEach((k) => delete (filePathMap as any)[k]);
  Object.keys(fieldValues).forEach((k) => delete (fieldValues as any)[k]);
  Object.keys(fileDeduplicationCount).forEach(
    (k) => delete fileDeduplicationCount[k]
  );
  jest.restoreAllMocks();
});

describe('repeatable file upload wire format', () => {
  it('keeps a hole at every empty repeat row', async () => {
    const file = new Blob(['x']);
    const client = newClient();
    const resolved = await client._getFileValue({
      ...servar,
      file_upload: [null, null, Promise.resolve(file)]
    });
    expect(resolved).toEqual([null, null, file]);
  });

  it('does not throw when every repeat row is empty', async () => {
    const client = newClient();
    await expect(
      client._getFileValue({ ...servar, file_upload: [null, null] })
    ).resolves.toEqual([null, null]);
  });

  it('sends the repeat index of an uploaded file', async () => {
    const file = new Blob(['x']);
    const client = newClient();
    await client._submitFileData(
      { ...servar, file_upload: [null, null, Promise.resolve(file)] },
      'step'
    );
    const body = bodyOf(client);
    expect(body.getAll('f')).toHaveLength(1);
    expect(indicesOf(body)).toBe(JSON.stringify({ f: { keep: [], new: [2] } }));
  });

  it('indexes a kept S3 path separately from a new upload', async () => {
    (filePathMap as any).f = [null, 's3/kept.pdf'];
    const client = newClient();
    await client._submitFileData(
      { ...servar, file_upload: [Promise.resolve(new Blob(['x'])), 'ignored'] },
      'step'
    );
    const body = bodyOf(client);
    expect(indicesOf(body)).toBe(
      JSON.stringify({ f: { keep: [1], new: [0] } })
    );
  });

  it('sends no indices when clearing the whole field', async () => {
    fileDeduplicationCount.f = 1;
    const client = newClient();
    await client._submitFileData({ ...servar, file_upload: [] }, 'step');
    const body = bodyOf(client);
    expect(body.getAll('f')).toEqual(['']);
    expect(indicesOf(body)).toBeNull();
  });

  it('sends no indices for a non-repeated multi-file field', async () => {
    // Its entries are a flat list, not repeat rows. Indexing it would move the
    // field off the legacy dense representation on almost every submission.
    const client = newClient();
    await client._submitFileData(
      {
        key: 'f',
        type: 'file_upload',
        repeated: false,
        file_upload: [
          Promise.resolve(new Blob(['a'])),
          Promise.resolve(new Blob(['b']))
        ]
      },
      'step'
    );
    const body = bodyOf(client);
    expect(body.getAll('f')).toHaveLength(2);
    expect(indicesOf(body)).toBeNull();
  });

  it('sends no indices for a single non-repeated upload', async () => {
    const client = newClient();
    await client._submitFileData(
      {
        key: 'f',
        type: 'file_upload',
        repeated: false,
        file_upload: [Promise.resolve(new Blob(['a']))]
      },
      'step'
    );
    expect(indicesOf(bodyOf(client))).toBeNull();
  });

  it('indexes a repeated audio recording the same way as a file upload', async () => {
    const client = newClient();
    await client._submitFileData(
      {
        key: 'f',
        type: 'audio_recording',
        repeated: true,
        audio_recording: [Promise.resolve(new Blob(['clip'])), null, null]
      },
      'step'
    );
    const body = bodyOf(client);
    expect(body.getAll('f')).toHaveLength(1);
    expect(indicesOf(body)).toBe(JSON.stringify({ f: { keep: [], new: [0] } }));
  });

  it('indexes a repeated signature the same way as a file upload', async () => {
    const client = newClient();
    await client._submitFileData(
      {
        key: 'f',
        type: 'signature',
        repeated: true,
        signature: [null, Promise.resolve(new Blob(['sig']))]
      },
      'step'
    );
    const body = bodyOf(client);
    expect(body.getAll('f')).toHaveLength(1);
    expect(indicesOf(body)).toBe(JSON.stringify({ f: { keep: [], new: [1] } }));
  });
});
