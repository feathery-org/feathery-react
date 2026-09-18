import React, { useEffect, useRef, useState } from 'react';
import { keyframes } from '@emotion/react';

import { INK_3, PAPER } from '../TrackedChangeGroups/styles';
import { loadStyles, waitForDocumentLoad, waitForEj } from '../ejLoader';
import { stampMissingContentControlColors } from '../contentControlSafety';
import {
  closeTrackedChangeReviewPane,
  installRevisionHighlightRendering
} from '../useDocxEditor';
import { colorForRevisionAuthor } from './authorColors';
import { populateVersionBindings } from './populateVersionBindings';
import { normalizeForDiff } from './sfdtDiff';
import { useVersionDocument, VersionDocument } from './useVersionDocument';
import { DocxHistoryHost, DocxVersion } from './types';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Syncfusion still paints revision text with its native author colour when
// showRevisions is false. Open an accepted, revision-free copy for the plain
// view so the run's own characterFormat (including fontColor) remains in
// control. Keep image bytes intact because this copy is rendered, not diffed.
const acceptedSfdt = (sfdt: string): string => {
  try {
    return JSON.stringify(
      normalizeForDiff(JSON.parse(sfdt), { digestImages: false })
    );
  } catch {
    return sfdt;
  }
};

// Gentle pulse for the loading skeleton's placeholder lines.
const shimmer = keyframes({
  '0%': { opacity: 0.5 },
  '50%': { opacity: 1 },
  '100%': { opacity: 0.5 }
});

// A full-page document placeholder shown OPAQUELY over the editor while a
// version loads — so the reader never sees the bare editor (blank page +
// blinking caret) before the document paints. The card fills the pane height
// like a real page; line widths vary per paragraph so it reads like prose.
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
  host: DocxHistoryHost;
  version: DocxVersion;
  serviceUrl?: string;
  headers?: Record<string, string>[];
  /** Stable identity of this document's first human editor (orange). */
  firstUserKey?: string;
  /** Show tracked-change highlights (default true). Off opens the version with
   *  changes accepted (plain final state). The parent keys the viewer on this,
   *  so toggling remounts and re-opens. */
  highlightsOn?: boolean;
  /** A ready-resolved document to open directly, bypassing the version fetch.
   *  Used for the in-progress current version, which has no stored files yet:
   *  the parent supplies a live-diffed display document (highlights baked in via
   *  applyHunks) so it renders exactly like a stored version. */
  liveDoc?: VersionDocument;
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

// A second, read-only DocumentEditor overlaid on the live editor's pane. It is
// never registered (the assistant/rail must not see it). The parent reuses it
// between selections so its last painted page can remain visible while the next
// version resolves.
export default function VersionViewer({
  host,
  version,
  serviceUrl,
  headers,
  firstUserKey,
  highlightsOn = true,
  liveDoc,
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
  // With a live document (the in-progress current version — no stored files),
  // use it directly and skip the fetch. It carries the applyHunks display SFDT,
  // so the normal highlight path renders it exactly like a stored version.
  const fetched = useVersionDocument(host, liveDoc ? null : version);
  const doc = liveDoc ?? fetched;
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

  // Create the read-only editor once. Use a DocumentEditorContainer (as the
  // live editor does) rather than a bare DocumentEditor: the container reliably
  // fills a height:100% host and sizes its inner editor correctly, so the page
  // lays out at the right scale instead of appearing zoomed in.
  useEffect(() => {
    let cancelled = false;
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
      await new Promise<void>((resolve) => {
        container.addEventListener('created', () => resolve());
        container.appendTo(hostElRef.current);
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
    })();
    return () => {
      cancelled = true;
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
    // serviceUrl/headers are stable for a given mount (the parent keys us by
    // version id), so the editor is created exactly once.
  }, []);

  useEffect(() => {
    const viewer = editorRef.current;
    if (!viewer || !Number.isFinite(zoomFactor)) return;
    if (Math.abs(Number(viewer.zoomFactor) - Number(zoomFactor)) < 0.001)
      return;
    viewer.zoomFactor = zoomFactor;
    containerRef.current?.statusBar?.updateZoomContent?.();
  }, [editorReady, zoomFactor]);

  // Opens run strictly one after another. The viewer is reused across version
  // selections, and openAsync (the docx fallback) cannot be aborted mid-flight:
  // without the chain, a slow stale open lands AFTER the newer version's open
  // and paints the wrong (still-unpopulated) document over it.
  const openSeqRef = useRef(0);
  const openChainRef = useRef<Promise<void>>(Promise.resolve());

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
            // Inline author-coloured highlights. showRevisions stays ON so the
            // re-inserted deleted text lays out (false would show the accepted
            // doc and hide deletions); the custom renderer overrides Syncfusion's
            // default track-change styling with our washes, and we keep the
            // Changes/review pane shut so no tracked-change panel appears.
            installRevisionHighlightRendering(viewer, (author) =>
              colorForRevisionAuthor(
                author,
                versionActorKeyRef.current,
                firstUserKeyRef.current
              )
            );
            viewer.showRevisions = true;
            closeTrackedChangeReviewPane();
          } catch {
            /* highlights are decoration; the document must still open */
          }
        } else {
          viewer.showRevisions = false;
        }
        const loaded = waitForDocumentLoad(viewer);
        if (doc.sfdt) {
          viewer.open(showHighlights ? doc.sfdt : acceptedSfdt(doc.sfdt));
        } else if (doc.docxUrl) {
          // The import result still holds raw binding tokens until the populate
          // step below reopens it — hide the pane so they never paint.
          setPhase('loading');
          const res = await fetch(doc.docxUrl, { cache: 'no-store' });
          const blob = new Blob([await res.arrayBuffer()], { type: DOCX_MIME });
          await viewer.openAsync(blob);
        } else {
          setPhase('error');
          return;
        }
        if (!(await loaded))
          throw new Error('Version preview did not finish loading');
        if (cancelled) return;
        // Highlights off = the accepted (plain) view, explicitly and AFTER the
        // open: opening a document that carries tracked changes can flip
        // showRevisions back on natively, which would paint Syncfusion's own
        // author tints over the "plain" view.
        if (!showHighlights) {
          try {
            viewer.showRevisions = false;
          } catch {
            /* decoration only */
          }
        }
        // Opening can re-open the review pane; keep it shut.
        closeTrackedChangeReviewPane();
        // The raw-docx fallback still holds [[field]] / {{ jinja }} tokens (it
        // never went through the binding engine); populate them the way the live
        // editor does before showing the read-only version. The SFDT path is
        // already populated upstream in useVersionDocument.
        let populated = true;
        if (doc.docxUrl) {
          try {
            const parsed = JSON.parse(viewer.serialize());
            const populatedSfdt = populateVersionBindings(parsed);
            const displaySfdt = showHighlights
              ? populatedSfdt
              : normalizeForDiff(populatedSfdt, { digestImages: false });
            if (displaySfdt !== parsed) {
              const reloaded = waitForDocumentLoad(viewer);
              viewer.open(JSON.stringify(displaySfdt));
              populated = await reloaded;
              if (cancelled) return;
            }
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
    <div css={{ position: 'absolute', inset: 0, background: PAPER, zIndex: 2 }}>
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
          opacity: phase === 'ready' ? 1 : 0,
          transition: 'opacity 120ms ease'
        }}
      />
      {phase !== 'ready' && (
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
