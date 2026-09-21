import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  PptxEditorProvider,
  usePptxEditorState,
  usePptxEditorStore
} from '../state/PptxEditorContext';
import { SvgSlide } from './SlideStage';
import { Toolbar } from './PptxToolbar';
import { SlideNavigator } from './SlideNavigator';
import { JsonPanel } from './JsonPanel';
import PptxPanelRail, { type PptxPanelKind } from './PptxPanelRail';
import PptxRightPanel from './PptxRightPanel';
import PptxChangesPanel from './PptxChangesPanel';
import {
  INK,
  INK_3,
  LINE,
  PANEL_2,
  PAPER,
  LINE_STRONG,
  INK_2,
  PANEL_3
} from '../../DocxEditor/TrackedChangeGroups/styles';
import { featheryDoc } from '../../../../utils/browser';
import type { PptxEditorProps } from '../types';

// The host-facing PowerPoint editor: Feathery-styled toolbar, slide navigator
// on the left, editable SVG stage in the center, extensible right rail/panel.
// Mirrors DocxEditor's host contract (source/readOnly/openNonce/onSave/...).

function sourceKey(source: PptxEditorProps['source']): string {
  if (!source) return '';
  if ('url' in source) return `url:${source.url}`;
  return `buffer:${source.buffer.byteLength}`;
}

const actionButton = {
  height: 30,
  padding: '0 14px',
  border: `1px solid ${LINE_STRONG}`,
  borderRadius: 8,
  background: PAPER,
  color: INK_2,
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap' as const,
  '&:hover': { background: PANEL_3, color: INK },
  '&:disabled': { opacity: 0.4, cursor: 'default' }
};

function PptxEditorInner({
  source,
  fileName = 'document.pptx',
  readOnly = false,
  visible = true,
  hideDownload = false,
  reviewChanges = false,
  openNonce = 0,
  onReady,
  onChange,
  onError,
  onSave,
  historyHost,
  devJsonPanel = false
}: PptxEditorProps) {
  const store = usePptxEditorStore();
  const state = usePptxEditorState();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activePanel, setActivePanel] = useState<PptxPanelKind | null>(null);
  const loadSeq = useRef(0);
  const dirtyRef = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // ---- source loading (url fetch or in-memory buffer) ----
  const key = sourceKey(source);
  useEffect(() => {
    if (!source) return;
    const seq = ++loadSeq.current;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        let bytes: Uint8Array;
        if ('url' in source) {
          const response = await fetch(source.url);
          if (!response.ok)
            throw new Error(`Document fetch failed (${response.status})`);
          bytes = new Uint8Array(await response.arrayBuffer());
        } else {
          bytes = new Uint8Array(source.buffer);
        }
        // A newer load (source replacement) supersedes this one.
        if (cancelled || seq !== loadSeq.current) return;
        store.loadFile(bytes, fileName);
        dirtyRef.current = false;
        setLoading(false);
        onReady?.();
      } catch (err: any) {
        if (cancelled || seq !== loadSeq.current) return;
        setLoading(false);
        const message = err?.message || 'Failed to open the presentation.';
        setLoadError(message);
        onError?.(message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, openNonce]);

  // ---- dirty tracking -> host onChange ----
  useEffect(() => {
    if (!onChange) return;
    return store.subscribe(() => {
      const dirty = store.engine.isDirty();
      if (dirty !== dirtyRef.current) {
        dirtyRef.current = dirty;
        onChange(dirty);
      }
    });
  }, [store, onChange]);

  // ---- save / download ----
  const handleSave = useCallback(async () => {
    if (!onSave || !state.deck || saving) return;
    // Flush any in-flight contenteditable edit before exporting.
    store.commitSvgTextEdit?.({ render: false });
    setSaving(true);
    try {
      const blob = store.engine.exportPptx();
      await onSave(blob);
      store.markSaved();
      dirtyRef.current = false;
      onChange?.(false);
    } catch (err: any) {
      onError?.(err?.message || 'Saving the presentation failed.');
    } finally {
      setSaving(false);
    }
  }, [onSave, state.deck, saving, store, onChange, onError]);

  const handleDownload = useCallback(() => {
    if (!state.deck) return;
    store.commitSvgTextEdit?.({ render: false });
    const blob = store.engine.exportPptx();
    const url = URL.createObjectURL(blob);
    const anchor = featheryDoc().createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [state.deck, store, fileName]);

  // ---- keyboard shortcuts, scoped to this editor instance ----
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (readOnly) return;
    const meta = e.metaKey || e.ctrlKey;
    if (!meta) return;
    const inTextEdit = (e.target as HTMLElement).closest?.(
      '[contenteditable="true"]'
    );
    const keyName = e.key.toLowerCase();
    if (keyName === 'z' && !inTextEdit) {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
    } else if (keyName === 'y' && !inTextEdit) {
      e.preventDefault();
      store.redo();
    } else if (keyName === 's' && onSave) {
      e.preventDefault();
      handleSave();
    }
  };

  const dirty = state.rev >= 0 ? store.engine.isDirty() : false;
  const historyEnabled = !!historyHost;

  const placeholder = (content: React.ReactNode, error = false) => (
    <div
      css={{
        display: visible ? 'flex' : 'none',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        minHeight: 160,
        border: `1px dashed ${LINE_STRONG}`,
        borderRadius: 8,
        color: error ? '#dc2626' : INK_3,
        fontSize: 14,
        background: PANEL_2
      }}
    >
      {content}
    </div>
  );

  if (!source) return placeholder('No presentation to edit yet.');
  if (loadError) return placeholder(loadError, true);
  if (loading || !state.deck) return placeholder('Loading presentation…');

  return (
    <div
      ref={wrapRef}
      onKeyDown={onKeyDown}
      css={{
        display: visible ? 'flex' : 'none',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        minHeight: 0,
        background: PAPER,
        border: `1px solid ${LINE}`,
        borderRadius: 8,
        overflow: 'hidden'
      }}
    >
      {/* Toolbar row: PPTX commands + host actions */}
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderBottom: `1px solid ${LINE}`,
          background: PAPER,
          paddingRight: 8
        }}
      >
        <div css={{ flex: 1, minWidth: 0, overflowX: 'auto' }}>
          {!readOnly && <Toolbar devJson={devJsonPanel} />}
        </div>
        <div css={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
          {!hideDownload && (
            <button type='button' css={actionButton} onClick={handleDownload}>
              Download
            </button>
          )}
          {onSave && !readOnly && (
            <button
              type='button'
              css={actionButton}
              disabled={saving || !dirty}
              onClick={handleSave}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>

      {/* Body: navigator | stage | (json) | panel | rail */}
      <div
        css={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          alignItems: 'stretch'
        }}
      >
        <SlideNavigator />
        <div
          css={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            overflow: 'auto',
            display: 'flex',
            background: PANEL_2
          }}
        >
          <SvgSlide readOnly={readOnly} />
        </div>
        {devJsonPanel && state.showJson && <JsonPanel />}
        <PptxRightPanel
          open={activePanel !== null}
          tab={activePanel ?? 'changes'}
          onClose={() => setActivePanel(null)}
          boundaryKey={`${state.fileName}:${openNonce}`}
          changesBody={<PptxChangesPanel />}
        />
        <PptxPanelRail
          activePanel={activePanel}
          onToggle={(panel) =>
            setActivePanel((current) => (current === panel ? null : panel))
          }
          changesCount={store.engine.pendingChangeCount()}
          historyEnabled={historyEnabled}
        />
      </div>
    </div>
  );
}

export default function PptxEditor(props: PptxEditorProps) {
  return (
    <PptxEditorProvider>
      <PptxEditorInner {...props} />
    </PptxEditorProvider>
  );
}
