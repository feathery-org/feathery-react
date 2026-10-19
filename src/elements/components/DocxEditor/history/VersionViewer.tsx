import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { keyframes } from '@emotion/react';

import { INK_3, PAPER } from '../TrackedChangeGroups/styles';
import { loadStyles, waitForDocumentLoad, waitForEj } from '../ejLoader';
import { stampMissingContentControlColors } from '../contentControlSafety';
import {
  closeTrackedChangeReviewPane,
  installRevisionHighlightRendering
} from '../useDocxEditor';
import { colorForRevisionAuthor } from './authorColors';
import { hiddenEditorConverter } from './convertOriginal';
import { populateVersionBindings } from './populateVersionBindings';
import { normalizeForDiff } from './sfdtDiff';
import {
  cacheImportedVersion,
  FoldedVersions,
  useVersionDocument,
  LiveVersionDocument
} from './useVersionDocument';
import { DocxHistoryHost, DocxVersion } from './types';
import { withDocumentDeadline } from '../../../../utils/documentPersistence';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// showRevisions=false still paints revision text in Syncfusion's author
// colour, so the plain view opens an accepted, revision-free copy instead.
const acceptedSfdt = (sfdt: string): string => {
  try {
    return JSON.stringify(
      normalizeForDiff(JSON.parse(sfdt), { digestImages: false })
    );
  } catch {
    return sfdt;
  }
};

// open() jumps to the document start; repaint at the reader's scroll in the
// same task. Don't restore selection: accepting deletions shifts offsets.
const preservePreviewViewport = (viewer: any, open: () => void): void => {
  const helper = viewer.documentHelper;
  const container = helper?.viewerContainer;
  if (!container) return open();
  const { scrollTop, scrollLeft } = container;
  const scrollToPosition = helper.scrollToPosition;
  const skipScrollToPosition = helper.skipScrollToPosition;
  helper.scrollToPosition = () => undefined;
  try {
    open();
  } finally {
    try {
      container.scrollTop = scrollTop;
      container.scrollLeft = scrollLeft;
      // Also refresh Syncfusion's virtualized canvas now, not in the next
      // scroll event / its deferred 50ms layout pass.
      viewer.viewer?.updateScrollBars?.();
    } finally {
      helper.scrollToPosition = scrollToPosition;
      helper.skipScrollToPosition = skipScrollToPosition;
    }
  }
};

// Gentle pulse for the loading skeleton's placeholder lines.
const shimmer = keyframes({
  '0%': { opacity: 0.5 },
  '50%': { opacity: 1 },
  '100%': { opacity: 0.5 }
});

// Opaque page placeholder over the editor while a version loads, so the bare
// editor (blank page + caret) never shows.
const SKELETON_PARAGRAPHS: number[][] = [
  [46, 100, 96, 90, 72],
  [100, 94, 98, 88, 64],
  [100, 90, 96, 82],
  [92, 100, 86, 70],
  [100, 88, 94, 60]
];

export interface VersionMeta {
  editCount?: number;
  formatCount?: number;
  /** Assistant edits still tracked (unapproved) in this version. */
  pendingCount?: number;
  /** Robin edit groups confirmed by accepting tracked changes in this version. */
  approvedCount?: number;
  degraded: boolean;
}

interface Props {
  /** Retain this document’s reading position when its inactive preview is released. */
  viewportRef?: {
    current: { versionId: string; top: number; left: number } | null;
  };
  host: DocxHistoryHost;
  version: DocxVersion;
  serviceUrl?: string;
  headers?: Record<string, string>[];
  /** Stable identity of this document's first human editor (orange). */
  firstUserKey?: string;
  /** Show tracked-change highlights (default true). Off opens the accepted
   *  final state in the same viewer, preserving its scroll position. */
  highlightsOn?: boolean;
  /** Pre-resolved document that skips the fetch; used for the unsaved current
   *  version, which has no stored files. */
  liveDoc?: LiveVersionDocument;
  /** Sessions folded under this row: their edits are shown together. */
  folded?: FoldedVersions | null;
  /** Reports the version's edit counts + whether highlights are available, so
   *  the version bar can label them. */
  onMeta?: (meta: VersionMeta) => void;
  /** Exposes the read-only editor once ready (null on unmount) so the version
   *  bar can step the caret through tracked changes. */
  onViewerEditor?: (editor: any | null) => void;
  /** Keeps the preview's footer zoom in sync with the editing surface. */
  zoomFactor?: number;
  onZoomFactorChange?: (zoomFactor: number) => void;
  /** Called only after this version has actually painted in the reused viewer. */
  onDisplayedVersion?: (version: DocxVersion) => void;
}

// Read-only editor overlaid on the live pane; never registered, so the
// assistant/rail can't see it. Reused across version selections.
export default function VersionViewer({
  host,
  viewportRef,
  version,
  serviceUrl,
  headers,
  firstUserKey,
  highlightsOn = true,
  liveDoc,
  folded,
  onMeta,
  onViewerEditor,
  zoomFactor,
  onZoomFactorChange,
  onDisplayedVersion
}: Props) {
  const hostElRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<any>(null);
  const editorRef = useRef<any>(null);
  const zoomHandlerRef = useRef<((args: any) => void) | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  // Fold the raw live session into earlier versions when showing a group;
  // its highlighted preview remains the fallback if the group cannot resolve.
  // A folded group right after the original starts from the converted upload.
  const convertDocx = useMemo(
    () => (serviceUrl ? hiddenEditorConverter(serviceUrl, headers) : undefined),
    [serviceUrl, headers]
  );
  const doc = useVersionDocument(host, version, folded, convertDocx, liveDoc);
  // Restores establish a clean baseline; embedded suggestions are reviewable
  // in the live editor, not replayed as edits in the restored history row.
  const isRestored = !!(version.restored_from || version.restored_from_at);
  const showHighlights = highlightsOn && !isRestored;
  const versionActorKeyRef = useRef(version.actor_label || version.actor_name);
  versionActorKeyRef.current = version.actor_label || version.actor_name;
  const firstUserKeyRef = useRef(firstUserKey);
  firstUserKeyRef.current = firstUserKey;

  // Report the version's counts up to the bar once resolved.
  const onMetaRef = useRef(onMeta);
  onMetaRef.current = onMeta;
  const onViewerEditorRef = useRef(onViewerEditor);
  onViewerEditorRef.current = onViewerEditor;
  const onZoomFactorChangeRef = useRef(onZoomFactorChange);
  onZoomFactorChangeRef.current = onZoomFactorChange;
  const onDisplayedVersionRef = useRef(onDisplayedVersion);
  onDisplayedVersionRef.current = onDisplayedVersion;

  // Capture before React removes the scroll container. Passive cleanup runs
  // after removal, when the browser has already reset scrollTop to zero.
  useLayoutEffect(
    () => () => {
      const viewport = editorRef.current?.documentHelper?.viewerContainer;
      if (viewportRef && viewport && displayedVersionIdRef.current) {
        viewportRef.current = {
          versionId: displayedVersionIdRef.current,
          top: viewport.scrollTop,
          left: viewport.scrollLeft
        };
      }
    },
    [viewportRef]
  );

  // Use a DocumentEditorContainer, not a bare DocumentEditor: only the
  // container sizes to a height:100% host, so the page isn't laid out zoomed.
  useEffect(() => {
    let cancelled = false;
    let cancelCreation: (() => void) | undefined;
    (async () => {
      const ej = await waitForEj();
      loadStyles();
      if (cancelled || !hostElRef.current) return;
      const container = new ej.documenteditor.DocumentEditorContainer({
        enableToolbar: false,
        showPropertiesPane: false,
        height: '100%',
        serviceUrl: serviceUrl || '',
        headers: headers || [],
        documentEditorSettings: { optimizeSfdt: false }
      });
      // Wait until Syncfusion finishes creating the inner DocumentEditor before
      // touching it — opening a doc before `created` leaves a blank default.
      containerRef.current = container;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => finish(new Error('Version viewer creation timed out')),
          20_000
        );
        const finish = (error?: Error) => {
          clearTimeout(timer);
          container.removeEventListener?.('created', created);
          cancelCreation = undefined;
          if (error) reject(error);
          else resolve();
        };
        const created = () => finish();
        cancelCreation = () => finish(new Error('Version viewer closed'));
        container.addEventListener('created', created);
        try {
          container.appendTo(hostElRef.current);
        } catch (error) {
          finish(error as Error);
        }
      });
      if (cancelled) {
        try {
          container.destroy();
        } catch {
          /* already torn down */
        }
        return;
      }
      const ed = container.documentEditor;
      ed.isReadOnly = true;
      ed.enableSfdtExport = true;
      ed.enableEditorHistory = false;
      ed.enableAutoFocus = false;
      const webButton = container.statusBar?.webButton;
      if (webButton?.style) webButton.style.display = 'none';
      const onZoom = (args: any) => {
        const next = Number(args?.zoomFactor ?? ed.zoomFactor);
        if (Number.isFinite(next)) onZoomFactorChangeRef.current?.(next);
      };
      ed.addEventListener?.('zoomFactorChange', onZoom);
      zoomHandlerRef.current = onZoom;
      containerRef.current = container;
      editorRef.current = ed;
      onViewerEditorRef.current?.(ed);
      setEditorReady(true);
    })().catch(() => {
      if (cancelled) return;
      try {
        containerRef.current?.destroy();
      } catch {
        /* partially created */
      }
      containerRef.current = null;
      setPhase('error');
    });
    return () => {
      cancelled = true;
      cancelCreation?.();
      onViewerEditorRef.current?.(null);
      try {
        if (zoomHandlerRef.current)
          editorRef.current?.removeEventListener?.(
            'zoomFactorChange',
            zoomHandlerRef.current
          );
        containerRef.current?.destroy();
      } catch {
        /* already torn down */
      }
      containerRef.current = null;
      editorRef.current = null;
      zoomHandlerRef.current = null;
    };
    // serviceUrl/headers are stable while history is open, so create once.
  }, []);

  useEffect(() => {
    const viewer = editorRef.current;
    if (!viewer || !Number.isFinite(zoomFactor)) return;
    if (Math.abs(Number(viewer.zoomFactor) - Number(zoomFactor)) < 0.001)
      return;
    viewer.zoomFactor = zoomFactor;
    containerRef.current?.statusBar?.updateZoomContent?.();
  }, [editorReady, zoomFactor]);

  useLayoutEffect(() => {
    setPhase('loading');
  }, [host, version.id]);

  // Opens run one at a time: openAsync can't be aborted, so a slow stale open
  // would otherwise paint over the newer version.
  const openSeqRef = useRef(0);
  const openChainRef = useRef<Promise<void>>(Promise.resolve());
  const displayedVersionIdRef = useRef<string | null>(null);

  // Open the resolved document once both the editor and the bytes are ready.
  useEffect(() => {
    if (!editorRef.current || doc.loading) return undefined;
    if (doc.error) {
      setPhase('error');
      return undefined;
    }
    let cancelled = false;
    const seq = ++openSeqRef.current;
    openChainRef.current = openChainRef.current.then(async () => {
      const viewer = editorRef.current;
      // A newer selection superseded this open while it queued, or unmounted.
      if (cancelled || seq !== openSeqRef.current || !viewer) return;
      try {
        // Non-restored versions may carry native suggestions without a diff.
        // Install our palette before their first paint; restores stay plain.
        if (showHighlights) {
          try {
            // showRevisions must stay on: false shows the accepted doc and
            // hides the re-inserted deletions.
            installRevisionHighlightRendering(
              viewer,
              (author) =>
                colorForRevisionAuthor(
                  author,
                  versionActorKeyRef.current,
                  firstUserKeyRef.current
                ),
              { showPendingOutline: true, showActiveRing: true }
            );
            viewer.showRevisions = true;
            closeTrackedChangeReviewPane();
          } catch {
            /* highlights are decoration; the document must still open */
          }
        } else {
          viewer.showRevisions = false;
        }
        let loaded: Promise<boolean>;
        if (doc.sfdt) {
          loaded = waitForDocumentLoad(viewer);
          if (doc.needsBindingPopulation) setPhase('loading');
          const sfdt =
            showHighlights || doc.needsBindingPopulation
              ? doc.sfdt
              : acceptedSfdt(doc.sfdt);
          if (displayedVersionIdRef.current === version.id) {
            preservePreviewViewport(viewer, () => viewer.open(sfdt));
          } else {
            viewer.open(sfdt);
          }
        } else if (doc.docxUrl) {
          // The import result still holds raw binding tokens until the populate
          // step below reopens it — hide the pane so they never paint.
          setPhase('loading');
          let bytes: ArrayBuffer;
          try {
            bytes = doc.docxBytes ?? (await host.fetchVersionFile(doc.docxUrl));
          } catch (error) {
            if (
              !host.getVersion ||
              ![403, 404].includes((error as any)?.status)
            )
              throw error;
            const fresh = await host.getVersion(version.id);
            const url = fresh.editor_file ?? fresh.file;
            if (!url) throw error;
            bytes = await host.fetchVersionFile(url);
          }
          if (cancelled) return;
          const blob = new Blob([bytes], { type: DOCX_MIME });
          loaded = waitForDocumentLoad(viewer);
          await withDocumentDeadline(() => viewer.openAsync(blob));
        } else {
          setPhase('error');
          return;
        }
        if (!(await loaded))
          throw new Error('Version preview did not finish loading');
        if (cancelled) return;
        // Apply the pending zoom property before restoring pixel offsets;
        // otherwise EJ2's deferred dataBind scales the restored position again.
        viewer.dataBind?.();
        const savedViewport = viewportRef?.current;
        if (
          !displayedVersionIdRef.current &&
          savedViewport?.versionId === version.id
        ) {
          const viewport = viewer.documentHelper?.viewerContainer;
          if (viewport) {
            viewport.scrollTop = savedViewport.top;
            viewport.scrollLeft = savedViewport.left;
            viewer.viewer?.updateScrollBars?.();
          }
        }
        // Re-apply after the open: opening a doc with tracked changes can flip
        // showRevisions back on and paint Syncfusion's author tints.
        if (!showHighlights) {
          try {
            viewer.showRevisions = false;
          } catch {
            /* decoration only */
          }
        }
        // Opening can re-open the review pane; keep it shut.
        closeTrackedChangeReviewPane();
        // The docx fallback still holds raw [[field]] / {{ jinja }} tokens; the
        // SFDT path was already populated in useVersionDocument.
        let populated = true;
        if (doc.docxUrl || doc.needsBindingPopulation) {
          try {
            const parsed = JSON.parse(viewer.serialize());
            const populatedSfdt = populateVersionBindings(parsed);
            const importedSfdt = JSON.stringify(populatedSfdt);
            const displaySfdt = showHighlights
              ? populatedSfdt
              : normalizeForDiff(populatedSfdt, { digestImages: false });
            if (displaySfdt !== parsed) {
              const reloaded = waitForDocumentLoad(viewer);
              viewer.open(JSON.stringify(displaySfdt));
              populated = await reloaded;
              if (cancelled) return;
            }
            if (populated) cacheImportedVersion(host, version, importedSfdt);
          } catch {
            /* population is best-effort; show the raw document if it fails */
          }
        }
        if (!populated)
          throw new Error('Version preview did not finish loading');
        if (!showHighlights) viewer.showRevisions = false;
        stampMissingContentControlColors(viewer);
        const container = viewer.documentHelper?.viewerContainer as
          | HTMLElement
          | undefined;
        if (container) container.style.overflowAnchor = 'none';
        displayedVersionIdRef.current = version.id;
        setPhase('ready');
        onMetaRef.current?.({
          editCount: isRestored ? undefined : doc.editCount,
          formatCount: isRestored ? undefined : doc.formatCount,
          pendingCount: isRestored ? undefined : doc.pendingCount,
          approvedCount: isRestored ? undefined : doc.approvedCount,
          degraded: doc.degraded || isRestored
        });
        onDisplayedVersionRef.current?.(version);
      } catch {
        if (!cancelled) setPhase('error');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    editorReady,
    doc.loading,
    doc.error,
    doc.sfdt,
    doc.docxUrl,
    showHighlights,
    isRestored,
    version.id
  ]);

  return (
    <div
      data-docx-version-id={version.id}
      data-docx-version-state={doc.loading ? 'loading' : phase}
      aria-busy={doc.loading || phase === 'loading'}
      css={{ position: 'absolute', inset: 0, background: PAPER, zIndex: 2 }}
    >
      {/* A normal block filling the overlay (not absolute) so the editor's
          height:100% resolves against it — mirrors the live editor's host.
          Kept invisible until the document has painted so the bare editor
          (blank page + caret) is never shown; it stays laid out so the editor
          still measures and sizes correctly. */}
      <div
        ref={hostElRef}
        css={{
          width: '100%',
          height: '100%',
          opacity: !doc.loading && phase === 'ready' ? 1 : 0,
          transition: 'opacity 120ms ease'
        }}
      />
      {(doc.loading || phase !== 'ready') && (
        <div
          css={{
            position: 'absolute',
            inset: 0,
            // Fully opaque: the editor never shows through while loading.
            background: PAPER,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '32px 0',
            overflow: 'hidden'
          }}
        >
          {phase === 'error' ? (
            <div
              css={{
                margin: 'auto',
                color: INK_3,
                fontSize: 14,
                textAlign: 'center'
              }}
            >
              Couldn’t load this version.
            </div>
          ) : (
            <React.Fragment>
              {/* A full-height page skeleton so the wait reads as "a document
                  is loading" and fills the pane like a real page — not a small
                  floating block. */}
              <div
                css={{
                  position: 'relative',
                  flex: '1 1 auto',
                  width: 'min(720px, 88%)',
                  padding: '48px 56px',
                  background: '#fff',
                  borderRadius: 6,
                  boxShadow: '0 1px 3px rgba(16,24,40,0.10)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 26,
                  overflow: 'hidden'
                }}
                aria-hidden
              >
                {SKELETON_PARAGRAPHS.map((para, pi) => (
                  <div
                    key={pi}
                    css={{ display: 'flex', flexDirection: 'column', gap: 12 }}
                  >
                    {para.map((w, li) => {
                      const isHeading = pi === 0 && li === 0;
                      return (
                        <div
                          key={li}
                          css={{
                            height: isHeading ? 20 : 12,
                            width: `${w}%`,
                            marginBottom: isHeading ? 10 : 0,
                            borderRadius: 4,
                            background: '#e6e8ec',
                            animation: `${shimmer} 1.2s ease-in-out infinite`,
                            animationDelay: `${(pi * 5 + li) * 80}ms`,
                            '@media (prefers-reduced-motion: reduce)': {
                              animation: 'none'
                            }
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
                <div
                  css={{
                    position: 'absolute',
                    bottom: 20,
                    left: 0,
                    right: 0,
                    textAlign: 'center',
                    color: INK_3,
                    fontSize: 13
                  }}
                >
                  Loading version…
                </div>
              </div>
            </React.Fragment>
          )}
        </div>
      )}
    </div>
  );
}
