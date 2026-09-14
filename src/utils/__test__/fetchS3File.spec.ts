/**
 * Rehydrated file fields used to name files with decodeURI, which left reserved
 * characters percent-encoded and threw URIError on a malformed escape. The
 * name a user sees in the field has to match the processing toast and the
 * download, so all three go through getFilenameFromUrl.
 */
import { fetchS3File } from '../formHelperFunctions';

const mockFetch = (contents = 'pdf-bytes', type = 'application/pdf') => {
  (globalThis as any).fetch = jest.fn().mockResolvedValue({
    blob: async () => new Blob([contents], { type })
  });
};

describe('fetchS3File', () => {
  const originalFetch = (globalThis as any).fetch;
  afterAll(() => {
    (globalThis as any).fetch = originalFetch;
  });

  it.each([
    ['003_%E7%99%BB%E9%8C%B2%E6%9B%B8.pdf', '003_登録書.pdf'],
    ['caf%C3%A9%20%26%20%E6%9B%B8%E9%A1%9E.pdf', 'café & 書類.pdf'],
    ['a%3Fb.pdf', 'a?b.pdf']
  ])('names the file %s as %s', async (key, expected) => {
    mockFetch();
    const file = await fetchS3File(
      `https://files.test/uploads/${key}?signature=abc`
    );
    expect(file.name).toBe(expected);
    expect(file.type).toBe('application/pdf');
  });

  it('does not throw on a malformed escape', async () => {
    mockFetch();
    const file = await fetchS3File('https://files.test/uploads/bad%E7.pdf');
    expect(file.name).toBe('bad%E7.pdf');
  });
});
