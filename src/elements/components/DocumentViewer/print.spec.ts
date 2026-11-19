import { loadPrinter, printFileUrls } from './print';
import { loadPdfjs } from './pdfjsLoader';
import { featheryDoc, featheryWindow } from '../../../utils/browser';

const ENABLE = 1;
jest.mock('./pdfjsLoader', () => ({
  loadPdfjs: jest.fn(),
  PDFJS_STANDARD_FONT_DATA_URL: 'fonts/'
}));

// A Letter page in PDF points unless given another size.
const makeProxy = (numPages: number, width = 612, height = 792) => {
  const render = jest.fn<{ promise: Promise<void> }, [any]>(() => ({
    promise: Promise.resolve()
  }));
  return {
    numPages,
    render,
    destroy: jest.fn(),
    getPage: jest.fn(() =>
      Promise.resolve({
        getViewport: ({ scale }: { scale: number }) => ({
          width: width * scale,
          height: height * scale
        }),
        render
      })
    )
  };
};

const mockDocuments = (proxies: Record<string, ReturnType<typeof makeProxy>>) =>
  (loadPdfjs as jest.Mock).mockResolvedValue({
    AnnotationMode: { ENABLE },
    getDocument: jest.fn(({ url }) => ({
      promise: proxies[url]
        ? Promise.resolve(proxies[url])
        : Promise.reject(new Error(`Unable to load ${url}`))
    }))
  });

const rootSelector = '.fthry-review-print-root';
const printRoots = () => featheryDoc().querySelectorAll(rootSelector);
const renderedViewport = (proxy: ReturnType<typeof makeProxy>) =>
  proxy.render.mock.calls[0][0].viewport;

const win = featheryWindow();
const originalPrint = win.print;
const originalToBlob = HTMLCanvasElement.prototype.toBlob;
const originalDecode = (HTMLImageElement.prototype as any).decode;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

beforeEach(() => {
  jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue({} as any);
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob(['png']));
  };
  (HTMLImageElement.prototype as any).decode = () => Promise.resolve();
  let blobCount = 0;
  (URL as any).createObjectURL = jest.fn(() => `blob:page-${++blobCount}`);
  (URL as any).revokeObjectURL = jest.fn();
  win.print = jest.fn();
});

afterEach(() => {
  // Ends any print a test left open, removing its markup and listeners.
  win.dispatchEvent(new Event('afterprint'));
  jest.restoreAllMocks();
  win.print = originalPrint;
  HTMLCanvasElement.prototype.toBlob = originalToBlob;
  (HTMLImageElement.prototype as any).decode = originalDecode;
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

describe('printFileUrls', () => {
  it('prints every page of every file in order', async () => {
    const a = makeProxy(2);
    const b = makeProxy(1);
    mockDocuments({ 'a.pdf': a, 'b.pdf': b });

    await printFileUrls(['a.pdf', 'b.pdf']);

    expect(a.getPage.mock.calls).toEqual([[1], [2]]);
    expect(b.getPage.mock.calls).toEqual([[1]]);
    expect(
      Array.from(
        featheryDoc().querySelectorAll(`${rootSelector} img`),
        (img: any) => img.getAttribute('src')
      )
    ).toEqual(['blob:page-1', 'blob:page-2', 'blob:page-3']);
    expect(win.print).toHaveBeenCalledTimes(1);
    expect(a.destroy).toHaveBeenCalled();
    expect(b.destroy).toHaveBeenCalled();
  });

  it('renders pages at 150 DPI for print with their field values', async () => {
    const proxy = makeProxy(1);
    mockDocuments({ 'a.pdf': proxy });

    await printFileUrls(['a.pdf']);

    expect(proxy.render).toHaveBeenCalledWith(
      expect.objectContaining({ intent: 'print', annotationMode: ENABLE })
    );
    const { width, height } = renderedViewport(proxy);
    expect(width).toBeCloseTo(1275);
    expect(height).toBeCloseTo(1650);
  });

  it('lowers the resolution of a page too large for one canvas', async () => {
    // 36 x 48 in: 5400 x 7200 px at 150 DPI, past Safari's canvas limit.
    const proxy = makeProxy(1, 36 * 72, 48 * 72);
    mockDocuments({ 'a.pdf': proxy });

    await printFileUrls(['a.pdf']);

    const { width, height } = renderedViewport(proxy);
    expect(width * height).toBeLessThanOrEqual(16_000_000);
    expect(width / height).toBeCloseTo(36 / 48);
  });

  it('removes the print markup after the dialog closes', async () => {
    mockDocuments({ 'a.pdf': makeProxy(1) });
    await printFileUrls(['a.pdf']);
    expect(printRoots()).toHaveLength(1);

    win.dispatchEvent(new Event('afterprint'));

    expect(printRoots()).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:page-1');
  });

  it('cleans up when the dialog closes before print() returns', async () => {
    (win.print as jest.Mock).mockImplementation(() =>
      win.dispatchEvent(new Event('afterprint'))
    );
    mockDocuments({ 'a.pdf': makeProxy(1) });

    await printFileUrls(['a.pdf']);

    expect(printRoots()).toHaveLength(0);
    // Nothing is left listening once the print is cleaned up.
    win.dispatchEvent(new KeyboardEvent('keydown'));
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['keydown', () => new KeyboardEvent('keydown')],
    ['pointerdown', () => new Event('pointerdown')]
  ])(
    'removes the print markup on the next %s when print() is suppressed',
    async (_, makeEvent) => {
      mockDocuments({ 'a.pdf': makeProxy(1) });
      await printFileUrls(['a.pdf']);

      win.dispatchEvent(makeEvent());

      expect(printRoots()).toHaveLength(0);
    }
  );

  it('removes the print markup on a timer as a last resort', async () => {
    const setTimeoutSpy = jest.spyOn(win, 'setTimeout');
    mockDocuments({ 'a.pdf': makeProxy(1) });
    await printFileUrls(['a.pdf']);

    const [fallback] = setTimeoutSpy.mock.calls.find(
      ([, delay]) => delay === 10 * 60 * 1000
    ) as [() => void, number];
    fallback();

    expect(printRoots()).toHaveLength(0);
    win.dispatchEvent(new Event('afterprint'));
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('replaces an earlier print still in the page', async () => {
    mockDocuments({ 'a.pdf': makeProxy(1), 'b.pdf': makeProxy(1) });
    await printFileUrls(['a.pdf']);

    await printFileUrls(['b.pdf']);

    expect(printRoots()).toHaveLength(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:page-1');
    expect(
      featheryDoc().querySelector(`${rootSelector} img`).getAttribute('src')
    ).toBe('blob:page-2');
  });

  it('cleans up and rethrows when a page fails to render', async () => {
    const proxy = makeProxy(1);
    proxy.render.mockReturnValue({
      promise: Promise.reject(new Error('boom'))
    });
    mockDocuments({ 'a.pdf': proxy });

    await expect(printFileUrls(['a.pdf'])).rejects.toThrow('boom');

    expect(printRoots()).toHaveLength(0);
    expect(win.print).not.toHaveBeenCalled();
    expect(proxy.destroy).toHaveBeenCalled();
  });

  it('releases the files that loaded when another fails to', async () => {
    const a = makeProxy(1);
    mockDocuments({ 'a.pdf': a });

    await expect(printFileUrls(['a.pdf', 'missing.pdf'])).rejects.toThrow(
      'Unable to load missing.pdf'
    );

    expect(a.destroy).toHaveBeenCalled();
    expect(win.print).not.toHaveBeenCalled();
  });

  it('does nothing without files', async () => {
    await printFileUrls([]);
    expect(win.print).not.toHaveBeenCalled();
  });
});

describe('loadPrinter', () => {
  it('resolves the printer once pdf.js loads', async () => {
    (loadPdfjs as jest.Mock).mockResolvedValue({});
    await expect(loadPrinter()).resolves.toBe(printFileUrls);
  });

  it('rejects when pdf.js is blocked', async () => {
    (loadPdfjs as jest.Mock).mockRejectedValue(new Error('blocked'));
    await expect(loadPrinter()).rejects.toThrow('blocked');
  });
});
