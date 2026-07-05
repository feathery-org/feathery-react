import React from 'react';
import { Document, Page } from 'react-pdf';
import { ViewerDocument } from '../index';

const THUMBNAIL_WIDTH = 140;

interface PageThumbnailsProps {
  documents: ViewerDocument[];
  pageCounts: Record<number, number>;
  onNavigate: (docIndex: number, pageIndex: number) => void;
}

export default function PageThumbnails({
  documents,
  pageCounts,
  onNavigate
}: PageThumbnailsProps) {
  const totalPages = documents.reduce(
    (sum, _doc, docIndex) => sum + (pageCounts[docIndex] ?? 0),
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
          onClick={() => onNavigate(0, 0)}
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
            const lastDocIndex = documents.length - 1;
            if (lastDocIndex < 0) return;
            const lastPageIndex = (pageCounts[lastDocIndex] ?? 1) - 1;
            onNavigate(lastDocIndex, lastPageIndex);
          }}
          disabled={!documents.length}
        >
          Last
        </button>
      </div>
      <div css={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {documents.map((doc, docIndex) => (
          <Document
            key={docIndex}
            file={doc.pdf_url}
            loading={null}
            error={null}
          >
            {Array.from(
              { length: pageCounts[docIndex] ?? 0 },
              (_, pageIndex) => {
                runningPageNumber += 1;
                const pageNumber = runningPageNumber;
                return (
                  <button
                    key={pageIndex}
                    type='button'
                    aria-label={`Go to page ${pageNumber}`}
                    onClick={() => onNavigate(docIndex, pageIndex)}
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
