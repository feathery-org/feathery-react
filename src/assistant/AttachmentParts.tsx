import { memo, ReactNode, useEffect, useRef, useState } from 'react';
import { GRAY_100, GRAY_200, GRAY_400, GRAY_800 } from './colors';
import { CloseIcon, DocumentIcon, SpinnerIcon } from './icons';
import { featheryDoc } from '../utils/browser';
import { AssistantAttachment, isImageType } from './attachments';
import { getAttachmentIcon } from './attachmentIcon';
import {
  PDFJS_PACKAGE_CDN,
  PDFJS_STANDARD_FONT_DATA_URL
} from '../elements/components/DocumentViewer/pdfjsLoader';

// pdf.js loads from the CDN at runtime, never bundled (the UMD build and
// consumer bundlers choke on pdfjs-dist's ESM); the version pin comes from
// pdfjsLoader, and new Function hides the import from bundlers
const PDFJS_CDN = `${PDFJS_PACKAGE_CDN}/build/pdf.min.mjs`;
const PDFJS_WORKER_CDN = `${PDFJS_PACKAGE_CDN}/build/pdf.worker.min.mjs`;

// eslint-disable-next-line no-new-func
const importFromCdn = new Function('url', 'return import(url)') as (
  url: string
) => Promise<any>;

let pdfjsPromise: Promise<any | null> | null = null;

const loadPdfjs = (): Promise<any | null> => {
  if (!pdfjsPromise) {
    pdfjsPromise = importFromCdn(PDFJS_CDN)
      .then((mod: any) => {
        mod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
        return mod;
      })
      .catch((err: unknown) => {
        console.warn('[feathery] pdf.js failed to load from CDN', err);
        // Retry on the next thumbnail instead of caching the failure
        pdfjsPromise = null;
        return null;
      });
  }
  return pdfjsPromise;
};

// Colored per-type glyph (PDF/DOC/XLS/PPT/CSV), gray generic icon otherwise
const TypedFileIcon = ({
  mediaType,
  filename,
  size = 24
}: {
  mediaType: string;
  filename?: string;
  size?: number;
}) => {
  const typed = getAttachmentIcon({ type: mediaType, name: filename });
  if (!typed) {
    return (
      <DocumentIcon css={{ width: size, height: size, color: GRAY_400 }} />
    );
  }
  const { Icon, color } = typed;
  return <Icon css={{ width: size, height: size, color, flexShrink: 0 }} />;
};

export const LazyPdfThumbnail = memo(function LazyPdfThumbnail({
  url,
  width = 140,
  glyph
}: {
  url: string;
  width?: number;
  // null renders a blank placeholder (a spinner overlays it), undefined
  // falls back to the generic doc icon
  glyph?: ReactNode | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    // no reset to 'loading' here, when the optimistic blob URL swaps to the
    // signed URL the old render stays visible until the new one lands
    (async () => {
      const pdfjs = await loadPdfjs();
      if (cancelled) return;
      if (!pdfjs) {
        setState('error');
        return;
      }
      try {
        // standardFontDataUrl lets pdf.js draw base-14 font glyphs (e.g.
        // ZapfDingbats checkmarks) that have no embedded font program.
        const doc = await pdfjs.getDocument({
          url,
          standardFontDataUrl: PDFJS_STANDARD_FONT_DATA_URL
        }).promise;
        const page = await doc.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: width / base.width });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({
          canvasContext: canvas.getContext('2d'),
          viewport
        }).promise;
        if (!cancelled) setState('ready');
      } catch (err) {
        console.warn('[feathery] PDF preview failed to load', { url, err });
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, width]);

  // Fixed-size slice, builder parity (h-28 w-[140px]), the page renders at
  // full width and the box crops the rest, loading/error is the same box as
  // a flat gray square so the swap never shifts layout
  const height = Math.round(width * 0.8);
  const ready = state === 'ready';

  return (
    <div
      css={{
        width: `${width}px`,
        height: `${height}px`,
        overflow: 'hidden',
        borderRadius: '8px',
        border: `1px solid ${GRAY_200}`,
        backgroundColor: ready ? 'white' : GRAY_100,
        ...(ready
          ? {}
          : {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: GRAY_400
            })
      }}
    >
      {!ready && (glyph === undefined ? <DocumentIcon /> : glyph)}
      <canvas
        ref={canvasRef}
        css={{
          display: ready ? 'block' : 'none',
          maxWidth: '100%'
        }}
      />
    </div>
  );
});

// Composer chip: thumbnail or typed icon + truncated name, failed badge,
// per-chip remove, no processing indicator (builder parity, in-flight shows
// on the optimistic message thumbnail)
export const AttachmentChip = ({
  attachment,
  onRemove
}: {
  attachment: AssistantAttachment;
  onRemove: () => void;
}) => {
  const mediaType = attachment.uploadedMediaType ?? attachment.file.type;
  const filename = attachment.uploadedFilename ?? attachment.file.name;
  const failed = attachment.processingStatus === 'failed';

  return (
    <div
      css={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 6px',
        border: `1px solid ${failed ? '#fca5a5' : GRAY_200}`,
        borderRadius: '8px',
        backgroundColor: 'white',
        maxWidth: '160px',
        flexShrink: 0
      }}
    >
      {isImageType(mediaType) ? (
        <img
          src={attachment.previewUrl}
          alt={filename}
          css={{
            width: '28px',
            height: '28px',
            objectFit: 'cover',
            borderRadius: '4px',
            flexShrink: 0
          }}
        />
      ) : (
        <TypedFileIcon mediaType={mediaType} filename={filename} size={24} />
      )}
      <div css={{ minWidth: 0 }}>
        <div
          css={{
            fontSize: '11px',
            color: GRAY_800,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {filename}
        </div>
        {failed && (
          <div css={{ fontSize: '10px', color: '#dc2626' }}>Index failed</div>
        )}
      </div>
      <button
        type='button'
        onClick={onRemove}
        aria-label='Remove attachment'
        css={{
          position: 'absolute',
          top: '-6px',
          right: '-6px',
          width: '16px',
          height: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          border: `1px solid ${GRAY_200}`,
          backgroundColor: 'white',
          color: GRAY_800,
          cursor: 'pointer',
          padding: 0,
          '& svg': { width: '10px', height: '10px' }
        }}
      >
        <CloseIcon />
      </button>
    </div>
  );
};

// Attachment in a sent message: images inline, docs via the page-1
// thumbnail (converted docs point at a PDF), click opens the viewer
// overlay, in-flight uploads dim under a spinner
export const MessageAttachment = ({
  mediaType,
  filename,
  url,
  onOpen,
  inFlight = false
}: {
  mediaType: string;
  filename?: string;
  url: string;
  onOpen: () => void;
  inFlight?: boolean;
}) => {
  // Persisted attachment URLs are time-limited presigns, old history falls
  // back to the doc icon instead of a broken image
  const [imgErrored, setImgErrored] = useState(false);
  const content = isImageType(mediaType) ? (
    !imgErrored ? (
      <img
        src={url}
        alt={filename ?? 'attachment'}
        onError={() => setImgErrored(true)}
        css={{
          maxWidth: '140px',
          maxHeight: '112px',
          borderRadius: '8px',
          objectFit: 'cover',
          display: 'block'
        }}
      />
    ) : (
      <div
        css={{
          width: '140px',
          height: '112px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '8px',
          border: `1px solid ${GRAY_200}`,
          backgroundColor: GRAY_100,
          color: GRAY_400
        }}
      >
        <DocumentIcon />
      </div>
    )
  ) : (
    <LazyPdfThumbnail
      url={url}
      width={140}
      glyph={
        inFlight ? null : (
          <TypedFileIcon mediaType={mediaType} filename={filename} size={28} />
        )
      }
    />
  );
  return (
    <div
      onClick={inFlight ? undefined : onOpen}
      title={filename}
      css={{ position: 'relative', cursor: inFlight ? 'default' : 'pointer' }}
    >
      <div css={{ opacity: inFlight ? 0.6 : 1 }}>{content}</div>
      {inFlight && (
        <div
          css={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <SpinnerIcon />
        </div>
      )}
    </div>
  );
};

export type AttachmentPreview = {
  url: string;
  mediaType: string;
  filename?: string;
};

// Full-size viewer overlay, builder parity: PDFs via the browser's native
// iframe viewer, images inline, filename pill below, dismiss on backdrop
// click or Escape
export const AttachmentPreviewOverlay = ({
  preview,
  onClose
}: {
  preview: AttachmentPreview;
  onClose: () => void;
}) => {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    featheryDoc().addEventListener('keydown', onKeyDown);
    return () => featheryDoc().removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      css={{
        position: 'fixed',
        inset: 0,
        zIndex: 1002,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.6)'
      }}
    >
      {preview.mediaType === 'application/pdf' ? (
        <iframe
          src={preview.url}
          title={preview.filename ?? 'PDF preview'}
          onClick={(e) => e.stopPropagation()}
          css={{
            height: '85vh',
            width: '85vw',
            maxWidth: '1000px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: 'white'
          }}
        />
      ) : (
        <img
          src={preview.url}
          alt={preview.filename ?? 'Image preview'}
          onClick={(e) => e.stopPropagation()}
          onError={onClose}
          css={{
            maxHeight: '85vh',
            maxWidth: '85vw',
            borderRadius: '8px',
            objectFit: 'contain'
          }}
        />
      )}
      {preview.filename && (
        <span
          css={{
            marginTop: '12px',
            maxWidth: '85vw',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            borderRadius: '9999px',
            backgroundColor: 'white',
            padding: '4px 12px',
            fontSize: '13px',
            color: GRAY_800
          }}
        >
          {preview.filename}
        </span>
      )}
    </div>
  );
};
