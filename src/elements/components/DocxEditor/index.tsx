import React, { useRef, useState } from 'react';
import { featheryDoc } from '../../../utils/browser';
import DocxToolbar from './DocxToolbar';
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
  /** Controlled reveal. When explicitly false the editor is unmounted. */
  visible?: boolean;
  /** Hide the local Download button (shown by default). */
  hideDownload?: boolean;
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
  onSave?: (blob: Blob) => void | Promise<void>;
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
  visible = true,
  hideDownload,
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

  const { containerRef, editor, loading, error, exportDoc } = useDocxEditor({
    source,
    licenseKey,
    serviceUrl,
    headers,
    readOnly,
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

  const triggerDownload = (blob: Blob) => {
    const doc = featheryDoc();
    const url = URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = fileName.endsWith('.docx') ? fileName : `${fileName}.docx`;
    doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleSave = async () => {
    if (!onSave) return;
    setSaving(true);
    try {
      const blob = await exportDoc();
      await onSave(blob);
      dirtyRef.current = false;
      setDirty(false);
      onChange?.(false);
    } catch (err) {
      onError?.((err as Error).message || String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = async () => {
    try {
      triggerDownload(await exportDoc());
    } catch (err) {
      onError?.((err as Error).message || String(err));
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
      {editor && (
        <DocxToolbar
          editor={editor}
          onSave={onSave ? handleSave : undefined}
          onDownload={hideDownload ? undefined : handleDownload}
          saving={saving}
          dirty={dirty}
          readOnly={readOnly}
        />
      )}
      <div css={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {/* Syncfusion mounts its editor into this element. */}
        <div
          ref={containerRef}
          css={{
            width: '100%',
            height: '100%',
            // Syncfusion's status-bar page control renders the "Page" label,
            // the number input, and "of N" with mismatched vertical alignment.
            // Center them (scoped to this editor's DOM).
            '& .e-de-ctnr-pagenumber': {
              display: 'inline-flex',
              alignItems: 'center'
            },
            '& .e-de-pagenumber-input, & .e-de-pagenumber-text': {
              verticalAlign: 'middle'
            }
          }}
        />
        {loading && !error && <div css={overlay}>Loading document…</div>}
        {error && <div css={{ ...overlay, color: '#dc2626' }}>{error}</div>}
      </div>
    </div>
  );
}

export default DocxEditor;
