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
import { useVersionDocument, VersionDocument } from './useVersionDocument';
import { DocxHistoryHost, DocxVersion } from './types';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

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
  degraded: boolean;
}

interface Props {
  host: DocxHistoryHost;
  version: DocxVersion;
  serviceUrl?: string;
  headers?: Record<string, string>[];
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
}

// A second, read-only DocumentEditor overlaid on the live editor's pane. It is
// never registered (the assistant/rail must not see it) and is destroyed on
// unmount — the parent keys it by version id so a new selection remounts it.
export default function VersionViewer({
  host,
  version,
  serviceUrl,
  headers,
  highlightsOn = true,
  liveDoc,
  onMeta,
  onViewerEditor
}: Props) {
  const hostElRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<any>(null);
  const editorRef = useRef<any>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  // With a live document (the in-progress current version — no stored files),
  // use it directly and skip the fetch. It carries the applyHunks display SFDT,
  // so the normal highlight path renders it exactly like a stored version.
  const fetched = useVersionDocument(host, liveDoc ? null : version);
  const doc = liveDoc ?? fetched;

  // Report the version's counts up to the bar once resolved.
  const onMetaRef = useRef(onMeta);
  onMetaRef.current = onMeta;
  const onViewerEditorRef = useRef(onViewerEditor);
  onViewerEditorRef.current = onViewerEditor;
  useEffect(() => {
    if (doc.loading) return;
    onMetaRef.current?.({
      editCount: doc.editCount,
      formatCount: doc.formatCount,
      pendingCount: doc.pendingCount,
      degraded: doc.degraded
    });
  }, [
    doc.loading,
    doc.editCount,
    doc.formatCount,
    doc.pendingCount,
    doc.degraded
  ]);

  // Switching versions reuses this editor (the parent no longer keys us by
  // version id), so re-cover with the loader the moment a new version starts
  // resolving — otherwise the previous document would linger under a stale
  // "ready" phase while the next one loads.
  useEffect(() => {
    if (doc.loading) setPhase('loading');
  }, [doc.loading]);

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
      containerRef.current = container;
      editorRef.current = ed;
      onViewerEditorRef.current?.(ed);
      setEditorReady(true);
    })();
    return () => {
      cancelled = true;
      onViewerEditorRef.current?.(null);
      try {
        containerRef.current?.destroy();
      } catch {
        /* already torn down */
      }
      containerRef.current = null;
      editorRef.current = null;
    };
    // serviceUrl/headers are stable for a given mount (the parent keys us by
    // version id), so the editor is created exactly once.
  }, []);

  // Open the resolved document once both the editor and the bytes are ready.
  useEffect(() => {
    const viewer = editorRef.current;
    if (!viewer || doc.loading) return undefined;
    if (doc.error) {
      setPhase('error');
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        // With highlights available and enabled, patch the renderer and show
        // revisions BEFORE opening so the first paint carries the highlights.
        const wantHighlights = !doc.degraded && highlightsOn;
        if (wantHighlights) {
          try {
            // Inline author-coloured highlights. showRevisions stays ON so the
            // re-inserted deleted text lays out (false would show the accepted
            // doc and hide deletions); the custom renderer overrides Syncfusion's
            // default track-change styling with our washes, and we keep the
            // Changes/review pane shut so no tracked-change panel appears.
            installRevisionHighlightRendering(viewer, colorForRevisionAuthor);
            viewer.showRevisions = true;
            closeTrackedChangeReviewPane();
          } catch {
            /* highlights are decoration; the document must still open */
          }
        }
        const loaded = waitForDocumentLoad(viewer);
        if (doc.sfdt) {
          viewer.open(doc.sfdt);
        } else if (doc.docxUrl) {
          const res = await fetch(doc.docxUrl, { cache: 'no-store' });
          const blob = new Blob([await res.arrayBuffer()], { type: DOCX_MIME });
          await viewer.openAsync(blob);
        } else {
          setPhase('error');
          return;
        }
        await loaded;
        if (cancelled) return;
        if (wantHighlights) {
          // Opening can re-open the review pane; keep it shut.
          closeTrackedChangeReviewPane();
        }
        // The raw-docx fallback still holds [[field]] / {{ jinja }} tokens (it
        // never went through the binding engine); populate them the way the live
        // editor does before showing the read-only version. The SFDT path is
        // already populated upstream in useVersionDocument.
        if (doc.docxUrl) {
          try {
            const parsed = JSON.parse(viewer.serialize());
            const populated = populateVersionBindings(parsed);
            if (populated !== parsed) {
              const reloaded = waitForDocumentLoad(viewer);
              viewer.open(JSON.stringify(populated));
              await reloaded;
              if (cancelled) return;
            }
          } catch {
            /* population is best-effort; show the raw document if it fails */
          }
        }
        stampMissingContentControlColors(viewer);
        const container = viewer.documentHelper?.viewerContainer as
          | HTMLElement
          | undefined;
        if (container) container.style.overflowAnchor = 'none';
        setPhase('ready');
      } catch {
        if (!cancelled) setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editorReady, doc.loading, doc.error, doc.sfdt, doc.docxUrl]);

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
