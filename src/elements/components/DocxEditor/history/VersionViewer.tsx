import React, { useEffect, useRef, useState } from 'react';

import { INK_3, PAPER } from '../TrackedChangeGroups/styles';
import { loadStyles, waitForDocumentLoad, waitForEj } from '../ejLoader';
import { stampMissingContentControlColors } from '../contentControlSafety';
import { installRevisionHighlightRendering } from '../useDocxEditor';
import { useVersionDocument } from './useVersionDocument';
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
  onMeta
}: Props) {
  const hostElRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<any>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const doc = useVersionDocument(host, version);

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

  // Create the bare read-only editor once.
  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    (async () => {
      const ej = await waitForEj();
      loadStyles();
      if (cancelled || !hostElRef.current) return;
      const viewer = new ej.documenteditor.DocumentEditor({
        isReadOnly: true,
        enableSelection: true,
        enableSfdtExport: true,
        enableEditorHistory: false,
        enableAutoFocus: false,
        // A bare DocumentEditor defaults to a fixed ~200px height; fill the
        // host element (which is inset:0 in the pane) instead.
        height: '100%',
        width: '100%',
        serviceUrl: serviceUrl || '',
        documentEditorSettings: { optimizeSfdt: false }
      });
      if (headers) viewer.headers = headers;
      viewer.appendTo(hostElRef.current);
      viewer.resize();
      editorRef.current = viewer;
      setEditorReady(true);

      // Keep it full-height as the pane changes (window resize, panel toggle).
      try {
        observer = new ResizeObserver(() => {
          try {
            editorRef.current?.resize();
          } catch {
            /* editor torn down mid-resize */
          }
        });
        observer.observe(hostElRef.current);
      } catch {
        /* ResizeObserver unavailable: the initial resize still fills it */
      }
    })();
    return () => {
      cancelled = true;
      try {
        observer?.disconnect();
      } catch {
        /* no-op */
      }
      try {
        editorRef.current?.destroy();
      } catch {
        /* already torn down */
      }
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
        if (!doc.degraded && highlightsOn) {
          try {
            installRevisionHighlightRendering(viewer);
            viewer.showRevisions = true;
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
        stampMissingContentControlColors(viewer);
        // Recompute against the now-laid-out pane before fitting the page, so
        // the editor fills the full container height rather than a stale size.
        viewer.resize();
        viewer.fitPage?.('FitPageWidth');
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
      <div ref={hostElRef} css={{ position: 'absolute', inset: 0 }} />
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
