import React from 'react';
import { Document, Page } from 'react-pdf';
import { ViewerDocument } from '../index';

const THUMBNAIL_WIDTH = 140;

interface PageThumbnailsProps {
  documents: ViewerDocument[];
  pageCounts: Record<string, number>;
  onNavigate: (pdfUrl: string, pageIndex: number) => void;
}

export default function PageThumbnails({
  documents,
  pageCounts,
  onNavigate
}: PageThumbnailsProps) {
  const totalPages = documents.reduce(
    (sum, doc) => sum + (pageCounts[doc.pdf_url] ?? 0),
    0
  );

  let runningPageNumber = 0;

  return (
    <section aria-label='Pages' css={{ padding: '16px 20px' }}>
      <div
        css={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 12
        }}
      >
        <button
          type='button'
          css={linkButtonCss}
          onClick={() => documents[0] && onNavigate(documents[0].pdf_url, 0)}
          disabled={!documents.length}
        >
          First
        </button>
        <h3 css={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
          Pages {totalPages ? `(${totalPages})` : ''}
        </h3>
        <button
          type='button'
          css={linkButtonCss}
          onClick={() => {
            const lastDoc = documents[documents.length - 1];
            if (!lastDoc) return;
            const lastPageIndex = (pageCounts[lastDoc.pdf_url] ?? 1) - 1;
            onNavigate(lastDoc.pdf_url, lastPageIndex);
          }}
          disabled={!documents.length}
        >
          Last
        </button>
      </div>
      <div css={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {documents.map((doc) => (
          <Document
            key={doc.pdf_url}
            file={doc.pdf_url}
            loading={null}
            error={null}
          >
            {Array.from(
              { length: pageCounts[doc.pdf_url] ?? 0 },
              (_, pageIndex) => {
                runningPageNumber += 1;
                const pageNumber = runningPageNumber;
                return (
                  <button
                    key={pageIndex}
                    type='button'
                    aria-label={`Go to page ${pageNumber}`}
                    onClick={() => onNavigate(doc.pdf_url, pageIndex)}
                    css={thumbnailButtonCss}
                  >
                    <Page
                      pageNumber={pageIndex + 1}
                      width={THUMBNAIL_WIDTH}
                      renderAnnotationLayer={false}
                      renderTextLayer={false}
                      renderForms={false}
                    />
                    <span css={{ fontSize: 11, color: '#666' }}>
                      {pageNumber}
                    </span>
                  </button>
                );
              }
            )}
          </Document>
        ))}
      </div>
    </section>
  );
}

const linkButtonCss = {
  border: 'none',
  background: 'transparent',
  color: '#3b82f6',
  cursor: 'pointer',
  fontSize: 12,
  padding: 0,
  '&:disabled': { opacity: 0.5, cursor: 'default' }
} as const;

const thumbnailButtonCss = {
  border: '1px solid #e2e4eb',
  background: 'white',
  cursor: 'pointer',
  padding: 4,
  borderRadius: 4,
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  gap: 4,
  width: '100%',
  '&:hover': { borderColor: '#3b82f6' }
};
