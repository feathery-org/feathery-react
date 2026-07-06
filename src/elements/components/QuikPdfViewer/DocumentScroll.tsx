import React, { useEffect, useRef, useState } from 'react';
import { ViewerDocument } from './index';
import AnnotationLayerStyles from './AnnotationLayerStyles';
import { loadPdfjs } from './pdfjsLoader';
import { LINK_SERVICE_STUB } from './linkServiceStub';

const PAGE_GAP = 24;

interface DocumentScrollProps {
  documents: ViewerDocument[];
  pageWidth: number;
  onDocLoad: (pdfUrl: string, pdfProxy: any) => void;
  registerPageRef: (
    pdfUrl: string,
    pageIndex: number,
    el: HTMLDivElement | null
  ) => void;
  remountKey: number;
}

interface DocState {
  pdfProxy: any;
  error: string;
}

export default function DocumentScroll({
  documents,
  pageWidth,
  onDocLoad,
  registerPageRef,
  remountKey
}: DocumentScrollProps) {
  const [docStates, setDocStates] = useState<Record<string, DocState>>({});
  const docUrlsKey = documents.map((d) => d.pdf_url).join('|');

  useEffect(() => {
    let cancelled = false;
    setDocStates({});
    documents.forEach((doc) => {
      loadPdfjs()
        .then((pdfjs) => pdfjs.getDocument({ url: doc.pdf_url }).promise)
        .then((pdfProxy: any) => {
          if (cancelled) return;
          setDocStates((prev) => ({
            ...prev,
            [doc.pdf_url]: { pdfProxy, error: '' }
          }));
          onDocLoad(doc.pdf_url, pdfProxy);
        })
        .catch(() => {
          if (cancelled) return;
          setDocStates((prev) => ({
            ...prev,
            [doc.pdf_url]: { pdfProxy: null, error: 'failed' }
          }));
        });
    });
    return () => {
      cancelled = true;
    };
    // Deliberately keyed on remountKey/docUrlsKey rather than `documents` or
    // `onDocLoad`: the callback identity from the orchestrator (index.tsx)
    // is not memoized against document contents, and re-running this effect
    // on every render would restart in-flight PDF loads.
  }, [remountKey, docUrlsKey]);

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: PAGE_GAP }}>
      <AnnotationLayerStyles />
      {documents.map((doc) => {
        const state = docStates[doc.pdf_url];
        if (!state) {
          return (
            <div
              key={`${doc.pdf_url}-${remountKey}`}
              css={{ minHeight: 400 }}
            />
          );
        }
        if (state.error) {
          return (
            <div
              key={`${doc.pdf_url}-${remountKey}`}
              role='alert'
              css={{ padding: 24 }}
            >
              Failed to load {doc.form_name ?? doc.name ?? 'document'}. Check
              your connection and reopen the viewer.
            </div>
          );
        }
        return (
          <DocumentPages
            key={`${doc.pdf_url}-${remountKey}`}
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
          css={{ marginBottom: PAGE_GAP }}
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
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${pageWidth}px`;
        canvas.style.height = `${
          viewport.height * (pageWidth / viewport.width)
        }px`;
        const canvasContext = canvas.getContext('2d');
        if (canvasContext) {
          renderTask = page.render({
            canvasContext,
            viewport,
            // ENABLE_FORMS excludes interactive widget appearances from the
            // canvas — they're rendered as HTML inputs by the annotation
            // layer instead. The default (ENABLE) paints them onto the
            // canvas too, doubling prefilled values under the inputs.
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

      const annotationDiv = annotationDivRef.current;
      if (annotationDiv) {
        annotationDiv.innerHTML = '';
        annotationDiv.style.setProperty(
          '--scale-factor',
          String(viewport.scale)
        );
        const annotationViewport = viewport.clone({ dontFlip: true });
        const annotationLayer = new pdfjs.AnnotationLayer({
          div: annotationDiv,
          page,
          viewport: annotationViewport,
          accessibilityManager: null,
          annotationCanvasMap: null,
          annotationEditorUIManager: null,
          structTreeLayer: null
        });
        const annotations = await page.getAnnotations();
        if (cancelled) return;
        await annotationLayer.render({
          annotations,
          imageResourcesPath: '',
          renderForms: true,
          linkService: LINK_SERVICE_STUB,
          downloadManager: null,
          annotationStorage: pdfProxy.annotationStorage,
          enableScripting: false
        });
      }
    })();

    return () => {
      cancelled = true;
      if (renderTask) renderTask.cancel();
    };
  }, [pdfProxy, pageNumber, pageWidth]);

  return (
    <div css={{ position: 'relative', display: 'inline-block' }}>
      <canvas ref={canvasRef} />
      <div ref={annotationDivRef} className='annotationLayer' />
    </div>
  );
}
