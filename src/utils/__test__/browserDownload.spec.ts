/* eslint-disable no-restricted-globals */
import { downloadAllFileUrls, downloadFile } from '../browser';

describe('downloadFile', () => {
  let anchors: HTMLAnchorElement[];
  let clickSpy: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    anchors = [];
    clickSpy = jest.fn();
    const realCreateElement = document.createElement.bind(document);
    // Intercept only the anchor the download helper mints, so the rest of the
    // document keeps working normally.
    jest
      .spyOn(document, 'createElement')
      .mockImplementation((tag: any, ...rest: any[]) => {
        const element = realCreateElement(tag, ...rest);
        if (tag === 'a') {
          anchors.push(element as HTMLAnchorElement);
          element.click = clickSpy;
        }
        return element;
      });
    (window.URL as any).createObjectURL = jest.fn(() => 'blob:fake-url');
    (window.URL as any).revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  const download = () =>
    downloadFile(
      new File(['pdf'], 'Loan Docs.pdf', { type: 'application/pdf' })
    );

  it('clicks an anchor pointed at the blob, named after the file', () => {
    download();

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(anchors[0].href).toBe('blob:fake-url');
    expect(anchors[0].download).toBe('Loan Docs.pdf');
  });

  // Salesforce cancels link clicks it sees from a listener on the host
  // document and re-opens the href outside the Visualforce iframe, where the
  // blob no longer resolves. A detached anchor never reaches that listener.
  it('never attaches the anchor to the document', () => {
    download();

    expect(anchors[0].isConnected).toBe(false);
    expect(document.querySelector('a')).toBeNull();
  });

  // Revoking on the next line races the browser's download manager, and a host
  // that defers the click behind a prompt loses the blob outright.
  it('keeps the blob URL alive past the click', () => {
    download();

    expect(window.URL.revokeObjectURL).not.toHaveBeenCalled();

    jest.runAllTimers();

    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });

  describe('downloadAllFileUrls', () => {
    beforeEach(() => {
      (global as any).fetch = jest.fn(async () => ({
        blob: async () => new Blob(['pdf'], { type: 'application/pdf' })
      }));
    });

    afterEach(() => {
      delete (global as any).fetch;
    });

    it('does nothing when there are no files', async () => {
      await downloadAllFileUrls([]);

      expect(clickSpy).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('downloads a single file under its own name, without zipping it', async () => {
      await downloadAllFileUrls(
        ['https://s3.test/d/Loan%20Docs.pdf?X-Amz-Signature=abc'],
        'Bundle'
      );

      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(anchors[0].download).toBe('Loan Docs.pdf');
    });

    it('zips several files under the given name', async () => {
      await downloadAllFileUrls(
        ['https://s3.test/d/a.pdf', 'https://s3.test/d/b.pdf'],
        'Bundle'
      );

      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(anchors[0].download).toBe('Bundle.zip');
    });
  });
});
