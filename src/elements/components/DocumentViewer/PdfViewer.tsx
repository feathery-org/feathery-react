import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import DocumentCanvas from './DocumentCanvas';
import { useActivePage, pageKey } from './useActivePage';
import { useIsNarrowViewport } from './useIsNarrowViewport';
import ViewerSidebar from './sidebar';
import { featheryWindow } from '../../../utils/browser';
import { stepPageKey } from '../DocumentEditor/keyboard';

const MAX_PAGE_WIDTH = 900;
const CONTAINER_PADDING = 48;

/** One document the viewer renders, exactly as the backend's
 * build_envelope_viewer_payload emits it. */
export interface ViewerDocument {
  type: 'form';
  pdf_url: string;
  // The id finalize acts on.
  envelope_id?: string;
  // The filler's own signing token, present only when they sign this one.
  signer_id?: string | null;
  name?: string;
}

// What the hosting surface drives imperatively: persisting edited field
// values before it runs an outcome, and keyboard paging.
export interface PdfViewerApi {
  saveEditedDocuments: () => Promise<void>;
  stepPage: (delta: 1 | -1) => void;
}

interface PdfViewerProps {
  documents: ViewerDocument[];
  // Persist a PDF the filler edited in the viewer back to its envelope.
  // Absent = fields still render but edits are never persisted.
  onSaveEnvelopeFile?: (envelopeId: string, file: Blob) => Promise<any>;
  apiRef?: React.MutableRefObject<PdfViewerApi | null>;
  // Read-only pages paint widget values into the canvas and never mount the
  // live form layer, so nothing is editable and nothing dirties.
  readOnly?: boolean;
}

// The pdf renderer: a continuous page canvas with fillable AcroForm fields
// plus the document/page sidebar. Surface-agnostic — the overlay and the
// document-editor container both render it and wire their own toolbars.
export default function PdfViewer({
  documents,
  onSaveEnvelopeFile,
  apiRef,
  readOnly
}: PdfViewerProps) {
  const loadedDocs = useRef<Record<string, any>>({});
  const pageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [pageCounts, setPageCounts] = useState<Record<string, number>>({});
  const [pageWidth, setPageWidth] = useState(MAX_PAGE_WIDTH);

  const pageEntries = useMemo(
    () =>
      documents.flatMap((doc) =>
        Array.from({ length: pageCounts[doc.pdf_url] ?? 0 }, (_, i) => ({
          pdfUrl: doc.pdf_url,
          pageIndex: i,
          key: pageKey(doc.pdf_url, i)
        }))
      ),
    [documents, pageCounts]
  );
  const pageOrder = useMemo(() => pageEntries.map((p) => p.key), [pageEntries]);
  const { activeKey, observePage } = useActivePage(
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
        setPageWidth(Math.min(MAX_PAGE_WIDTH, width - CONTAINER_PADDING));
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Documents with field edits not yet saved to their envelope. Tracked via
  // pdf.js's annotationStorage modified flag: set on the first widget change,
  // cleared by saveDocument()/resetModified() — so a doc saved once and then
  // edited again goes dirty again.
  const dirtyDocs = useRef<Set<string>>(new Set());

  const onDocLoad = useCallback((pdfUrl: string, pdfProxy: any) => {
    loadedDocs.current[pdfUrl] = pdfProxy;
    const storage = pdfProxy.annotationStorage;
    if (storage) {
      storage.onSetModified = () => dirtyDocs.current.add(pdfUrl);
      storage.onResetModified = () => dirtyDocs.current.delete(pdfUrl);
    }
    setPageCounts((prev) => ({ ...prev, [pdfUrl]: pdfProxy.numPages }));
  }, []);

  // Write each dirty document's edited field values into its PDF
  // (pdf.js saveDocument serializes annotationStorage into the AcroForm) and
  // persist it to the envelope, so every outcome — download, sign, save —
  // acts on what the filler sees. saveDocument resets the storage's modified
  // flag, which clears the doc from dirtyDocs via onResetModified.
  const saveEditedDocuments = async () => {
    if (!onSaveEnvelopeFile) return;
    for (const doc of documents) {
      if (!doc.envelope_id || !dirtyDocs.current.has(doc.pdf_url)) continue;
      const pdfProxy = loadedDocs.current[doc.pdf_url];
      if (!pdfProxy) continue;
      const bytes = await pdfProxy.saveDocument();
      try {
        await onSaveEnvelopeFile(
          doc.envelope_id,
          new Blob([bytes], { type: 'application/pdf' })
        );
      } catch (e) {
        // saveDocument() already reset the modified flag; put the doc back so
        // retrying the toolbar action re-saves it instead of skipping it.
        dirtyDocs.current.add(doc.pdf_url);
        throw e;
      }
    }
  };

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

  const stepPage = useCallback(
    (delta: 1 | -1) => {
      const nextKey = stepPageKey(
        pageEntries.map((p) => p.key),
        activeKey,
        delta
      );
      const target = pageEntries.find((p) => p.key === nextKey);
      if (target) onNavigate(target.pdfUrl, target.pageIndex);
    },
    [pageEntries, activeKey, onNavigate]
  );

  // Refreshed every render so the surface always drives the latest state.
  if (apiRef) apiRef.current = { saveEditedDocuments, stepPage };

  return (
    <div css={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <ViewerSidebar
        documents={documents}
        pageCounts={pageCounts}
        pdfProxies={loadedDocs.current}
        activeKey={activeKey}
        onNavigate={onNavigate}
        isNarrow={isNarrow}
      />
      <div
        ref={scrollContainerRef}
        css={{ flex: 1, overflow: 'auto', padding: 24 }}
      >
        <DocumentCanvas
          documents={documents}
          pageWidth={pageWidth}
          onDocLoad={onDocLoad}
          registerPageRef={registerPageRef}
          readOnly={readOnly}
        />
      </div>
    </div>
  );
}
