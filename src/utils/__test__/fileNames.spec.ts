import { getFilenameFromUrl } from '../fileNames';

describe('getFilenameFromUrl', () => {
  it.each([
    ['003_%E7%99%BB%E9%8C%B2%E6%9B%B8.pdf', '003_登録書.pdf'],
    ['caf%C3%A9%20%26%20%E6%9B%B8%E9%A1%9E.pdf', 'café & 書類.pdf'],
    ['%F0%9F%93%84.pdf', '📄.pdf'],
    ['登録書.pdf', '登録書.pdf'],
    ['100%25%20complete.pdf', '100% complete.pdf'],
    ['literal%2520name.pdf', 'literal%20name.pdf'],
    ['a+b.pdf', 'a+b.pdf'],
    ['report.pdf?signature=a/b#page=1', 'report.pdf'],
    ['a%3Fb%23c.pdf?signature=x', 'a?b#c.pdf']
  ])('decodes %s to %s', (path, expected) => {
    expect(getFilenameFromUrl(`https://files.test/uploads/${path}`)).toBe(
      expected
    );
  });

  it.each([['bad%ZZ.pdf'], ['bad%E7.pdf'], ['%.pdf']])(
    'falls back to the raw segment for the malformed escape in %s',
    (path) => {
      expect(getFilenameFromUrl(`https://files.test/${path}`)).toBe(path);
    }
  );

  it('handles a bare filename with no path', () => {
    expect(getFilenameFromUrl('%E7%99%BB%E9%8C%B2.pdf')).toBe('登録.pdf');
  });

  it('returns an empty string when the URL ends in a slash', () => {
    expect(getFilenameFromUrl('https://files.test/uploads/')).toBe('');
  });
});
