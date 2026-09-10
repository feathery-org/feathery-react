import React, { useEffect, useRef, useState } from 'react';

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

export interface VersionMeta {
  editCount?: number;
  formatCount?: number;
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
  onMeta
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
  useEffect(() => {
    if (doc.loading) return;
    onMetaRef.current?.({
      editCount: doc.editCount,
      formatCount: doc.formatCount,
      degraded: doc.degraded
    });
  }, [doc.loading, doc.editCount, doc.formatCount, doc.degraded]);

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
      setEditorReady(true);
    })();
    return () => {
      cancelled = true;
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
            closeTrackedChangeReviewPane(viewer);
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
          closeTrackedChangeReviewPane(viewer);
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
          height:100% resolves against it — mirrors the live editor's host. */}
      <div ref={hostElRef} css={{ width: '100%', height: '100%' }} />
      {phase !== 'ready' && (
        <div
          css={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255,255,255,0.75)',
            color: INK_3,
            fontSize: 14
          }}
        >
          {phase === 'error'
            ? 'Couldn’t load this version.'
            : 'Loading version…'}
        </div>
      )}
    </div>
  );
}
