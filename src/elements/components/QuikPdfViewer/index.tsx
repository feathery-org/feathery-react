import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import DocumentCanvas from './DocumentCanvas';
import Toolbar from './Toolbar';
import { useActivePage, pageKey } from './useActivePage';
import { useFieldProgress } from './useFieldProgress';
import { useIsNarrowViewport } from './useIsNarrowViewport';
import ViewerSidebar from './sidebar';
import AlertBanner from './AlertBanner';
import { NativeFieldLayer, LoadedDoc } from './fieldLayer/NativeFieldLayer';
import { featheryDoc, featheryWindow } from '../../../utils/browser';

const MAX_PAGE_WIDTH = 900;
const CONTAINER_PADDING = 48;
const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export interface ViewerDocument {
  type: 'form' | 'attachment';
  pdf_url: string;
  form_id?: string;
  group_index?: number;
  form_name?: string;
  name?: string;
  position?: 'before' | 'after';
  id?: string;
}

export interface QuikViewerPayload {
  documents: ViewerDocument[];
  expires_at: string;
}

interface QuikPdfViewerProps {
  payload: QuikViewerPayload;
  action: Record<string, any>;
  client: any;
  setShow: (show: boolean) => void;
  onComplete: () => void;
}

export default function QuikPdfViewer({
  payload,
  action,
  client,
  setShow,
  onComplete
}: QuikPdfViewerProps) {
  const loadedDocs = useRef<Record<string, any>>({});
  const pageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [remountKey, setRemountKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pageCounts, setPageCounts] = useState<Record<string, number>>({});
  const [fitWidth, setFitWidth] = useState(MAX_PAGE_WIDTH);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const effectiveZoom = zoom === 'fit' ? 1 : zoom;
  const pageWidth = Math.round(fitWidth * effectiveZoom);
  const zoomIndex = ZOOM_LEVELS.indexOf(effectiveZoom);
  const canZoomIn = zoomIndex < ZOOM_LEVELS.length - 1;
  const canZoomOut = zoomIndex > 0;
  const zoomLabel = zoom === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`;
  const [attachments, setAttachments] = useState<
    { id: string; name: string; position: 'before' | 'after' }[]
  >(() =>
    payload.documents
      .filter((d) => d.type === 'attachment' && d.id)
      .map((d) => ({
        id: d.id as string,
        name: d.name ?? '',
        position: d.position ?? 'after'
      }))
  );
  const [addedDocuments, setAddedDocuments] = useState<ViewerDocument[]>([]);
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<string[]>(
    []
  );
  const [uploading, setUploading] = useState(false);

  const isExpired = useMemo(
    () => new Date(payload.expires_at).getTime() < Date.now(),
    [payload.expires_at]
  );
  const [expiredBanner, setExpiredBanner] = useState(isExpired);

  const visibleDocuments = useMemo(
    () =>
      [...payload.documents, ...addedDocuments].filter(
        (doc) =>
          doc.type !== 'attachment' ||
          !removedAttachmentIds.includes(doc.id ?? '')
      ),
    [payload.documents, addedDocuments, removedAttachmentIds]
  );

  const pageEntries = useMemo(
    () =>
      visibleDocuments.flatMap((doc) =>
        Array.from({ length: pageCounts[doc.pdf_url] ?? 0 }, (_, i) => ({
          pdfUrl: doc.pdf_url,
          pageIndex: i,
          key: pageKey(doc.pdf_url, i)
        }))
      ),
    [visibleDocuments, pageCounts]
  );
  const pageOrder = useMemo(() => pageEntries.map((p) => p.key), [pageEntries]);
  const { activeKey, activePageNumber, observePage } = useActivePage(
    scrollContainerRef,
    pageOrder
  );
  const isNarrow = useIsNarrowViewport();

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) {
        setFitWidth(Math.min(MAX_PAGE_WIDTH, width - CONTAINER_PADDING));
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const fieldLayer = useMemo(
    () =>
      new NativeFieldLayer(
        () =>
          visibleDocuments.map(
            (doc): LoadedDoc => ({
              doc,
              pdfProxy: loadedDocs.current[doc.pdf_url]
            })
          ),
        () => {
          loadedDocs.current = {};
          setRemountKey((k) => k + 1);
        }
      ),
    [visibleDocuments]
  );

  const docsLoadedKey = useMemo(
    () => JSON.stringify(pageCounts),
    [pageCounts]
  );
  const { requiredRemaining, jumpToNextField } = useFieldProgress(
    fieldLayer,
    scrollContainerRef,
    docsLoadedKey,
    remountKey
  );

  const onDocLoad = useCallback((pdfUrl: string, pdfProxy: any) => {
    loadedDocs.current[pdfUrl] = pdfProxy;
    setPageCounts((prev) => ({ ...prev, [pdfUrl]: pdfProxy.numPages }));
  }, []);

  const registerPageRef = useCallback(
    (pdfUrl: string, pageIndex: number, el: HTMLDivElement | null) => {
      pageRefs.current[pageKey(pdfUrl, pageIndex)] = el;
      observePage(pageKey(pdfUrl, pageIndex), el);
    },
    [observePage]
  );

  const onNavigate = useCallback((pdfUrl: string, pageIndex: number) => {
    const el = pageRefs.current[pageKey(pdfUrl, pageIndex)];
    if (!el) return;
    const reduceMotion = featheryWindow().matchMedia?.(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  }, []);

  const onAddAttachment = useCallback(
    async (file: File) => {
      const isPdf =
        file.type === 'application/pdf' ||
        file.name.toLowerCase().endsWith('.pdf');
      if (!isPdf) {
        setError('Attachments must be PDF files.');
        return;
      }
      setUploading(true);
      setError('');
      try {
        const result = await client.uploadQuikAttachment(file);
        setAttachments((prev) => [
          ...prev,
          { id: result.id, name: file.name, position: 'after' }
        ]);
        setAddedDocuments((prev) => [
          ...prev,
          {
            type: 'attachment',
            pdf_url: result.url,
            name: file.name,
            position: 'after',
            id: result.id
          }
        ]);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : 'Failed to upload attachment'
        );
      } finally {
        setUploading(false);
      }
    },
    [client]
  );

  const onRemoveAttachment = useCallback(
    (index: number) => {
      const removed = attachments[index];
      if (!removed) return;
      setAttachments((prev) => prev.filter((_, i) => i !== index));
      setRemovedAttachmentIds((prev) => [...prev, removed.id]);
    },
    [attachments]
  );

  const finalize = async (reviewAction: string) => {
    setBusy(true);
    setError('');
    try {
      if (reviewAction === 'sign') {
        const issues = await fieldLayer.validate();
        if (issues.length) {
          setError(
            `Please complete ${issues.length} required field(s) before signing.`
          );
          return;
        }
      }
      const fieldOverrides = await fieldLayer.getOverrides();
      const result = await client.finalizeQuikViewer({
        action,
        reviewAction,
        fieldOverrides,
        attachments
      });
      if (result?.status === 'error') {
        if (/expired/i.test(result.message ?? '')) setExpiredBanner(true);
        else setError(result.message);
      } else onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  // The merged download is generated server-side (Quik re-fill with the
  // current field values + attachments appended). Saving client-side via
  // pdf.js saveDocument() is broken for Quik's hybrid AcroForm fields: it
  // writes /V onto the widget kid instead of the field dict, so Chrome's
  // viewer shows the stale prefill when a field is focused.
  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const fieldOverrides = await fieldLayer.getOverrides();
      const result = await client.finalizeQuikViewer({
        action,
        reviewAction: 'download',
        fieldOverrides,
        attachments
      });
      if (result?.status === 'error') {
        if (/expired/i.test(result.message ?? '')) setExpiredBanner(true);
        else setError(result.message);
        return;
      }
      const fileUrl = result?.files?.[0];
      if (!fileUrl) {
        setError('Failed to generate the download.');
        return;
      }
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error('Failed to fetch the merged PDF');
      const url = URL.createObjectURL(await response.blob());
      const a = featheryDoc().createElement('a');
      a.href = url;
      const baseName =
        visibleDocuments.find((doc) => doc.form_name)?.form_name ?? 'documents';
      a.download = `${baseName}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const isSign = action.review_action === 'sign';
  return (
    <div
      css={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#f4f5f8'
      }}
    >
      <Toolbar
        title='Review Your Forms'
        onBack={() => setShow(false)}
        onReset={() => fieldLayer.reset()}
        onDownload={download}
        onSaveDraft={isSign ? () => finalize('draft') : undefined}
        onPrimary={() => finalize(isSign ? 'sign' : 'submit')}
        primaryLabel={isSign ? 'Sign' : 'Submit'}
        busy={busy}
        zoomLabel={zoomLabel}
        canZoomIn={canZoomIn}
        canZoomOut={canZoomOut}
        onZoomIn={() =>
          setZoom(ZOOM_LEVELS[Math.min(zoomIndex + 1, ZOOM_LEVELS.length - 1)])
        }
        onZoomOut={() => setZoom(ZOOM_LEVELS[Math.max(zoomIndex - 1, 0)])}
        onFitWidth={() => setZoom('fit')}
        activePage={activePageNumber}
        totalPages={pageOrder.length}
        requiredRemaining={requiredRemaining}
        onJumpToNextField={jumpToNextField}
        isNarrow={isNarrow}
      />
      {expiredBanner && (
        <AlertBanner message='This session has expired. Please close and reopen the viewer.' />
      )}
      {error && <AlertBanner message={error} onDismiss={() => setError('')} />}
      <div css={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div
          ref={scrollContainerRef}
          css={{ flex: 1, overflow: 'auto', padding: 24 }}
        >
          <DocumentCanvas
            documents={visibleDocuments}
            pageWidth={pageWidth}
            onDocLoad={onDocLoad}
            registerPageRef={registerPageRef}
            remountKey={remountKey}
          />
        </div>
        <ViewerSidebar
          documents={visibleDocuments}
          pageCounts={pageCounts}
          pdfProxies={loadedDocs.current}
          onNavigate={onNavigate}
          attachments={attachments}
          onAddAttachment={onAddAttachment}
          onRemoveAttachment={onRemoveAttachment}
          uploading={uploading}
          expiresAt={payload.expires_at}
        />
      </div>
    </div>
  );
}
