import { createPreloadableField } from '../index';

// A host app that cancels Vite's vite:preloadError event makes a failed chunk
// request resolve to undefined instead of rejecting, so a resolved import is
// not proof that the chunk actually loaded.
describe('createPreloadableField', () => {
  it('rejects when the chunk resolves to undefined', async () => {
    const Field = createPreloadableField('TextField', () =>
      Promise.resolve(undefined)
    );

    await expect(Field.preload()).rejects.toThrow(
      'Field chunk "TextField" resolved without a default export'
    );
  });

  it('rejects when the chunk resolves without a default export', async () => {
    const Field = createPreloadableField('SignatureField', () =>
      Promise.resolve({})
    );

    await expect(Field.preload()).rejects.toThrow(
      'Field chunk "SignatureField" resolved without a default export'
    );
  });

  it('retries the import after a failed load', async () => {
    const Component = () => null;
    const load = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ default: Component });
    const Field = createPreloadableField('TextField', load);

    await expect(Field.preload()).rejects.toThrow();
    await expect(Field.preload()).resolves.toEqual({ default: Component });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
