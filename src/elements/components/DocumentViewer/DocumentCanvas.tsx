import React, { useCallback, useEffect, useRef, useState } from 'react';
import { keyframes } from '@emotion/react';
import { ViewerDocument } from './index';
import TextLayerStyles from './TextLayerStyles';
import AnnotationLayerStyles from './AnnotationLayerStyles';
import { loadPdfjs, PDFJS_STANDARD_FONT_DATA_URL } from './pdfjsLoader';
import { LINK_SERVICE_STUB } from './linkServiceStub';
import { color, radius, shadow, fontSize } from './tokens';
import { secondaryButtonCss } from './buttonStyles';
import { AlertIcon } from './icons';
import { featheryWindow } from '../../../utils/browser';

const PAGE_GAP = 24;
// US Letter aspect for loading placeholders; actual pages size themselves.
const SKELETON_ASPECT = '8.5 / 11';

interface DocumentCanvasProps {
  documents: ViewerDocument[];
  pageWidth: number;
  onDocLoad: (pdfUrl: string, pdfProxy: any) => void;
  registerPageRef: (
    pdfUrl: string,
    pageIndex: number,
    el: HTMLDivElement | null
  ) => void;
}

interface DocState {
  pdfProxy: any;
  error: string;
}

const shimmer = keyframes({
  '0%': { backgroundPosition: '-400px 0' },
  '100%': { backgroundPosition: '400px 0' }
});

export default function DocumentCanvas({
  documents,
  pageWidth,
  onDocLoad,
  registerPageRef
}: DocumentCanvasProps) {
  const [docStates, setDocStates] = useState<Record<string, DocState>>({});
  const generationRef = useRef(0);
  const loadedRef = useRef<Set<string>>(new Set());
  // Every pdfProxy we've opened, so each one can be destroyed. A pdfProxy holds
  // the parsed document in the pdf.js worker; dropping the reference without
  // destroy() leaks it for the life of the page, so every open/close cycle of
  // the viewer would accumulate another full document.
  const openDocsRef = useRef<Set<any>>(new Set());
  const docUrlsKey = documents.map((d) => d.pdf_url).join('|');

  const destroyDoc = useCallback((pdfProxy: any) => {
    if (!pdfProxy) return;
    openDocsRef.current.delete(pdfProxy);
    // cleanup() frees per-page render resources, destroy() tears down the
    // worker-side document. Both are best-effort: a document already destroyed
    // (or one whose load never finished) must not break teardown.
    try {
      pdfProxy.cleanup?.();
      pdfProxy.destroy?.();
    } catch {
      // already torn down
    }
  }, []);

  const loadDoc = useCallback(
    (doc: ViewerDocument) => {
      const generation = generationRef.current;
      loadedRef.current.add(doc.pdf_url);
      setDocStates((prev) => {
        const next = { ...prev };
        delete next[doc.pdf_url];
        return next;
      });
      loadPdfjs()
        .then(
          (pdfjs: any) =>
            pdfjs.getDocument({
              url: doc.pdf_url,
              standardFontDataUrl: PDFJS_STANDARD_FONT_DATA_URL
            }).promise
        )
        .then((pdfProxy: any) => {
          // Superseded while loading (remount/unmount): this proxy will never
          // be rendered, so destroy it rather than leaking it.
          if (generationRef.current !== generation) {
            destroyDoc(pdfProxy);
            return;
          }
          openDocsRef.current.add(pdfProxy);
          setDocStates((prev) => ({
            ...prev,
            [doc.pdf_url]: { pdfProxy, error: '' }
          }));
          onDocLoad(doc.pdf_url, pdfProxy);
        })
        .catch(() => {
          if (generationRef.current !== generation) return;
          setDocStates((prev) => ({
            ...prev,
            [doc.pdf_url]: { pdfProxy: null, error: 'failed' }
          }));
        });
    },
    [onDocLoad, destroyDoc]
  );

  // Invalidate any in-flight load and release every open document when the
  // canvas unmounts entirely.
  useEffect(
    () => () => {
      generationRef.current += 1;
      openDocsRef.current.forEach(destroyDoc);
      openDocsRef.current = new Set();
      // Also clear the loaded-URL guard so a remount re-runs loadDoc. Under
      // React StrictMode (dev), the mount/unmount/remount cycle would
      // otherwise bump the generation (discarding the in-flight load) while
      // the guard skips reloading — leaving the viewer stuck with no
      // pdfProxy. Harmless in prod, where the component unmounts only once.
      loadedRef.current = new Set();
    },
    [destroyDoc]
  );

  useEffect(() => {
    const urlSet = new Set(documents.map((d) => d.pdf_url));

    // Load only documents that aren't loaded yet, and release any that are no
    // longer shown. Re-fetching an on-screen document would discard its
    // rendered state for no reason.
    setDocStates((prev) => {
      const next: Record<string, DocState> = {};
      Object.keys(prev).forEach((u) => {
        if (urlSet.has(u)) next[u] = prev[u];
        // Pruned (attachment removed): release its worker-side document.
        else destroyDoc(prev[u]?.pdfProxy);
      });
      return next;
    });
    loadedRef.current.forEach((u) => {
      if (!urlSet.has(u)) loadedRef.current.delete(u);
    });
    documents.forEach((doc) => {
      if (!loadedRef.current.has(doc.pdf_url)) loadDoc(doc);
    });
    // Keyed on docUrlsKey rather than `documents`: re-running on every render
    // would restart in-flight loads.
  }, [docUrlsKey, loadDoc, destroyDoc]);

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: PAGE_GAP,
        width: 'fit-content',
        minWidth: '100%'
      }}
    >
      <TextLayerStyles />
      <AnnotationLayerStyles />
      {documents.map((doc) => {
        const state = docStates[doc.pdf_url];
        if (!state) {
          return (
            <div
              key={doc.pdf_url}
              role='status'
              aria-label='Loading document'
              css={{
                width: pageWidth,
                aspectRatio: SKELETON_ASPECT,
                borderRadius: radius.sm,
                backgroundColor: color.surface,
                boxShadow: shadow.page,
                backgroundImage: `linear-gradient(90deg, ${color.surface} 0px, ${color.surfaceHover} 200px, ${color.surface} 400px)`,
                backgroundSize: '800px 100%',
                animation: `${shimmer} 1.4s ease-in-out infinite`,
                '@media (prefers-reduced-motion: reduce)': {
                  animation: 'none'
                }
              }}
            />
          );
        }
        if (state.error) {
          return (
            <div
              key={doc.pdf_url}
              role='alert'
              css={{
                width: pageWidth,
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
                padding: 32,
                borderRadius: radius.sm,
                border: `1px solid ${color.border}`,
                backgroundColor: color.surface,
                color: color.textMuted,
                fontSize: fontSize.base,
                textAlign: 'center'
              }}
            >
              <span css={{ color: color.errorText }}>
                <AlertIcon size={24} />
              </span>
              Failed to load {doc.name ?? 'document'}.
              <button
                type='button'
                css={secondaryButtonCss}
                onClick={() => loadDoc(doc)}
              >
                Retry
              </button>
            </div>
          );
        }
        return (
          <DocumentPages
            key={doc.pdf_url}
            pdfProxy={state.pdfProxy}
            pdfUrl={doc.pdf_url}
            pageWidth={pageWidth}
            registerPageRef={registerPageRef}
          />
        );
      })}
    </div>
  );
}

interface DocumentPagesProps {
  pdfProxy: any;
  pdfUrl: string;
  pageWidth: number;
  registerPageRef: (
    pdfUrl: string,
    pageIndex: number,
    el: HTMLDivElement | null
  ) => void;
}

function DocumentPages({
  pdfProxy,
  pdfUrl,
  pageWidth,
  registerPageRef
}: DocumentPagesProps) {
  const numPages: number = pdfProxy.numPages ?? 0;
  return (
    <>
      {Array.from({ length: numPages }, (_, pageIndex) => (
        <div
          key={pageIndex}
          ref={(el) => registerPageRef(pdfUrl, pageIndex, el)}
        >
          <PdfPage
            pdfProxy={pdfProxy}
            pageNumber={pageIndex + 1}
            pageWidth={pageWidth}
          />
        </div>
      ))}
    </>
  );
}

interface PdfPageProps {
  pdfProxy: any;
  pageNumber: number;
  pageWidth: number;
}

function PdfPage({ pdfProxy, pageNumber, pageWidth }: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const annotationDivRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: any = null;

    (async () => {
      const pdfjs = await loadPdfjs();
      if (cancelled) return;
      const page = await pdfProxy.getPage(pageNumber);
      if (cancelled) return;
      const unscaledViewport = page.getViewport({ scale: 1 });
      const scale = pageWidth / unscaledViewport.width;
      const viewport = page.getViewport({ scale });

      const canvas = canvasRef.current;
      if (canvas) {
        // Back the canvas at device resolution and scale the drawing to match,
        // otherwise pages render at 1 CSS px per PDF px and look soft on every
        // HiDPI screen. CSS size stays in layout pixels.
        const dpr = featheryWindow().devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${pageWidth}px`;
        canvas.style.height = `${
          viewport.height * (pageWidth / viewport.width)
        }px`;
        const canvasContext = canvas.getContext('2d');
        if (canvasContext) {
          renderTask = page.render({
            canvasContext,
            viewport,
            transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
            // ENABLE_FORMS excludes interactive widget appearances from the
            // canvas — they're rendered as live HTML inputs by the annotation
            // layer below, seeded from each field's /V. The default (ENABLE)
            // would paint them onto the canvas too, doubling prefilled values
            // under the inputs.
            annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS
          });
          try {
            await renderTask.promise;
          } catch (e: any) {
            if (e?.name !== 'RenderingCancelledException') throw e;
          }
        }
      }
      if (cancelled) return;

      // Text layer: expose the PDF's body text as selectable, screen-reader
      // readable content over the (aria-hidden) canvas. Without it the document
      // is an opaque image to assistive tech (WCAG 1.1.1 / 1.3.1).
      const textDiv = textLayerRef.current;
      if (textDiv && (pdfjs.TextLayer || pdfjs.renderTextLayer)) {
        textDiv.innerHTML = '';
        textDiv.style.setProperty('--scale-factor', String(viewport.scale));
        try {
          const textContentSource = page.streamTextContent
            ? page.streamTextContent({
                includeMarkedContent: true,
                disableNormalization: true
              })
            : await page.getTextContent();
          if (pdfjs.TextLayer) {
            await new pdfjs.TextLayer({
              textContentSource,
              container: textDiv,
              viewport
            }).render();
          } else {
            await pdfjs.renderTextLayer({
              textContentSource,
              container: textDiv,
              viewport
            }).promise;
          }
        } catch {
          // A text-layer failure must never block form rendering.
        }
        if (cancelled) return;
      }

      // Interactive form layer: the PDF's own AcroForm widgets rendered as
      // HTML inputs, writing edits into pdfProxy.annotationStorage. The viewer
      // reads that storage back on finalize (see index.tsx) to persist what
      // the filler changed.
      const annotationDiv = annotationDivRef.current;
      if (annotationDiv) {
        // Preserve focus across an annotation-layer rebuild (e.g. on resize):
        // clearing innerHTML blurs the field the user is editing, so remember
        // it and restore focus once the widgets are recreated.
        const activeEl = annotationDiv.ownerDocument
          .activeElement as HTMLElement | null;
        const focusedId =
          activeEl && annotationDiv.contains(activeEl) ? activeEl.id : '';
        annotationDiv.innerHTML = '';
        annotationDiv.style.setProperty(
          '--scale-factor',
          String(viewport.scale)
        );
        // dontFlip: the widget layer positions elements in CSS (y-down)
        // coordinates; the flipped canvas viewport would mirror them.
        const annotationViewport = viewport.clone({ dontFlip: true });
        const annotationLayer = new pdfjs.AnnotationLayer({
          div: annotationDiv,
          page,
          viewport: annotationViewport,
          accessibilityManager: null,
          annotationCanvasMap: null,
          annotationEditorUIManager: null,
          structTreeLayer: null,
          // pdf.js 5.x takes these in the constructor (4.x took them in
          // render() — see the version note in pdfjsLoader.ts).
          linkService: LINK_SERVICE_STUB,
          annotationStorage: pdfProxy.annotationStorage
        });
        try {
          const annotations = await page.getAnnotations();
          if (cancelled) return;
          await annotationLayer.render({
            annotations,
            imageResourcesPath: '',
            renderForms: true,
            downloadManager: null,
            enableScripting: false
          });
        } catch {
          // A widget-layer failure degrades the page to read-only; it must
          // never block the rendered document itself.
        }
        if (focusedId && typeof CSS !== 'undefined' && CSS.escape) {
          annotationDiv
            .querySelector<HTMLElement>(`#${CSS.escape(focusedId)}`)
            ?.focus();
        }
      }
    })();

    return () => {
      cancelled = true;
      if (renderTask) renderTask.cancel();
    };
  }, [pdfProxy, pageNumber, pageWidth]);

  return (
    <div
      css={{
        position: 'relative',
        display: 'inline-block',
        boxShadow: shadow.page,
        borderRadius: 2,
        backgroundColor: color.surface
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden='true'
        css={{ display: 'block', borderRadius: 2 }}
      />
      <div ref={textLayerRef} className='textLayer' />
      <div ref={annotationDivRef} className='annotationLayer' />
    </div>
  );
}
