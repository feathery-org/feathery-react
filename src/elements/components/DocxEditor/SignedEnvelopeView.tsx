import React, { useEffect, useRef, useState } from 'react';
import DocumentCanvas from '../DocumentViewer/DocumentCanvas';
import type { ViewerDocument } from '../DocumentViewer';
import { color, fontSize, radius } from '../DocumentViewer/tokens';
import { secondaryButtonCss } from '../DocumentViewer/buttonStyles';

// Caps page width on wide containers; narrower containers size down to fit.
const MAX_PDF_WIDTH = 900;
// Horizontal padding of the scroll area, subtracted so pages never clip.
const SCROLL_PADDING = 24;

// Read-only view for an envelope that has become a PDF — i.e. a docx that was
// finalized/signed, whose editable copy the backend discarded. The container
// renders this instead of DocxEditor so the signer sees the resulting PDF
// rather than a failed attempt to reopen the gone docx. Reuses the pdf.js
// renderer (DocumentCanvas) without the review overlay's modal/finalize chrome.
const STATUS_LABELS = {
  signed: 'Signed',
  awaiting: 'Awaiting signature',
  docusign: 'Sent via DocuSign'
};

export default function SignedEnvelopeView({
  pdfUrl,
  downloadUrl,
  signUrl,
  status
}: {
  pdfUrl: string;
  /** The freshest URL; `pdfUrl` may be an older presign of the same file. */
  downloadUrl: string;
  /** The filler's signing page while their signature is still awaited. */
  signUrl?: string;
  /** Null when nothing says whether this PDF was sent: no pill is shown. */
  status: keyof typeof STATUS_LABELS | null;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [pageWidth, setPageWidth] = useState(MAX_PDF_WIDTH);

  // Track the scroll area's width so pages render at the right size and reflow
  // when the container resizes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) {
        setPageWidth(Math.min(MAX_PDF_WIDTH, width - SCROLL_PADDING * 2));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const documents: ViewerDocument[] = [{ type: 'form', pdf_url: pdfUrl }];

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: color.canvas
      }}
    >
      <div
        css={{
          // Height/padding at parity with the PDF overlay's toolbar (Toolbar.tsx).
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          height: 56,
          flexShrink: 0,
          padding: '0 16px',
          borderBottom: `1px solid ${color.border}`,
          background: color.surface
        }}
      >
        {status ? (
          <span
            css={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '5px 12px',
              borderRadius: radius.pill,
              fontSize: fontSize.sm,
              fontWeight: 600,
              color: 'white',
              backgroundColor:
                status === 'signed' ? color.successText : color.primary
            }}
          >
            {STATUS_LABELS[status]}
          </span>
        ) : (
          <span />
        )}
        <div css={{ display: 'flex', gap: 8 }}>
          {signUrl && (
            <a
              href={signUrl}
              target='_blank'
              rel='noopener noreferrer'
              css={{ ...secondaryButtonCss, textDecoration: 'none' }}
            >
              Open signing page
            </a>
          )}
          <a
            href={downloadUrl}
            target='_blank'
            rel='noopener noreferrer'
            // Matches the overlay toolbar's Download (secondary button).
            css={{ ...secondaryButtonCss, textDecoration: 'none' }}
          >
            Download
          </a>
        </div>
      </div>
      <div
        ref={scrollRef}
        css={{ flex: 1, overflow: 'auto', padding: SCROLL_PADDING }}
      >
        <DocumentCanvas
          documents={documents}
          pageWidth={pageWidth}
          // No-ops: page counts and refs only drive the review overlay's
          // page-number toolbar and scroll navigation, neither of which this
          // read-only view has.
          onDocLoad={() => {}}
          registerPageRef={() => {}}
          readOnly
        />
      </div>
    </div>
  );
}
