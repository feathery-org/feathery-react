import React, { useEffect, useRef } from 'react';
import { ViewerDocument } from '../index';
import { pageKey } from '../useActivePage';
import { color, fontSize, radius } from '../tokens';

const THUMBNAIL_WIDTH = 160;

interface PageThumbnailsProps {
  documents: ViewerDocument[];
  pageCounts: Record<string, number>;
  pdfProxies: Record<string, any>;
  activeKey: string;
  onNavigate: (pdfUrl: string, pageIndex: number) => void;
}

export default function PageThumbnails({
  documents,
  pageCounts,
  pdfProxies,
  activeKey,
  onNavigate
}: PageThumbnailsProps) {
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    buttonRefs.current[activeKey]?.scrollIntoView({ block: 'nearest' });
  }, [activeKey]);

  let runningPageNumber = 0;
  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: 16
      }}
    >
      {documents.map((doc) =>
        Array.from({ length: pageCounts[doc.pdf_url] ?? 0 }, (_, pageIndex) => {
          runningPageNumber += 1;
          const pageNumber = runningPageNumber;
          const key = pageKey(doc.pdf_url, pageIndex);
          const isActive = key === activeKey;
          return (
            <button
              key={key}
              type='button'
              ref={(el) => {
                buttonRefs.current[key] = el;
              }}
              aria-label={`Go to page ${pageNumber}`}
              aria-current={isActive ? 'true' : undefined}
              onClick={() => onNavigate(doc.pdf_url, pageIndex)}
              css={{
                position: 'relative',
                border: isActive
                  ? `2px solid ${color.accent}`
                  : `1px solid ${color.border}`,
                background: isActive ? color.accentSoft : color.surface,
                padding: isActive ? 3 : 4,
                cursor: 'pointer',
                borderRadius: radius.sm,
                display: 'flex',
                // Hug the rendered page so the bordered box matches the page's
                // aspect ratio instead of stretching to the sidebar width.
                width: 'fit-content',
                '&:hover': { borderColor: color.accent }
              }}
            >
              <ThumbnailCanvas
                pdfProxy={pdfProxies[doc.pdf_url]}
                pageIndex={pageIndex}
              />
              <span
                css={{
                  position: 'absolute',
                  bottom: 6,
                  right: 6,
                  padding: '1px 7px',
                  borderRadius: 10,
                  fontSize: fontSize.xs,
                  fontWeight: 600,
                  lineHeight: 1.5,
                  color: 'white',
                  backgroundColor: isActive
                    ? color.accent
                    : 'rgba(0, 0, 0, 0.6)'
                }}
              >
                {pageNumber}
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}

interface ThumbnailCanvasProps {
  pdfProxy: any;
  pageIndex: number;
}

function ThumbnailCanvas({ pdfProxy, pageIndex }: ThumbnailCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!pdfProxy) return undefined;
    let cancelled = false;
    let renderTask: any = null;

    (async () => {
      const page = await pdfProxy.getPage(pageIndex + 1);
      if (cancelled) return;
      const unscaledViewport = page.getViewport({ scale: 1 });
      const scale = THUMBNAIL_WIDTH / unscaledViewport.width;
      const viewport = page.getViewport({ scale });

      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${THUMBNAIL_WIDTH}px`;
      canvas.style.height = `${viewport.height}px`;
      const canvasContext = canvas.getContext('2d');
      if (!canvasContext) return;
      renderTask = page.render({ canvasContext, viewport });
      try {
        await renderTask.promise;
      } catch (e: any) {
        if (e?.name !== 'RenderingCancelledException') throw e;
      }
    })();

    return () => {
      cancelled = true;
      if (renderTask) renderTask.cancel();
    };
  }, [pdfProxy, pageIndex]);

  return <canvas ref={canvasRef} />;
}
