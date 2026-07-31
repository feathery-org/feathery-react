// pdf.js is loaded from a CDN at runtime instead of being bundled. The
// prebuilt pdfjs-dist output declares its own top-level
// `var __webpack_exports__`, which collides with bundlers/devtools that
// evaluate modules inside a strict-mode eval wrapper (the hoisted var
// shadows the wrapper's own binding and crashes module evaluation). Loading
// it as a real ES module via dynamic `import()` at runtime sidesteps that
// entirely, and keeps pdf.js out of every consumer's bundle.
// Version and host are deliberately the same pin the rest of the product
// already uses (the assistant's attachment thumbnails and the dashboard's
// document editor): one pdf.js version, one CDN origin for customers to
// allowlist in their CSP, and one copy downloaded per page. Keep this in sync
// with them — and note the AnnotationLayer contract is version-sensitive (5.x
// takes linkService/annotationStorage in the constructor, not in render();
// see DocumentCanvas.tsx).
const PDFJS_VERSION = '5.4.296';
const PDFJS_CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build`;

let pdfjsPromise: Promise<any> | null = null;

// `new Function` keeps bundlers (webpack/rollup) from trying to statically
// resolve or rewrite the import specifier at build time.
// eslint-disable-next-line no-new-func
const dynamicImport = new Function('u', 'return import(u)') as (
  url: string
) => Promise<any>;

export function loadPdfjs(): Promise<any> {
  if (!pdfjsPromise) {
    pdfjsPromise = dynamicImport(`${PDFJS_CDN}/pdf.min.mjs`)
      .then((pdfjs: any) => {
        pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.mjs`;
        return pdfjs;
      })
      .catch((e: unknown) => {
        // Don't memoize a rejected promise: a transient CDN/CSP failure would
        // otherwise permanently break the viewer for the whole session. Clear
        // the cache so the next loadPdfjs() (e.g. a page-level retry) re-tries.
        pdfjsPromise = null;
        throw e;
      });
  }
  return pdfjsPromise;
}
