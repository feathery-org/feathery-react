import React, { useCallback, useEffect, useRef, useState } from 'react';
import { featheryDoc } from '../../../utils/browser';
import DocxToolbar from './DocxToolbar';
import { CheckIcon, CloseIcon } from './icons';
import { TOOLBAR_HEIGHT } from './DocxToolbar/styles';
import DocumentPanel, { PanelTab } from './DocumentPanel';
import PanelRail from './PanelRail';
import { DocxBindingsConfig, useDocxEditor } from './useDocxEditor';
import { DocxSource } from './types';

// Re-exported for tests that import it from this module.
export { RailErrorBoundary } from './RailErrorBoundary';

type ActivePanel = PanelTab | null;

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
  terminalAction?: 'download' | 'sign' | 'draft';
  onTerminalAction?: (saveResult?: unknown) => void | Promise<void>;
  /** Draft variant of the 'sign' terminal action (DocuSign only). When
   *  provided, Sign becomes a Send / Save as Draft menu. Same save-first flow. */
  onTerminalActionDraft?: (saveResult?: unknown) => void | Promise<void>;
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
  /** Opt-in document bindings: [[...]] tokens become live fields and formulas
   *  that recalculate as the document is edited. Omitting it changes nothing. */
  bindings?: DocxBindingsConfig;
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
  onTerminalActionDraft,
  terminalActionDisabled,
  terminalActionLoading,
  className,
  openNonce,
  onReady,
  onEditorReady,
  onChange,
  onError,
  onSave,
  bindings
}: DocxEditorProps) {
  const dirtyRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // Brief feedback shown after an explicit Save — the button otherwise gives
  // no sign of whether the document actually persisted.
  const [saveToast, setSaveToast] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const saveToastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const [terminalRunning, setTerminalRunning] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  // The single right-rail slot shows at most one panel, toggled from the
  // toolbar's two buttons (Changes / Sections).
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  // Pending tracked-change count, reported by the (always-mounted) rail; drives
  // the toolbar's Changes badge and whether that button is offered at all.
  const [changesCount, setChangesCount] = useState(0);

  // A single dirty transition. Shared by ordinary edits (via the hook's
  // onDirty) and the section reorder, whose programmatic open() does not
  // reliably fire the gated contentChange.
  const markDirty = useCallback(() => {
    if (!dirtyRef.current) {
      dirtyRef.current = true;
      setDirty(true);
      onChange?.(true);
    }
  }, [onChange]);

  const {
    containerRef,
    editor,
    loading,
    error,
    exportDoc,
    bindings: bindingsState
  } = useDocxEditor({
    source,
    licenseKey,
    serviceUrl,
    headers,
    readOnly,
    reviewChanges,
    openNonce,
    onReady,
    onEditorReady,
    onDirty: markDirty,
    onError,
    bindings
  });

  // The Changes button is only offered while changes are pending; if they all
  // resolve while its panel is open, close it so the empty slot doesn't linger.
  useEffect(() => {
    if (activePanel === 'changes' && changesCount === 0) setActivePanel(null);
  }, [activePanel, changesCount]);

  /**
   * Reconcile anything uncommitted before bytes leave the editor, and refuse to
   * export a document the engine considers wrong - an invalid number or an
   * ambiguous edit would otherwise be persisted as if it were fine. Reported
   * through onError so the host surfaces it the same way it surfaces every other
   * editor failure.
   */
  const readyToExport = (): boolean => {
    if (!bindingsState.ready) return true;
    if (bindingsState.commitForSave()) return true;
    const detail = bindingsState.diagnostics
      .filter((entry) => entry.severity === 'error')
      .map((entry) => entry.message);
    console.error('Feathery: document has unresolved binding errors', detail);
    onError?.(
      detail.length
        ? `This document cannot be saved yet: ${detail[0]}`
        : 'This document cannot be saved yet.'
    );
    return false;
  };

  // Which editor instance the rail is showing. Derived, not state: a recreation
  // must remount the rail's boundary in the same render that swaps the editor.
  const railGenerationRef = useRef({ editor: null as any, count: 0 });
  if (railGenerationRef.current.editor !== editor)
    railGenerationRef.current = {
      editor,
      count: railGenerationRef.current.count + 1
    };
  const railGeneration = railGenerationRef.current.count;

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

  // Flash a save toast and auto-dismiss it. Re-showing while one is already up
  // resets the timer so a second save reads as fresh feedback. Errors linger a
  // little longer than the success confirmation.
  const flashSaveToast = (type: 'success' | 'error', message: string) => {
    setSaveToast({ type, message });
    if (saveToastTimer.current) clearTimeout(saveToastTimer.current);
    saveToastTimer.current = setTimeout(
      () => setSaveToast(null),
      type === 'error' ? 5000 : 2500
    );
  };

  useEffect(
    () => () => {
      if (saveToastTimer.current) clearTimeout(saveToastTimer.current);
    },
    []
  );

  const handleSave = async () => {
    if (!readyToExport()) return;
    try {
      await saveCurrentDocument(await exportDoc());
      flashSaveToast('success', 'Document saved');
    } catch (err) {
      flashSaveToast('error', 'Could not save document');
      onError?.((err as Error).message || String(err));
    }
  };

  const handleDownload = async () => {
    if (!readyToExport()) return;
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
    if (!readyToExport()) return;
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

  // Every terminal action saves the current edits first, then runs its own
  // outcome against the just-saved document.
  const saveThenRun = async (
    run: (blob: Blob, saveResult?: unknown) => void | Promise<void>
  ) => {
    // Gated here rather than per-handler: this is the single funnel every
    // terminal action goes through, so a document the binding engine considers
    // invalid cannot be signed, sent or downloaded from any of them.
    if (!readyToExport()) return;
    setTerminalRunning(true);
    try {
      const blob = await exportDoc();
      const saveResult =
        onSave && dirtyRef.current
          ? await saveCurrentDocument(blob)
          : undefined;
      await run(blob, saveResult);
    } catch (err) {
      onError?.((err as Error).message || String(err));
    } finally {
      setTerminalRunning(false);
    }
  };

  const handleTerminalAction = () =>
    saveThenRun(async (blob, saveResult) => {
      if (terminalAction === 'download') {
        // Download the just-saved bytes directly (avoids the stale-URL issue
        // of re-fetching an overwritten envelope file).
        triggerDownload(blob);
      } else {
        await onTerminalAction?.(saveResult);
      }
    });

  // Draft variant of the 'sign' terminal action: identical save-first flow, and
  // the host sends the document to DocuSign as a draft instead of for signature.
  const handleTerminalActionDraft = () =>
    saveThenRun((_blob, saveResult) => onTerminalActionDraft?.(saveResult));

  // PDF variant of the 'download' terminal action — same save-first flow,
  // then the host-converted PDF bytes.
  const handleTerminalActionPdf = async () => {
    if (!readyToExport()) return;
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
          onTerminalActionDraft={
            terminalAction === 'sign' && onTerminalActionDraft
              ? handleTerminalActionDraft
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
        {/* Shared side panel; its title follows the rail icon that opened it
            (Suggested changes · Sections). Stays mounted while review is on so
            its pending count keeps the edge-rail badge live; collapses to zero
            width when no panel is open. */}
        {editor && (
          <DocumentPanel
            editor={editor}
            open={activePanel !== null}
            tab={activePanel ?? 'sections'}
            onClose={() => setActivePanel(null)}
            reviewChanges={!!reviewChanges}
            onChangesCount={setChangesCount}
            markDirty={markDirty}
            boundaryKey={`${railGeneration}:${openNonce ?? 0}`}
          />
        )}
        {/* Slim edge rail on the far right: one icon per side panel. Always
            present so a panel is one click away and future panels can slot in. */}
        {editor && (
          <PanelRail
            activePanel={activePanel}
            showChanges={!!reviewChanges}
            changesCount={changesCount}
            onToggle={(panel) =>
              setActivePanel((p) => (p === panel ? null : panel))
            }
          />
        )}
      </div>
      {/* Save feedback. Positioned over the editor, bottom-center, and
          auto-dismissed. Styled to match the Feathery dashboard toast: white
          surface, thin zinc border, dark text, fixed width. The tick sits at
          the far left (task-view style) while the copy stays centered. */}
      {saveToast && (
        <div
          role='status'
          aria-live={saveToast.type === 'error' ? 'assertive' : 'polite'}
          css={{
            position: 'absolute',
            bottom: 40,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 356,
            maxWidth: 'calc(100% - 32px)',
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: 12,
            borderRadius: 6,
            background: '#fff',
            color: '#27272a',
            border: '1px solid #e4e4e7',
            fontSize: 14,
            fontWeight: 400,
            lineHeight: 1.4,
            boxShadow:
              '0 0 0 1px rgb(0 9 50 / 3%), 0 12px 32px -16px rgb(0 9 50 / 12%)',
            zIndex: 20,
            pointerEvents: 'none'
          }}
        >
          {saveToast.type === 'success' ? (
            <CheckIcon
              width={16}
              height={16}
              css={{
                position: 'absolute',
                left: 12,
                top: '50%',
                transform: 'translateY(-50%)'
              }}
            />
          ) : (
            <CloseIcon
              width={16}
              height={16}
              css={{
                position: 'absolute',
                left: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#ef4444'
              }}
            />
          )}
          {saveToast.message}
        </div>
      )}
    </div>
  );
}

export default DocxEditor;
