import { printFileUrls } from './print';
import { loadPdfjs } from './pdfjsLoader';
import { featheryDoc, featheryWindow } from '../../../utils/browser';

const ENABLE = 1;
jest.mock('./pdfjsLoader', () => ({
  loadPdfjs: jest.fn(),
  PDFJS_STANDARD_FONT_DATA_URL: 'fonts/'
}));

const makeProxy = (numPages: number) => {
  const render = jest.fn(() => ({ promise: Promise.resolve() }));
  return {
    numPages,
    render,
    destroy: jest.fn(),
    getPage: jest.fn(() =>
      Promise.resolve({
        getViewport: () => ({ width: 612, height: 792 }),
        render
      })
    )
  };
};

const mockDocuments = (proxies: Record<string, ReturnType<typeof makeProxy>>) =>
  (loadPdfjs as jest.Mock).mockResolvedValue({
    AnnotationMode: { ENABLE },
    getDocument: jest.fn(({ url }) => ({
      promise: Promise.resolve(proxies[url])
    }))
  });

const rootSelector = '.fthry-review-print-root';

beforeEach(() => {
  jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue({} as any);
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob(['png']));
  };
  (HTMLImageElement.prototype as any).decode = () => Promise.resolve();
  (URL as any).createObjectURL = jest.fn(() => 'blob:page');
  (URL as any).revokeObjectURL = jest.fn();
  featheryWindow().print = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
  featheryDoc()
    .querySelectorAll(rootSelector)
    .forEach((el: Element) => el.remove());
});

describe('printFileUrls', () => {
  it('prints every page of every file in order', async () => {
    const a = makeProxy(2);
    const b = makeProxy(1);
    mockDocuments({ 'a.pdf': a, 'b.pdf': b });

    await printFileUrls(['a.pdf', 'b.pdf']);

    expect(a.getPage.mock.calls).toEqual([[1], [2]]);
    expect(b.getPage.mock.calls).toEqual([[1]]);
    expect(featheryDoc().querySelectorAll(`${rootSelector} img`)).toHaveLength(
      3
    );
    expect(featheryWindow().print).toHaveBeenCalledTimes(1);
    expect(a.destroy).toHaveBeenCalled();
    expect(b.destroy).toHaveBeenCalled();
  });

  it('renders pages for print with their field values', async () => {
    const proxy = makeProxy(1);
    mockDocuments({ 'a.pdf': proxy });

    await printFileUrls(['a.pdf']);

    expect(proxy.render).toHaveBeenCalledWith(
      expect.objectContaining({ intent: 'print', annotationMode: ENABLE })
    );
  });

  it('removes the print markup after the dialog closes', async () => {
    mockDocuments({ 'a.pdf': makeProxy(1) });
    await printFileUrls(['a.pdf']);
    expect(featheryDoc().querySelector(rootSelector)).not.toBeNull();

    featheryWindow().dispatchEvent(new Event('afterprint'));

    expect(featheryDoc().querySelector(rootSelector)).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:page');
  });

  it('cleans up and rethrows when a page fails to render', async () => {
    const proxy = makeProxy(1);
    proxy.render.mockReturnValue({
      promise: Promise.reject(new Error('boom'))
    });
    mockDocuments({ 'a.pdf': proxy });

    await expect(printFileUrls(['a.pdf'])).rejects.toThrow('boom');

    expect(featheryDoc().querySelector(rootSelector)).toBeNull();
    expect(featheryWindow().print).not.toHaveBeenCalled();
    expect(proxy.destroy).toHaveBeenCalled();
  });

  it('does nothing without files', async () => {
    await printFileUrls([]);
    expect(featheryWindow().print).not.toHaveBeenCalled();
  });
});
