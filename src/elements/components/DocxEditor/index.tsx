import React, { useRef, useState } from 'react';
import { featheryDoc } from '../../../utils/browser';
import DocxToolbar from './DocxToolbar';
import { TOOLBAR_HEIGHT } from './DocxToolbar/styles';
import TrackedChangeGroups from './TrackedChangeGroups';
import { useDocxEditor } from './useDocxEditor';
import { DocxSource } from './types';

export interface DocxEditorProps {
  /** Document to open. `buffer` when the host already fetched the bytes (e.g.
   *  an authenticated download); `url` for the component to fetch directly. */
  source?: DocxSource;
  /** Base name (no extension) used for save/download. */
  fileName?: string;
  /** Syncfusion license key — injected, never committed to this library.
   *  Optional when the Word Processor license is configured server-side. */
  licenseKey?: string;
  /** Base URL of the Document Editor web service (Feathery proxy or direct).
   *  Required to OPEN a .docx (DOCX↔SFDT conversion happens server-side). */
  serviceUrl?: string;
  /** Extra headers for serviceUrl requests (e.g. Feathery Authorization). */
  headers?: Record<string, string>[];
  readOnly?: boolean;
  /** Enables the assistant tracked-change review rail and its editor hooks. */
  reviewChanges?: boolean;
  /** Controlled reveal. When explicitly false the editor is unmounted. */
  visible?: boolean;
  /** Hide the local Download button (shown by default). */
  hideDownload?: boolean;
  /** Returns the current document as PDF bytes (converted by the host, e.g.
   *  the Feathery backend). When provided, Download becomes a DOCX/PDF menu.
   *  Current edits are saved via `onSave` before this is called. */
  onExportPdf?: () => Promise<Blob>;
  terminalAction?: 'download' | 'sign';
  onTerminalAction?: (saveResult?: unknown) => void | Promise<void>;
  terminalActionDisabled?: boolean;
  terminalActionLoading?: boolean;
  className?: string;
  /** Bump to force a reopen of the same source URL (e.g. after regenerate). */
  openNonce?: number;
  onReady?: () => void;
  /** Live DocumentEditor instance, for programmatic control (e.g. the AI
   *  assistant drives the document directly through this). */
  onEditorReady?: (editor: any) => void;
  /** Fired with the current dirty state (true on edits, false after a save). */
  onChange?: (dirty: boolean) => void;
  onError?: (error: string) => void;
  /** Persistence boundary: receives the exported .docx. The host decides where
   *  it goes (the component never persists on its own). */
  onSave?: (blob: Blob) => unknown | Promise<unknown>;
}

const overlay = {
  position: 'absolute' as const,
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 14,
  background: 'rgba(255,255,255,0.75)',
  color: '#3f3f46'
};

// The review rail is an overlay on the document — no failure inside it may
// take down the host form. Without this, a teardown race against a destroyed
// Syncfusion instance (step navigation, remount) escapes to the form's own
// boundary and ejects the user from their step. Exported for tests.
export class RailErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn(
      'Feathery: tracked-changes panel failed and was hidden.',
      error
    );
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// Reusable Syncfusion DOCX editor: custom toolbar + inline editing in one unit
// that fills its container and manages its own overflow. Syncfusion loads from
// the CDN at runtime (no bundle bloat) and renders directly in the page (no
// iframe), so the toolbar and the AI assistant drive the editor via its API.
// I/O-agnostic — bytes in via `source`, bytes out via `onSave`; no Feathery API.
function DocxEditor({
  source,
  fileName = 'document',
  licenseKey,
  serviceUrl,
  headers,
  readOnly,
  reviewChanges = false,
  visible = true,
  hideDownload,
  onExportPdf,
  terminalAction,
  onTerminalAction,
  terminalActionDisabled,
  terminalActionLoading,
  className,
  openNonce,
  onReady,
  onEditorReady,
  onChange,
  onError,
  onSave
}: DocxEditorProps) {
  const dirtyRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [terminalRunning, setTerminalRunning] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  // Shared by the panel's drawer handle, its ✕, and clicking an inline
  // tracked change (which re-shows the panel).
  const [changesPanelHidden, setChangesPanelHidden] = useState(false);

  const { containerRef, editor, loading, error, exportDoc } = useDocxEditor({
    source,
    licenseKey,
    serviceUrl,
    headers,
    readOnly,
    reviewChanges,
    openNonce,
    onReady,
    onEditorReady,
    onDirty: () => {
      if (!dirtyRef.current) {
        dirtyRef.current = true;
        setDirty(true);
        onChange?.(true);
      }
    },
    onError
  });

  const triggerDownload = (blob: Blob, extension: 'docx' | 'pdf' = 'docx') => {
    const doc = featheryDoc();
    const url = URL.createObjectURL(blob);
    const a = doc.createElement('a');
    const base = fileName.replace(/\.(docx|pdf)$/i, '');
    a.href = url;
    a.download = `${base}.${extension}`;
    doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Persist the given (already-exported) bytes to the host. Reuses the caller's
  // blob so download/terminal flows export exactly once and save the same bytes
  // they hand back to the user.
  const saveCurrentDocument = async (blob: Blob) => {
    if (!onSave) return;
    setSaving(true);
    try {
      const result = await onSave(blob);
      dirtyRef.current = false;
      setDirty(false);
      onChange?.(false);
      return result;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    try {
      await saveCurrentDocument(await exportDoc());
    } catch (err) {
      onError?.((err as Error).message || String(err));
    }
  };

  const handleDownload = async () => {
    try {
      // Write the current edits to the envelope BEFORE downloading, then hand
      // back the exact bytes we exported — never a re-fetched (and possibly
      // cache-stale) file URL.
      const blob = await exportDoc();
      if (onSave && dirtyRef.current) await saveCurrentDocument(blob);
      triggerDownload(blob);
    } catch (err) {
      onError?.((err as Error).message || String(err));
    }
  };

  const handleDownloadPdf = async () => {
    if (!onExportPdf) return;
    setExportingPdf(true);
    try {
      // The host converts the SAVED document, so persist current edits first —
      // the PDF must match what's on screen.
      const blob = await exportDoc();
      if (onSave && dirtyRef.current) await saveCurrentDocument(blob);
      triggerDownload(await onExportPdf(), 'pdf');
    } catch (err) {
      onError?.((err as Error).message || String(err));
    } finally {
      setExportingPdf(false);
    }
  };

  const handleTerminalAction = async () => {
    setTerminalRunning(true);
    try {
      const blob = await exportDoc();
      const saveResult =
        onSave && dirtyRef.current
          ? await saveCurrentDocument(blob)
          : undefined;
      if (terminalAction === 'download') {
        // Download the just-saved bytes directly (avoids the stale-URL issue
        // of re-fetching an overwritten envelope file).
        triggerDownload(blob);
      } else {
        await onTerminalAction?.(saveResult);
      }
    } catch (err) {
      onError?.((err as Error).message || String(err));
    } finally {
      setTerminalRunning(false);
    }
  };

  // PDF variant of the 'download' terminal action — same save-first flow,
  // then the host-converted PDF bytes.
  const handleTerminalActionPdf = async () => {
    setTerminalRunning(true);
    try {
      await handleDownloadPdf();
    } finally {
      setTerminalRunning(false);
    }
  };

  if (!visible) return null;

  return (
    <div
      className={className}
      css={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
        background: '#fff'
      }}
    >
      {/* Reserve the toolbar's space until it mounts (it needs `editor`), so its
          arrival doesn't shrink the editor pane mid-load. */}
      {!editor && <div css={{ height: TOOLBAR_HEIGHT, flex: '0 0 auto' }} />}
      {editor && (
        <DocxToolbar
          editor={editor}
          // Save stays visible even alongside a terminal action so users can
          // persist edits without committing to download/sign.
          onSave={onSave ? handleSave : undefined}
          // Secondary Download only when no terminal action owns downloading.
          onDownload={
            hideDownload || terminalAction ? undefined : handleDownload
          }
          onDownloadPdf={
            hideDownload || terminalAction || !onExportPdf
              ? undefined
              : handleDownloadPdf
          }
          downloadBusy={exportingPdf}
          terminalAction={terminalAction}
          onTerminalAction={onTerminalAction ? handleTerminalAction : undefined}
          onTerminalActionPdf={
            terminalAction === 'download' && onExportPdf
              ? handleTerminalActionPdf
              : undefined
          }
          terminalActionDisabled={
            !!terminalActionDisabled || saving || terminalRunning
          }
          terminalActionLoading={!!terminalActionLoading || terminalRunning}
          saving={saving}
          dirty={dirty}
          readOnly={readOnly}
        />
      )}
      <div css={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div css={{ flex: 1, minWidth: 0, position: 'relative' }}>
          {/* Syncfusion mounts its editor into this element. */}
          <div
            ref={containerRef}
            css={{
              width: '100%',
              height: '100%',
              // Syncfusion's status-bar page control renders the "Page" label,
              // the number input, and "of N" on a line but the input box is
              // taller than the text and sits low. Flex-center the whole
              // control and normalize the input box (height/line-height/
              // margin) so all three align on one baseline. Scoped to this
              // editor's DOM.
              '& .e-de-ctnr-pagenumber': {
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4
              },
              '& .e-de-ctnr-pagenumber .e-input-group': {
                margin: 0,
                alignSelf: 'center'
              },
              '& .e-de-pagenumber-input': {
                height: 22,
                minHeight: 22,
                lineHeight: '22px',
                padding: '0 4px',
                margin: 0,
                boxSizing: 'border-box',
                textAlign: 'center'
              },
              '& .e-de-pagenumber-text': {
                display: 'inline-flex',
                alignItems: 'center',
                lineHeight: '22px'
              }
            }}
          />
          {loading && !error && <div css={overlay}>Loading document…</div>}
          {error && <div css={{ ...overlay, color: '#dc2626' }}>{error}</div>}
        </div>
        {/* Grouped review cards for assistant-authored tracked changes.
            Read-only hosts cannot resolve revisions, so no panel there. */}
        {editor && reviewChanges && (
          <RailErrorBoundary>
            <TrackedChangeGroups
              editor={editor}
              hidden={changesPanelHidden}
              onHiddenChange={setChangesPanelHidden}
            />
          </RailErrorBoundary>
        )}
      </div>
    </div>
  );
}

export default DocxEditor;
