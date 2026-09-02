/**
 * _getFileValue turns a repeat array into what actually goes over the wire.
 *
 * Two things it must not do: resurrect a file at a row the value says is
 * empty, and turn one failed upload in a plain multi-file field into a total
 * submission failure.
 */
// Imported from init rather than constructed: init builds its own client at
// module load, so importing the class here would cycle back through it.
import { defaultClient, filePathMap } from '../init';

const repeatedServar = (fileUpload: any) => ({
  key: 'my_files',
  type: 'file_upload',
  repeated: true,
  metadata: {},
  file_upload: fileUpload
});

const multiServar = (fileUpload: any) => ({
  key: 'my_files',
  type: 'file_upload',
  repeated: false,
  metadata: { multiple: true },
  file_upload: fileUpload
});

describe('_getFileValue', () => {
  const client: any = defaultClient;

  beforeEach(() => {
    Object.keys(filePathMap).forEach((k) => delete (filePathMap as any)[k]);
  });

  it('does not resurrect a file at a row the value cleared', async () => {
    // A logic rule moved the row 0 file to row 2. filePathMap still holds the
    // old path at row 0, because the `field.value` setter and repeat_single
    // both null a row without sweeping the map. Reading it back here would
    // submit the one file at two rows at once.
    (filePathMap as any).my_files = ['s3/a.pdf', null, null];
    const moved = Promise.resolve(new Blob(['x']));

    const resolved = await client._getFileValue(
      repeatedServar([null, null, moved])
    );

    expect(resolved).toHaveLength(3);
    expect(resolved[0]).toBeNull();
    expect(resolved[1]).toBeNull();
    expect(resolved[2]).not.toBeNull();
  });

  it('still sends the stored path for a row the user kept', async () => {
    (filePathMap as any).my_files = ['s3/a.pdf', null, 's3/c.pdf'];
    const kept = Promise.resolve(new Blob(['x']));

    const resolved = await client._getFileValue(
      repeatedServar([kept, null, kept])
    );

    expect(resolved).toEqual(['s3/a.pdf', null, 's3/c.pdf']);
  });

  it('fails the whole submit when a repeat row cannot resolve', async () => {
    // The submit replaces the field, so a failed row arriving as a hole would
    // delete whatever is stored at that row.
    const ok = Promise.resolve(new Blob(['x']));
    const bad = Promise.reject(new Error('upload died'));

    await expect(
      client._getFileValue(repeatedServar([ok, bad]))
    ).rejects.toThrow('upload died');
  });

  it('a plain multi-file field still sends the files that uploaded', async () => {
    // Positions mean nothing here, so one bad upload out of three is not a
    // reason to drop the other two -- the behaviour before repeat holes.
    const a = Promise.resolve(new Blob(['a']));
    const c = Promise.resolve(new Blob(['c']));
    const bad = Promise.reject(new Error('upload died'));

    const resolved = await client._getFileValue(multiServar([a, bad, c]));

    expect(resolved).toHaveLength(2);
  });

  it('a plain multi-file field still errors when every upload fails', async () => {
    const bad = Promise.reject(new Error('upload died'));

    await expect(client._getFileValue(multiServar([bad]))).rejects.toThrow(
      'upload died'
    );
  });
});
