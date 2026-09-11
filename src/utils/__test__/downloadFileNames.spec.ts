/**
 * The name a download saves under has to match the processing toast and the
 * rehydrated file field. It previously kept the raw S3 percent-encoding.
 */
import { downloadAllFileUrls, featheryDoc, featheryWindow } from '../browser';

describe('downloadAllFileUrls', () => {
  const originalFetch = (globalThis as any).fetch;
  let downloadedName: string;

  beforeEach(() => {
    downloadedName = '';
    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      blob: async () => new Blob(['pdf-bytes'], { type: 'application/pdf' })
    });
    featheryWindow().URL.createObjectURL = jest.fn(() => 'blob:stub');
    featheryWindow().URL.revokeObjectURL = jest.fn();

    const doc = featheryDoc();
    const createElement = doc.createElement.bind(doc);
    jest.spyOn(doc, 'createElement').mockImplementation((tag: string) => {
      const element = createElement(tag);
      if (tag === 'a') {
        element.click = () => {
          downloadedName = (element as HTMLAnchorElement).download;
        };
      }
      return element;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (globalThis as any).fetch = originalFetch;
  });

  it.each([
    ['003_%E7%99%BB%E9%8C%B2%E6%9B%B8.pdf', '003_登録書.pdf'],
    ['caf%C3%A9%20%26%20%E6%9B%B8%E9%A1%9E.pdf', 'café & 書類.pdf'],
    ['bad%E7.pdf', 'bad%E7.pdf']
  ])('saves %s as %s', async (key, expected) => {
    await downloadAllFileUrls([`https://files.test/uploads/${key}?sig=abc`]);
    expect(downloadedName).toBe(expected);
  });
});
