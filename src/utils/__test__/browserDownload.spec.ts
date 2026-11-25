/**
 * Downloads mint a blob: URL, point a detached anchor at it and click it. The
 * name a download saves under has to match the processing toast and the
 * rehydrated file field; it previously kept the raw S3 percent-encoding.
 */
import {
  downloadAllFileUrls,
  downloadFile,
  featheryDoc,
  featheryWindow
} from '../browser';

// Captured at click time. The old code attached the anchor and removed it
// right after clicking, so inspecting it afterwards cannot tell the two apart.
interface ClickedAnchor {
  href: string;
  download: string;
  isConnected: boolean;
}

describe('browser downloads', () => {
  const originalFetch = (globalThis as any).fetch;
  let clicks: ClickedAnchor[];

  beforeEach(() => {
    clicks = [];
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
          const { href, download, isConnected } = element as HTMLAnchorElement;
          clicks.push({ href, download, isConnected });
        };
      }
      return element;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    (globalThis as any).fetch = originalFetch;
  });

  describe('downloadFile', () => {
    const pdf = () =>
      new File(['pdf'], 'Loan Docs.pdf', { type: 'application/pdf' });

    // Salesforce cancels link clicks it sees from a listener on the document
    // and re-opens the href outside the Visualforce iframe, where the blob no
    // longer resolves. A detached anchor never reaches that listener.
    it('clicks a detached anchor pointed at the blob, named after the file', () => {
      downloadFile(pdf());

      expect(clicks).toEqual([
        { href: 'blob:stub', download: 'Loan Docs.pdf', isConnected: false }
      ]);
    });

    // Revoking on the next line races the browser's download manager, and a
    // host that defers the click behind a prompt loses the blob outright.
    it('keeps the blob URL alive past the click', () => {
      jest.useFakeTimers();

      downloadFile(pdf());

      expect(featheryWindow().URL.revokeObjectURL).not.toHaveBeenCalled();

      jest.runAllTimers();

      expect(featheryWindow().URL.revokeObjectURL).toHaveBeenCalledWith(
        'blob:stub'
      );
    });
  });

  describe('downloadAllFileUrls', () => {
    it('rejects failed HTTP downloads only when the caller requires every file', async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        blob: () => new Blob(['Forbidden'])
      });
      await expect(
        downloadAllFileUrls(
          ['https://files.test/a.pdf'],
          undefined,
          { cache: 'no-store' },
          true
        )
      ).rejects.toThrow('Could not download');
      expect(clicks).toHaveLength(0);
      await downloadAllFileUrls(['https://files.test/a.pdf']);
      expect(clicks).toHaveLength(1);
    });

    it('does nothing when there are no files', async () => {
      await downloadAllFileUrls([]);

      expect(clicks).toEqual([]);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it.each([
      ['003_%E7%99%BB%E9%8C%B2%E6%9B%B8.pdf', '003_登録書.pdf'],
      ['caf%C3%A9%20%26%20%E6%9B%B8%E9%A1%9E.pdf', 'café & 書類.pdf'],
      ['bad%E7.pdf', 'bad%E7.pdf'],
      ['Loan%20Docs.pdf', 'Loan Docs.pdf']
    ])('saves a single file %s as %s, not as a zip', async (key, expected) => {
      await downloadAllFileUrls(
        [`https://files.test/uploads/${key}?sig=abc`],
        'Bundle'
      );

      expect(clicks.map((click) => click.download)).toEqual([expected]);
    });

    it('zips several files under the given name', async () => {
      await downloadAllFileUrls(
        [
          'https://files.test/uploads/a.pdf',
          'https://files.test/uploads/b.pdf'
        ],
        'Bundle'
      );

      expect(clicks.map((click) => click.download)).toEqual(['Bundle.zip']);
    });
  });
});
