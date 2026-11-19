import { loadPdfjs, PDFJS_STANDARD_FONT_DATA_URL } from './pdfjsLoader';
import { featheryDoc, featheryWindow } from '../../../utils/browser';

// PDF user space is 72 units per inch; 150 DPI keeps text crisp on paper
// without the multi-hundred-MB canvases a long packet would need at 300.
const PRINT_DPI = 150;
const PRINT_SCALE = PRINT_DPI / 72;
const PRINT_ROOT_CLASS = 'fthry-review-print-root';
// Fallback cleanup for when afterprint never fires: a sandboxed iframe without
// allow-modals turns print() into a silent no-op. Browsers print from a
// snapshot, so removing the markup while the dialog is open is safe.
const PRINT_MARKUP_LIFETIME = 60000;

// While printing, only the rendered pages show. The review modal itself is a
// body-level portal, so hiding every other body child hides it too.
const PRINT_CSS = `
.${PRINT_ROOT_CLASS} { display: none; }
@media print {
  body > *:not(.${PRINT_ROOT_CLASS}) { display: none !important; }
  .${PRINT_ROOT_CLASS} { display: block !important; }
  .${PRINT_ROOT_CLASS} img {
    display: block;
    width: 100%;
    height: auto;
    break-after: page;
  }
  .${PRINT_ROOT_CLASS} img:last-child { break-after: auto; }
}
@page { margin: 0; }
`;

const canvasToBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('Unable to render page')),
      'image/png'
    )
  );

/** Render one page to a PNG at print resolution, form field values
 * included. */
async function renderPageImage(pdfjs: any, pdfProxy: any, pageNumber: number) {
  const page = await pdfProxy.getPage(pageNumber);
  const viewport = page.getViewport({ scale: PRINT_SCALE });
  const canvas = featheryDoc().createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const canvasContext = canvas.getContext('2d');
  if (!canvasContext) throw new Error('Unable to render page');
  await page.render({
    canvasContext,
    viewport,
    intent: 'print',
    // The finalized files carry the filler's edits in their field values.
    annotationMode: pdfjs.AnnotationMode.ENABLE
  }).promise;
  const blob = await canvasToBlob(canvas);
  // Release the backing store now rather than holding every page's bitmap
  // until garbage collection.
  canvas.width = 0;
  canvas.height = 0;
  return URL.createObjectURL(blob);
}

/** Open the browser print dialog for every page of `pdfProxies`, in order.
 * Resolves once the dialog has been opened; the print markup is removed
 * after it closes. */
async function printDocuments(pdfProxies: any[]) {
  const pdfjs = await loadPdfjs();
  const urls: string[] = [];
  const images: HTMLImageElement[] = [];
  const doc = featheryDoc();
  const win = featheryWindow();
  const root = doc.createElement('div');
  root.className = PRINT_ROOT_CLASS;
  const style = doc.createElement('style');
  style.textContent = PRINT_CSS;
  root.appendChild(style);

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    win.removeEventListener('afterprint', cleanup);
    root.remove();
    urls.forEach((url) => URL.revokeObjectURL(url));
  };

  try {
    for (const pdfProxy of pdfProxies) {
      for (let n = 1; n <= pdfProxy.numPages; n++) {
        const url = await renderPageImage(pdfjs, pdfProxy, n);
        urls.push(url);
        const img = doc.createElement('img');
        img.src = url;
        img.alt = '';
        root.appendChild(img);
        images.push(img);
      }
    }
    // A leftover root from an earlier print would print its pages too.
    doc
      .querySelectorAll(`.${PRINT_ROOT_CLASS}`)
      .forEach((el: Element) => el.remove());
    doc.body.appendChild(root);
    await Promise.all(images.map((img) => img.decode().catch(() => undefined)));
  } catch (e) {
    cleanup();
    throw e;
  }

  win.addEventListener('afterprint', cleanup, { once: true });
  // Whichever runs second is a no-op.
  win.setTimeout(cleanup, PRINT_MARKUP_LIFETIME);
  win.print();
}

/** Load pdf.js and resolve to the printer, so a blocked CDN or CSP fails
 * before the caller commits to anything (e.g. finalizing the envelopes). */
export async function loadPrinter() {
  await loadPdfjs();
  return printFileUrls;
}

/** Print the PDFs at `urls` (a finalized review's files) in one dialog,
 * in order. Resolves once the dialog has been opened. */
export async function printFileUrls(urls: string[]) {
  if (!urls.length) return;
  const pdfjs = await loadPdfjs();
  const pdfProxies = await Promise.all(
    urls.map(
      (url) =>
        pdfjs.getDocument({
          url,
          standardFontDataUrl: PDFJS_STANDARD_FONT_DATA_URL
        }).promise
    )
  );
  try {
    await printDocuments(pdfProxies);
  } finally {
    // Every page is already an image in the print markup.
    pdfProxies.forEach((pdfProxy: any) => pdfProxy.destroy());
  }
}
