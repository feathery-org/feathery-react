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
import {
  downloadBtn,
  FEATHERY_RED,
  FEATHERY_RED_HOVER,
  ZINC
} from '../../DocxEditor/DocxToolbar/styles';
import {
  DownloadIcon,
  FitToPageIcon,
  MinusIcon,
  PlusIcon,
  SaveIcon,
  SpinnerIcon
} from '../../DocxEditor/icons';
import type { PptxEditorProps } from '../types';

// Tracked edits and version history are built but not user-ready; keep the
// right rail and panels hidden until their flows are approved.
const SHOW_REVIEW_RAIL = false;

// The host-facing PowerPoint editor: Feathery-styled toolbar, slide navigator
// on the left, editable SVG stage in the center, extensible right rail/panel.
// Mirrors DocxEditor's host contract (source/readOnly/openNonce/onSave/...).

function sourceKey(source: PptxEditorProps['source']): string {
  if (!source) return '';
  if ('url' in source) return `url:${source.url}`;
  return `buffer:${source.buffer.byteLength}`;
}

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
  const [zoomPct, setZoomPct] = useState(75);
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
        maxHeight: '100%',
        minHeight: 0,
        background: PAPER,
        border: `1px solid ${ZINC[200]}`,
        borderRadius: 8,
        overflow: 'hidden'
      }}
    >
      {/* Host actions render on the toolbar's tab row. */}
      {(() => {
        const hostActions = (
          <>
            {/* Mirrors DocxToolbar's ToolbarActions: the dot is always rendered
              and only toggles visibility so the row never shifts. */}
            {!readOnly && (
              <span
                css={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 13,
                  color: ZINC[500],
                  whiteSpace: 'nowrap',
                  visibility: dirty ? 'visible' : 'hidden'
                }}
                aria-hidden={!dirty}
                title={dirty ? 'You have unsaved changes' : undefined}
                style={{ marginRight: 8 }}
              >
                <span
                  css={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: FEATHERY_RED,
                    flex: '0 0 auto'
                  }}
                />
                Unsaved changes
              </span>
            )}
            {!hideDownload && (
              <button
                type='button'
                css={downloadBtn}
                onClick={handleDownload}
                title='Download'
              >
                <DownloadIcon width={16} height={16} />
                Download
              </button>
            )}
            {onSave && !readOnly && (
              <button
                type='button'
                css={{
                  display: 'flex',
                  height: 32,
                  alignItems: 'center',
                  gap: 6,
                  borderRadius: 6,
                  border: 'none',
                  background: FEATHERY_RED,
                  padding: '0 12px',
                  fontSize: 14,
                  fontWeight: 500,
                  color: '#fff',
                  cursor: saving ? 'default' : 'pointer',
                  '&:hover': {
                    background: saving ? FEATHERY_RED : FEATHERY_RED_HOVER
                  }
                }}
                disabled={saving}
                onClick={handleSave}
              >
                {saving ? (
                  <SpinnerIcon width={16} height={16} />
                ) : (
                  <SaveIcon width={16} height={16} />
                )}
                Save
              </button>
            )}
          </>
        );
        return !readOnly ? (
          <Toolbar devJson={devJsonPanel} rightActions={hostActions} />
        ) : (
          <div
            css={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 8,
              minHeight: 44,
              padding: '4px 8px',
              borderBottom: `1px solid ${LINE}`,
              background: PAPER
            }}
          >
            {hostActions}
          </div>
        );
      })()}

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
          <SvgSlide readOnly={readOnly} zoom={zoomPct} />
        </div>
        {devJsonPanel && state.showJson && <JsonPanel />}
        {SHOW_REVIEW_RAIL && (
          <>
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
          </>
        )}
      </div>

      {/* Bottom status bar, like the DOCX editor: slide position + zoom. */}
      <div
        css={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flex: '0 0 auto',
          padding: '8px 14px',
          borderTop: `1px solid ${ZINC[200]}`,
          background: PAPER,
          fontSize: 12,
          color: ZINC[500]
        }}
      >
        <span
          css={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            whiteSpace: 'nowrap'
          }}
        >
          Slide
          <input
            type='number'
            min={1}
            max={state.deck.slides.length}
            key={`slide-jump-${state.activeSlide}`}
            defaultValue={state.activeSlide + 1}
            title='Go to slide'
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }}
            onBlur={(e) => {
              const total = state.deck?.slides.length ?? 1;
              const requested = Math.round(Number(e.target.value));
              if (!Number.isFinite(requested)) return;
              const index = Math.min(Math.max(requested, 1), total) - 1;
              if (index !== state.activeSlide) store.setActiveSlide(index);
            }}
            css={{
              width: 42,
              height: 22,
              border: `1px solid ${ZINC[200]}`,
              borderRadius: 5,
              background: '#fff',
              color: ZINC[700],
              fontSize: 12,
              textAlign: 'center',
              fontVariantNumeric: 'tabular-nums'
            }}
          />
          of {state.deck.slides.length}
        </span>
        <span css={{ flex: 1 }} />
        <button
          type='button'
          css={statusButton}
          title='Zoom out'
          disabled={zoomPct <= 50}
          onClick={() => setZoomPct((z) => Math.max(50, z - 25))}
        >
          <MinusIcon width={14} height={14} />
        </button>
        <span
          css={{
            minWidth: 40,
            textAlign: 'center',
            fontVariantNumeric: 'tabular-nums'
          }}
        >
          {zoomPct}%
        </span>
        <button
          type='button'
          css={statusButton}
          title='Zoom in'
          disabled={zoomPct >= 400}
          onClick={() => setZoomPct((z) => Math.min(400, z + 25))}
        >
          <PlusIcon width={14} height={14} />
        </button>
        <button
          type='button'
          css={statusButton}
          title='Fit to container'
          onClick={() => setZoomPct(100)}
        >
          <FitToPageIcon width={14} height={14} />
        </button>
      </div>
    </div>
  );
}

const statusButton = {
  height: 24,
  minWidth: 24,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: 5,
  background: 'transparent',
  color: ZINC[500],
  cursor: 'pointer',
  '&:hover': { background: ZINC[100], color: ZINC[900] },
  '&:disabled': { opacity: 0.35, cursor: 'default' }
};

export default function PptxEditor(props: PptxEditorProps) {
  return (
    <PptxEditorProvider>
      <PptxEditorInner {...props} />
    </PptxEditorProvider>
  );
}
