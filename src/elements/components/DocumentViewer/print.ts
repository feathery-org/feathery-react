import { loadPdfjs, PDFJS_STANDARD_FONT_DATA_URL } from './pdfjsLoader';
import { featheryDoc, featheryWindow } from '../../../utils/browser';

// PDF user space is 72 units per inch; 150 DPI keeps text crisp on paper
// without the multi-hundred-MB canvases a long packet would need at 300.
const PRINT_DPI = 150;
const PRINT_SCALE = PRINT_DPI / 72;
// Safari caps a canvas at 16.7M pixels and draws nothing past it, so oversize
// pages (posters, engineering sheets) render at a lower DPI instead.
const MAX_CANVAS_PIXELS = 16_000_000;
const PRINT_ROOT_CLASS = 'fthry-review-print-root';
// Last-resort cleanup when neither afterprint nor a later interaction arrives.
const PRINT_MARKUP_LIFETIME = 10 * 60 * 1000;

// While printing, only the rendered pages show, one per sheet, scaled to fit
// the sheet both ways so landscape and off-size pages are neither cut nor
// split. The review modal is a body-level portal, so hiding the other body
// children hides it too.
const PRINT_CSS = `
.${PRINT_ROOT_CLASS} { display: none; }
@media print {
  html, body {
    height: auto !important;
    overflow: visible !important;
  }
  body > *:not(.${PRINT_ROOT_CLASS}) { display: none !important; }
  .${PRINT_ROOT_CLASS} { display: block !important; }
  .${PRINT_ROOT_CLASS} img {
    display: block;
    max-width: 100%;
    /* 1px under the sheet, so rounding can't spill onto a blank page. */
    max-height: calc(100vh - 1px);
    margin: 0 auto;
    object-fit: contain;
    break-inside: avoid;
  }
  .${PRINT_ROOT_CLASS} img + img { break-before: page; }
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
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(
    PRINT_SCALE,
    Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height))
  );
  const viewport = page.getViewport({ scale });
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

// Removes the markup of the print still in the page, if any.
let cleanupActivePrint: (() => void) | null = null;

/** Render every page of `pdfProxies`, in order, into a detached print root.
 * Returns the root and the page images' blob URLs. */
async function renderPrintMarkup(pdfjs: any, pdfProxies: any[]) {
  const doc = featheryDoc();
  const root = doc.createElement('div');
  root.className = PRINT_ROOT_CLASS;
  const style = doc.createElement('style');
  style.textContent = PRINT_CSS;
  root.appendChild(style);
  const urls: string[] = [];
  try {
    for (const pdfProxy of pdfProxies) {
      for (let n = 1; n <= pdfProxy.numPages; n++) {
        const url = await renderPageImage(pdfjs, pdfProxy, n);
        urls.push(url);
        const img = doc.createElement('img');
        img.src = url;
        img.alt = '';
        root.appendChild(img);
      }
    }
  } catch (e) {
    urls.forEach((url) => URL.revokeObjectURL(url));
    throw e;
  }
  return { root, urls };
}

/** Put the print markup in the page and call print(); the markup is removed
 * once printing is over. */
async function openPrintDialog(root: HTMLElement, urls: string[]) {
  const win = featheryWindow();
  let done = false;
  const fallbackTimer = win.setTimeout(() => cleanup(), PRINT_MARKUP_LIFETIME);
  const cleanup = () => {
    if (done) return;
    done = true;
    win.clearTimeout(fallbackTimer);
    win.removeEventListener('afterprint', cleanup);
    win.removeEventListener('pointerdown', cleanup, true);
    win.removeEventListener('keydown', cleanup, true);
    root.remove();
    urls.forEach((url) => URL.revokeObjectURL(url));
    if (cleanupActivePrint === cleanup) cleanupActivePrint = null;
  };

  // An earlier print's pages would print too.
  cleanupActivePrint?.();
  cleanupActivePrint = cleanup;
  featheryDoc().body.appendChild(root);
  await Promise.all(
    Array.from(root.querySelectorAll('img'), (img) =>
      img.decode().catch(() => undefined)
    )
  );

  win.addEventListener('afterprint', cleanup);
  win.print();
  // Where print() blocks until the dialog closes, afterprint has already
  // cleaned up.
  if (done) return;
  // print() returns immediately, with no afterprint to follow, when it is
  // suppressed (a sandboxed iframe without allow-modals). The filler's next
  // input then cleans up, in the capture phase so a host-page Ctrl+P can't
  // print these pages.
  win.addEventListener('pointerdown', cleanup, true);
  win.addEventListener('keydown', cleanup, true);
}

/** Print the PDFs at `urls` (a finalized review's files) in one dialog,
 * in order. Resolves once print() returns, which in most browsers is after
 * the dialog closes. */
export async function printFileUrls(urls: string[]) {
  if (!urls.length) return;
  const pdfjs = await loadPdfjs();
  const loaded = await Promise.allSettled(
    urls.map(
      (url) =>
        pdfjs.getDocument({
          url,
          standardFontDataUrl: PDFJS_STANDARD_FONT_DATA_URL
        }).promise
    )
  );
  const pdfProxies: any[] = [];
  const failures: unknown[] = [];
  loaded.forEach((outcome) =>
    outcome.status === 'fulfilled'
      ? pdfProxies.push(outcome.value)
      : failures.push(outcome.reason)
  );
  try {
    if (failures.length) throw failures[0];
    const { root, urls: imageUrls } = await renderPrintMarkup(
      pdfjs,
      pdfProxies
    );
    await openPrintDialog(root, imageUrls);
  } finally {
    // Every page is already an image in the print markup.
    pdfProxies.forEach((pdfProxy) => pdfProxy.destroy());
  }
}

/** Load pdf.js and resolve to the printer, so a blocked CDN or CSP fails
 * before the caller commits to anything (e.g. finalizing the envelopes). */
export async function loadPrinter() {
  await loadPdfjs();
  return printFileUrls;
}
