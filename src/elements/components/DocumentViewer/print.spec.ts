import { printDocuments } from './print';
import { featheryDoc, featheryWindow } from '../../../utils/browser';

const ENABLE_STORAGE = 3;
jest.mock('./pdfjsLoader', () => ({
  loadPdfjs: jest.fn(() =>
    Promise.resolve({ AnnotationMode: { ENABLE_STORAGE: 3 } })
  )
}));

const printStorage = { snapshot: true };
const makeProxy = (numPages: number) => {
  const render = jest.fn(() => ({ promise: Promise.resolve() }));
  return {
    numPages,
    annotationStorage: { print: printStorage },
    render,
    getPage: jest.fn(() =>
      Promise.resolve({
        getViewport: () => ({ width: 612, height: 792 }),
        render
      })
    )
  };
};

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
    .forEach((el) => el.remove());
});

describe('printDocuments', () => {
  it('prints every page of every document in order', async () => {
    const a = makeProxy(2);
    const b = makeProxy(1);

    await printDocuments([a, b]);

    expect(a.getPage.mock.calls).toEqual([[1], [2]]);
    expect(b.getPage.mock.calls).toEqual([[1]]);
    expect(featheryDoc().querySelectorAll(`${rootSelector} img`)).toHaveLength(
      3
    );
    expect(featheryWindow().print).toHaveBeenCalledTimes(1);
  });

  it("renders fields from the filler's annotation storage", async () => {
    const proxy = makeProxy(1);

    await printDocuments([proxy]);

    expect(proxy.render).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'print',
        annotationMode: ENABLE_STORAGE,
        printAnnotationStorage: printStorage
      })
    );
  });

  it('removes the print markup after the dialog closes', async () => {
    await printDocuments([makeProxy(1)]);
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

    await expect(printDocuments([proxy])).rejects.toThrow('boom');

    expect(featheryDoc().querySelector(rootSelector)).toBeNull();
    expect(featheryWindow().print).not.toHaveBeenCalled();
  });
});
