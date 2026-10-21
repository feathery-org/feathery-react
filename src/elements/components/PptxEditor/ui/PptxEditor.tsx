import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  PptxEditorProvider,
  usePptxEditorState,
  usePptxEditorStore
} from '../state/PptxEditorContext';
import { SvgSlide, ZOOM_MAX, ZOOM_MIN } from './SlideStage';
import { Toolbar } from './PptxToolbar';
import DocumentSaveStatus from '../../DocumentEditor/DocumentSaveStatus';
import InstantTooltips from './InstantTooltips';
import { SlideNavigator } from './SlideNavigator';
import { JsonPanel } from './JsonPanel';
import PptxPanelRail, { type PptxPanelKind } from './PptxPanelRail';
import PptxRightPanel from './PptxRightPanel';
import PptxChangesPanel from './PptxChangesPanel';
import {
  EDITOR_PLACEHOLDER_ERROR_COLOR,
  EDITOR_PLACEHOLDER_STYLE
} from '../../DocumentEditor/placeholderStyle';
import {
  LINE,
  PANEL_2,
  PAPER
} from '../../DocxEditor/TrackedChangeGroups/styles';
import { featheryDoc } from '../../../../utils/browser';
import { useOutsideClose } from './useOutsideClose';
import {
  downloadBtn,
  menuItem,
  terminalBtn,
  FEATHERY_RED,
  FEATHERY_RED_HOVER,
  ZINC
} from '../../DocxEditor/DocxToolbar/styles';
import {
  ChevronDownIcon,
  DownloadIcon,
  FitToPageIcon,
  MinusIcon,
  PlusIcon,
  SaveIcon,
  SpinnerIcon
} from '../../DocxEditor/icons';
import type { PptxEditorProps } from '../types';
import { savePresentation } from '../persistence';
import { withShortcut } from './shortcuts';
import { onFontMetricsSettled } from '../core/render/fonts';

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
  onSaved,
  onSaveAll,
  onDownloadAll,
  onBeforeReplaceReady,
  onExportPdf,
  historyHost,
  devJsonPanel = false
}: PptxEditorProps) {
  const store = usePptxEditorStore();
  const state = usePptxEditorState();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const saveMenuRef = useRef<HTMLSpanElement>(null);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const downloadMenuRef = useRef<HTMLSpanElement>(null);
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

  // Webfonts settling changes measured line metrics; re-render on fresh ones.
  useEffect(() => onFontMetricsSettled(() => store.refreshRender()), [store]);

  // ---- save / download ----
  const pendingSave = useRef<Promise<void> | null>(null);
  const saveCurrent = useCallback((): Promise<void> => {
    if (pendingSave.current) return pendingSave.current;
    if (readOnly) return Promise.resolve();
    if (!store.getState().deck || !onSave)
      return Promise.reject(
        new Error('The presentation is not ready to save.')
      );
    setSaving(true);
    const save = async () => {
      await savePresentation(store, onSave);
      dirtyRef.current = false;
      onChange?.(false);
    };
    pendingSave.current = save().finally(() => {
      pendingSave.current = null;
      setSaving(false);
    });
    return pendingSave.current;
  }, [onSave, readOnly, store, onChange]);

  const beforeReplaceRef = useRef<() => Promise<unknown>>(() =>
    Promise.resolve()
  );
  beforeReplaceRef.current = async () => {
    if (readOnly) return;
    if (pendingSave.current) await pendingSave.current;
    store.commitSvgTextEdit?.({ render: false });
    if (store.engine.isDirty()) await saveCurrent();
  };
  useEffect(() => {
    onBeforeReplaceReady?.(() => beforeReplaceRef.current());
    return () => onBeforeReplaceReady?.(null);
  }, [onBeforeReplaceReady]);

  const handleSave = useCallback(async () => {
    try {
      await saveCurrent();
      await onSaved?.();
    } catch (err: any) {
      onError?.(err?.message || 'Saving the presentation failed.');
    }
  }, [saveCurrent, onError, onSaved]);

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

  const handleDownloadPdf = useCallback(async () => {
    if (!onExportPdf || downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      // Save first so the PDF reflects current edits; a save failure is
      // reported as a save error, distinct from a conversion failure.
      if (onSave) {
        try {
          await saveCurrent();
        } catch (err: any) {
          onError?.(err?.message || 'Saving the presentation failed.');
          return;
        }
      }
      const blob = await onExportPdf();
      const url = URL.createObjectURL(blob);
      const anchor = featheryDoc().createElement('a');
      anchor.href = url;
      anchor.download = fileName.replace(/\.pptx$/i, '') + '.pdf';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err: any) {
      onError?.(err?.message || 'Exporting the presentation as PDF failed.');
    } finally {
      setDownloadingPdf(false);
    }
  }, [onExportPdf, downloadingPdf, onSave, saveCurrent, onError, fileName]);

  useOutsideClose(
    downloadMenuOpen,
    () => setDownloadMenuOpen(false),
    (t) => !!downloadMenuRef.current?.contains(t)
  );

  useOutsideClose(
    saveMenuOpen,
    () => setSaveMenuOpen(false),
    (t) => !!saveMenuRef.current?.contains(t)
  );

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

  // Identical to the host's placeholder so the loading handoff is invisible.
  const placeholder = (content: React.ReactNode, error = false) => (
    <div
      css={{
        ...EDITOR_PLACEHOLDER_STYLE,
        display: visible ? 'flex' : 'none',
        minHeight: 160,
        ...(error ? { color: EDITOR_PLACEHOLDER_ERROR_COLOR } : {})
      }}
    >
      {content}
    </div>
  );

  if (!source) return placeholder('No presentation to edit yet.');
  if (loadError) return placeholder(loadError, true);
  if (loading || !state.deck) return placeholder('Loading document…');

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
        containerType: 'inline-size',
        containerName: 'document-editor',
        overflow: 'hidden'
      }}
    >
      {/* Host actions render on the toolbar's tab row. */}
      {(() => {
        const hostActions = (
          <>
            {!hideDownload &&
              (onExportPdf || onDownloadAll ? (
                <span
                  ref={downloadMenuRef}
                  css={{ position: 'relative', display: 'inline-flex' }}
                >
                  <button
                    type='button'
                    css={downloadBtn}
                    disabled={downloadingPdf}
                    onClick={() => setDownloadMenuOpen((open) => !open)}
                    aria-haspopup='true'
                    aria-expanded={downloadMenuOpen}
                    title='Download'
                  >
                    <DownloadIcon width={16} height={16} />
                    {downloadingPdf ? 'Preparing…' : 'Download'}
                    <ChevronDownIcon width={14} height={14} />
                  </button>
                  {downloadMenuOpen && (
                    <div
                      css={downloadMenu}
                      onMouseLeave={() => setDownloadMenuOpen(false)}
                    >
                      <button
                        type='button'
                        css={downloadMenuItem}
                        onClick={() => {
                          setDownloadMenuOpen(false);
                          handleDownload();
                        }}
                      >
                        {onDownloadAll
                          ? 'This document as PPTX'
                          : 'Download as PPTX'}
                      </button>
                      {onExportPdf && (
                        <button
                          type='button'
                          css={downloadMenuItem}
                          onClick={() => {
                            setDownloadMenuOpen(false);
                            handleDownloadPdf();
                          }}
                        >
                          {onDownloadAll
                            ? 'This document as PDF'
                            : 'Download as PDF'}
                        </button>
                      )}
                      {onDownloadAll && (
                        <button
                          type='button'
                          css={downloadMenuItem}
                          onClick={() => {
                            setDownloadMenuOpen(false);
                            onDownloadAll();
                          }}
                        >
                          All documents (ZIP)
                        </button>
                      )}
                    </div>
                  )}
                </span>
              ) : (
                <button
                  type='button'
                  css={downloadBtn}
                  onClick={handleDownload}
                  title='Download'
                >
                  <DownloadIcon width={16} height={16} />
                  Download
                </button>
              ))}
            {!readOnly && <DocumentSaveStatus dirty={dirty} />}
            {onSave && !readOnly && onSaveAll ? (
              <span
                ref={saveMenuRef}
                css={{ position: 'relative', display: 'inline-flex' }}
              >
                <button
                  type='button'
                  css={{
                    ...terminalBtn(saving),
                    borderRadius: '6px 0 0 6px'
                  }}
                  disabled={saving}
                  onClick={() => {
                    setSaveMenuOpen(false);
                    handleSave();
                  }}
                  title={withShortcut('Save this document', 'S')}
                >
                  {saving ? (
                    <SpinnerIcon width={16} height={16} />
                  ) : (
                    <SaveIcon width={16} height={16} />
                  )}
                  Save
                </button>
                <button
                  type='button'
                  css={{
                    ...terminalBtn(saving),
                    borderRadius: '0 6px 6px 0',
                    borderLeft: '1px solid rgba(255,255,255,.35)',
                    padding: '0 6px'
                  }}
                  disabled={saving}
                  onClick={() => setSaveMenuOpen((value) => !value)}
                  aria-label='Save options'
                  aria-expanded={saveMenuOpen}
                  aria-haspopup='true'
                >
                  <ChevronDownIcon width={14} height={14} />
                </button>
                {saveMenuOpen && (
                  <div css={downloadMenu}>
                    <button
                      type='button'
                      css={downloadMenuItem}
                      onClick={() => {
                        setSaveMenuOpen(false);
                        handleSave();
                      }}
                    >
                      Save this document
                    </button>
                    <button
                      type='button'
                      css={downloadMenuItem}
                      onClick={() => {
                        setSaveMenuOpen(false);
                        onSaveAll();
                      }}
                    >
                      Save All Documents
                    </button>
                  </div>
                )}
              </span>
            ) : (
              onSave &&
              !readOnly && (
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
                  title={withShortcut('Save', 'S')}
                >
                  {saving ? (
                    <SpinnerIcon width={16} height={16} />
                  ) : (
                    <SaveIcon width={16} height={16} />
                  )}
                  Save
                </button>
              )
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
        <SlideNavigator readOnly={readOnly} />
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
          <SvgSlide
            readOnly={readOnly}
            zoom={zoomPct}
            onZoomChange={setZoomPct}
          />
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
      <InstantTooltips>
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
              aria-label='Go to slide'
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
            disabled={zoomPct <= ZOOM_MIN}
            onClick={() => setZoomPct((z) => Math.max(ZOOM_MIN, z - 25))}
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
            disabled={zoomPct >= ZOOM_MAX}
            onClick={() => setZoomPct((z) => Math.min(ZOOM_MAX, z + 25))}
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
      </InstantTooltips>
    </div>
  );
}

const downloadMenu = {
  position: 'absolute' as const,
  top: 'calc(100% + 4px)',
  right: 0,
  zIndex: 40,
  minWidth: 168,
  padding: 4,
  background: '#fff',
  border: `1px solid ${ZINC[200]}`,
  borderRadius: 8,
  boxShadow: '0 6px 18px rgba(23,26,28,.13)',
  display: 'flex',
  flexDirection: 'column' as const
};

const downloadMenuItem = menuItem();

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
