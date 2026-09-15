/**
 * Single-file downloads point the anchor straight at the real URL (relying
 * on the server's Content-Disposition for the save-as name) instead of
 * blobbing it — a blob: URL can't be reopened in a new tab, which some
 * embedding contexts (e.g. a Visualforce page in Salesforce Lightning) do to
 * every anchor click. Multi-file downloads still zip client-side, so they
 * still decode the raw S3 percent-encoding into a human-readable name; see
 * fileNames.spec.ts for that decoding logic.
 */
import { downloadAllFileUrls, featheryDoc } from '../browser';

describe('downloadAllFileUrls', () => {
  const originalFetch = (globalThis as any).fetch;
  let anchor: Partial<HTMLAnchorElement> & { clicked?: boolean };

  beforeEach(() => {
    anchor = {};
    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      blob: async () => new Blob(['pdf-bytes'], { type: 'application/pdf' })
    });

    const doc = featheryDoc();
    const createElement = doc.createElement.bind(doc);
    jest.spyOn(doc, 'createElement').mockImplementation((tag: string) => {
      const element = createElement(tag);
      if (tag === 'a') {
        element.click = () => {
          anchor = { href: element.href, download: element.download };
        };
      }
      return element;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (globalThis as any).fetch = originalFetch;
  });

  it('points the anchor at the real URL without fetching', async () => {
    const url =
      'https://files.test/uploads/003_%E7%99%BB%E9%8C%B2%E6%9B%B8.pdf?sig=abc';

    await downloadAllFileUrls([url]);

    expect(anchor.href).toBe(url);
    expect(anchor.download).toBe('');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
