import React, { useCallback } from 'react';
import { Document, Page } from 'react-pdf';
import { ViewerDocument } from './index';
import AnnotationLayerStyles from './AnnotationLayerStyles';

const PAGE_GAP = 24;

interface DocumentScrollProps {
  documents: ViewerDocument[];
  pageWidth: number;
  pageCounts: Record<string, number>;
  onDocLoad: (pdfUrl: string, pdfProxy: any) => void;
  registerPageRef: (
    pdfUrl: string,
    pageIndex: number,
    el: HTMLDivElement | null
  ) => void;
  remountKey: number;
}

export default function DocumentScroll({
  documents,
  pageWidth,
  pageCounts,
  onDocLoad,
  registerPageRef,
  remountKey
}: DocumentScrollProps) {
  const handleLoad = useCallback(
    (pdfUrl: string) => (pdfProxy: any) => {
      onDocLoad(pdfUrl, pdfProxy);
    },
    [onDocLoad]
  );

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: PAGE_GAP }}>
      <AnnotationLayerStyles />
      {documents.map((doc) => (
        <Document
          key={`${doc.pdf_url}-${remountKey}`}
          file={doc.pdf_url}
          onLoadSuccess={handleLoad(doc.pdf_url)}
          loading={<div css={{ minHeight: 400 }} />}
          error={
            <div role='alert' css={{ padding: 24 }}>
              Failed to load {doc.form_name ?? doc.name ?? 'document'}. Check
              your connection and reopen the viewer.
            </div>
          }
        >
          {Array.from(
            { length: pageCounts[doc.pdf_url] ?? 0 },
            (_, pageIndex) => (
              <div
                key={pageIndex}
                ref={(el) => registerPageRef(doc.pdf_url, pageIndex, el)}
                css={{ marginBottom: PAGE_GAP }}
              >
                <Page
                  pageNumber={pageIndex + 1}
                  width={pageWidth}
                  renderForms
                  renderAnnotationLayer
                  renderTextLayer={false}
                />
              </div>
            )
          )}
        </Document>
      ))}
    </div>
  );
}
