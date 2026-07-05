import React, { useCallback, useState } from 'react';
import { Document, Page } from 'react-pdf';
import { ViewerDocument } from './index';
import AnnotationLayerStyles from './AnnotationLayerStyles';

const PAGE_GAP = 24;

interface DocumentScrollProps {
  documents: ViewerDocument[];
  pageWidth: number;
  onDocLoad: (docIndex: number, pdfProxy: any) => void;
  registerPageRef: (
    docIndex: number,
    pageIndex: number,
    el: HTMLDivElement | null
  ) => void;
  remountKey: number;
}

export default function DocumentScroll({
  documents,
  pageWidth,
  onDocLoad,
  registerPageRef,
  remountKey
}: DocumentScrollProps) {
  const [pageCounts, setPageCounts] = useState<Record<number, number>>({});

  const handleLoad = useCallback(
    (docIndex: number) => (pdfProxy: any) => {
      setPageCounts((prev) => ({ ...prev, [docIndex]: pdfProxy.numPages }));
      onDocLoad(docIndex, pdfProxy);
    },
    [onDocLoad]
  );

  return (
    <div css={{ display: 'flex', flexDirection: 'column', gap: PAGE_GAP }}>
      <AnnotationLayerStyles />
      {documents.map((doc, docIndex) => (
        <Document
          key={`${docIndex}-${remountKey}`}
          file={doc.pdf_url}
          onLoadSuccess={handleLoad(docIndex)}
          loading={<div css={{ minHeight: 400 }} />}
          error={
            <div role='alert' css={{ padding: 24 }}>
              Failed to load {doc.form_name ?? doc.name ?? 'document'}. Check
              your connection and reopen the viewer.
            </div>
          }
        >
          {Array.from({ length: pageCounts[docIndex] ?? 0 }, (_, pageIndex) => (
            <div
              key={pageIndex}
              ref={(el) => registerPageRef(docIndex, pageIndex, el)}
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
          ))}
        </Document>
      ))}
    </div>
  );
}
