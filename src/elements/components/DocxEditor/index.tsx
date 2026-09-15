import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { featheryDoc } from '../../../utils/browser';
import DocxToolbar from './DocxToolbar';
import { CheckIcon, CloseIcon } from './icons';
import { FEATHERY_RED, TOOLBAR_HEIGHT } from './DocxToolbar/styles';
import DocumentPanel, { PanelTab } from './DocumentPanel';
import PanelRail from './PanelRail';
import {
  DocxBindingsConfig,
  setActiveInlineRevisions,
  useDocxEditor
} from './useDocxEditor';
import { TableDeleteImpact } from './bindings/tableDeleteGuard';
import { editGroupKey } from './history/sfdtDiff/index';
import { useDocxHistorySession } from './history/useDocxHistorySession';
import { VersionDocument } from './history/useVersionDocument';
import VersionViewer from './history/VersionViewer';
import VersionBar from './history/VersionBar';
import {
  DocxHistoryHost,
  DocxSaveMeta,
  DocxVersion,
  VersionAuthor
} from './history/types';
import { DocxSource } from './types';

const DEFAULT_CURRENT_USER: VersionAuthor = {
  kind: 'user',
  key: 'you',
  label: 'You'
};

// Re-exported for tests that import it from this module.
export { RailErrorBoundary } from './RailErrorBoundary';

type ActivePanel = PanelTab | null;

// How long after a restore a nonzero pending-change count still counts as
// "the restored version brought suggestions back" (reopen + rail refresh
// comfortably finish within this; anything later is a new edit).
const RESTORE_SUGGESTIONS_WINDOW_MS = 15_000;

/** The restore-suggestions toast copy, or null when the pending count isn't
 *  attributable to the last restore. Exported for tests. */
export function restoredSuggestionsMessage(
  count: number,
  restoredAt: number,
  now = Date.now()
): string | null {
  if (
    count <= 0 ||
    !restoredAt ||
    now - restoredAt >= RESTORE_SUGGESTIONS_WINDOW_MS
  )
    return null;
  return (
    `This version includes ${count} unapproved suggestion` +
    `${count === 1 ? '' : 's'} — review them in Suggested changes`
  );
}

/** What a host's onSave may resolve with. `file` is the public copy of the
 *  saved document (content controls stripped server-side) — the only bytes
 *  downloads are allowed to serve. */
export interface DocxSaveResult {
  file?: string | null;
  editor_file?: string | null;
  [key: string]: unknown;
}

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
  /** URL of the document's public copy (content controls stripped). When set,
   *  Download saves current edits, then serves this copy (or the fresher one
   *  from the save result) — never the raw editor bytes. */
  downloadUrl?: string | null;
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
  /** Persistence boundary: receives the exported .docx and, when version
   *  history is active, the session metadata to group the save into a version
   *  row. The host decides where it goes (the component never persists). */
  onSave?: (
    blob: Blob,
    meta?: DocxSaveMeta
  ) => DocxSaveResult | void | Promise<DocxSaveResult | void>;
  /** Opt-in version history: the I/O adapter the container injects. Absent →
   *  no sessions, no autosave grouping (the editor behaves as before). */
  history?: DocxHistoryHost;
  /** The current viewer's identity for version attribution. */
  currentUser?: VersionAuthor;
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
  downloadUrl,
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
  history,
  currentUser,
  bindings
}: DocxEditorProps) {
  const dirtyRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // Brief feedback shown after an explicit Save — the button otherwise gives
  // no sign of whether the document actually persisted.
  // Confirmation / warning modal. Primarily the binding-error export gate, but
  // also reused for plain confirmations (e.g. Restore) — `title` overrides the
  // heading so a confirm doesn't inherit the binding-error label. Save and
  // download offer a consented escape hatch ("Save Anyway" / "Download
  // Anyway"); sign/send show it without one — informational, Close only. The
  // table-delete confirmation reuses it with its own title and a cancel hook.
  const [gateWarning, setGateWarning] = useState<{
    message: string;
    /** Heading; defaults to the binding-error label when omitted. */
    title?: string;
    confirmLabel?: string;
    confirmTitle?: string;
    proceed?: () => void;
    cancel?: () => void;
  } | null>(null);
  const [saveToast, setSaveToast] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);
  const saveToastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  // Mirror the toast into a ref so editor-event callbacks can read the current
  // type without re-subscribing.
  const saveToastRef = useRef(saveToast);
  saveToastRef.current = saveToast;
  const [terminalRunning, setTerminalRunning] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  // Debounces the DOCX download: a double-click must not race two exports
  // and two PATCH saves of the same bytes.
  const [downloading, setDownloading] = useState(false);
  // The single right-rail slot shows at most one panel, toggled from the
  // toolbar's two buttons (Changes / Sections).
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  // A selected older version, shown read-only over the live editor. The live
  // editor keeps autosaving underneath while it is open.
  const [viewingVersion, setViewingVersion] = useState<DocxVersion | null>(
    null
  );
  // A live-diffed display document for the in-progress current version (no
  // stored files yet): highlights baked in, so the viewer renders it like any
  // stored version. Null for stored versions (they fetch their own files).
  const [liveDoc, setLiveDoc] = useState<VersionDocument | null>(null);
  // The version list reported up by the History panel, for auto-selecting the
  // latest (Current) version when the panel opens.
  const [historyVersions, setHistoryVersions] = useState<DocxVersion[]>([]);
  // Version highlights are always shown when available (no user toggle). The
  // resolved counts below drive the version bar's summary; reset per version.
  // Highlight-changes toggle (version bar). Toggling remounts the viewer.
  const [highlightsOn, setHighlightsOn] = useState(true);
  // The read-only version viewer's editor, for stepping through its changes.
  const viewerEditorRef = useRef<any>(null);
  // Which change group the steppers are on (index into orderedChangeGroups);
  // -1 before the first step. Reset when the viewer's editor changes.
  const changeStepRef = useRef(-1);
  const [versionMeta, setVersionMeta] = useState<{
    editCount?: number;
    formatCount?: number;
    pendingCount?: number;
    degraded: boolean;
  } | null>(null);
  // Pending tracked-change count, reported by the (always-mounted) rail; drives
  // the toolbar's Changes badge and whether that button is offered at all.
  const [changesCount, setChangesCount] = useState(0);
  // When the last restore finished. A restored .docx can carry back tracked
  // changes that were still awaiting review when that version was saved; once
  // the reopened document reports them (see the changesCount effect), a toast
  // says so, and this timestamp scopes that toast to the restore itself.
  const restoredAtRef = useRef(0);

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

  /**
   * Deleting a table or row that feeds calculated values elsewhere would
   * strand them (stale number, save blocked, the control itself
   * non-deletable). The guard asks here first; confirming deletes and converts
   * the dependent values to plain text in one undoable step.
   */
  const confirmTableDelete = useCallback(
    (impact: TableDeleteImpact) =>
      new Promise<boolean>((resolve) => {
        const names = impact.orphans
          .map((orphan) => `"${orphan.name}"`)
          .join(', ');
        const plural = impact.orphans.length > 1;
        const noun =
          impact.scope === 'row'
            ? 'row'
            : impact.scope === 'range'
            ? 'selection'
            : 'table';
        const label = impact.scope === 'range' ? 'Delete' : `Delete ${noun}`;
        setGateWarning({
          title: `Delete ${noun}?`,
          message: `The calculated value${
            plural ? 's' : ''
          } ${names} elsewhere in this document ${
            plural ? 'use' : 'uses'
          } numbers from this ${noun}. Deleting it keeps the current value${
            plural ? 's' : ''
          } as plain text.`,
          confirmLabel: label,
          confirmTitle: `Deletes the ${noun}; dependent calculated values become plain text`,
          proceed: () => {
            setGateWarning(null);
            resolve(true);
          },
          cancel: () => resolve(false)
        });
      }),
    []
  );

  // Non-error hint shown while the caret is on a locked control that refused an
  // edit. No timeout - it stays as long as the cursor sits on the locked cell;
  // the bindings layer resolves it when the caret moves somewhere editable or
  // leaves the editor.
  const handleLockedEdit = useCallback(() => {
    if (saveToastTimer.current) clearTimeout(saveToastTimer.current);
    setSaveToast({
      type: 'info',
      message: "This content is locked and can't be edited here."
    });
  }, []);

  // The caret left the locked spot: hide the hint now, but never clobber a save
  // success/error toast that happens to be showing.
  const handleLockedEditResolved = useCallback(() => {
    if (saveToastRef.current?.type !== 'info') return;
    setSaveToast(null);
  }, []);

  // The history hook is created below (it needs `editor`), but useDocxEditor's
  // onEdit must exist now — bridge through a ref so the stable listener reaches
  // the latest hook.
  const historyOnEditRef = useRef<
    ((info: { assistant: boolean }) => void) | undefined
  >(undefined);

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
    onEdit: (info) => historyOnEditRef.current?.(info),
    // Ctrl/Cmd+S saves through the host instead of Syncfusion's default (which
    // downloads the raw SFDT). Runs the same gated flow as the toolbar Save.
    onSaveShortcut: () => handleSave(),
    onError,
    bindings: bindings
      ? {
          ...bindings,
          confirmTableDelete,
          onLockedEdit: handleLockedEdit,
          onLockedEditResolved: handleLockedEditResolved
        }
      : bindings
  });

  // The Changes button is only offered while changes are pending; if they all
  // resolve while its panel is open, close it so the empty slot doesn't linger.
  useEffect(() => {
    if (activePanel === 'changes' && changesCount === 0) setActivePanel(null);
  }, [activePanel, changesCount]);

  // Escape backs out one layer at a time: first the version viewer, then the
  // side panel.
  useEffect(() => {
    if (!viewingVersion && activePanel === null) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (viewingVersion) {
        setViewingVersion(null);
        setLiveDoc(null);
      } else setActivePanel(null);
    };
    const doc = featheryDoc();
    doc.addEventListener('keydown', onKey);
    return () => doc.removeEventListener('keydown', onKey);
  }, [viewingVersion, activePanel]);

  /**
   * Reconcile anything uncommitted before bytes leave the editor and report the
   * first blocking binding error, or null when the document is exportable.
   * commitForSave() flushes typed edits either way, so a false only means the
   * document carries an invalid binding config - not that content is missing.
   */
  const exportBlockMessage = (): string | null => {
    if (!bindingsState.ready) return null;
    if (bindingsState.commitForSave()) return null;
    const detail = bindingsState.diagnostics
      .filter((entry) => entry.severity === 'error')
      .map((entry) => entry.message);
    console.error('Feathery: document has unresolved binding errors', detail);
    return detail.length
      ? `This document cannot be saved yet: ${detail[0]}`
      : 'This document cannot be saved yet.';
  };

  /**
   * Hard gate for sign/send: refuse to export a document the engine considers
   * wrong - an invalid number or an ambiguous edit would otherwise be signed
   * as if it were fine. Shows the binding-error modal with no escape hatch:
   * these outcomes are irreversible, so there is no "Sign Anyway".
   */
  const readyToExport = (): boolean => {
    const block = exportBlockMessage();
    if (block === null) return true;
    setSaveToast(null);
    setGateWarning({ message: block });
    return false;
  };

  /**
   * Soft gate for save and download paths: same check as the hard gate, but
   * instead of refusing outright it offers an "Anyway" escape hatch - the
   * flush already happened, so proceeding just means the persisted/exported
   * document carries the invalid binding config. Signing/sending stays
   * hard-gated: those are irreversible and leave the platform.
   */
  const softGate = (
    retry: () => void,
    confirmLabel: string,
    confirmTitle: string
  ): boolean => {
    const block = exportBlockMessage();
    if (block === null) return true;
    setSaveToast(null);
    setGateWarning({
      message: block,
      confirmLabel,
      confirmTitle,
      proceed: () => {
        setGateWarning(null);
        retry();
      }
    });
    return false;
  };

  const gateDownload = (retry: () => void): boolean =>
    softGate(
      retry,
      'Download Anyway',
      'Saves and downloads the document as-is'
    );

  const gateSave = (retry: () => void): boolean =>
    softGate(retry, 'Save Anyway', 'Saves the document as-is');

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
  const saveCurrentDocument = async (blob: Blob, meta?: DocxSaveMeta) => {
    if (!onSave) return;
    setSaving(true);
    try {
      const result = (await onSave(blob, meta)) as DocxSaveResult | undefined;
      dirtyRef.current = false;
      setDirty(false);
      onChange?.(false);
      return result;
    } finally {
      setSaving(false);
    }
  };

  // Version history: sessions + autosave. No-ops without a `history` host, so
  // standalone hosts keep the manual Save/Download flow unchanged.
  const historySession = useDocxHistorySession({
    editor,
    loading,
    readOnly,
    host: history ?? null,
    currentUser: currentUser ?? DEFAULT_CURRENT_USER,
    openNonce,
    exportDoc,
    save: async (blob, meta) => {
      await saveCurrentDocument(blob, meta);
    }
  });
  historyOnEditRef.current = historySession.onEdit;

  // Open a version read-only in the viewer. The in-progress current version has
  // no stored files, so build a live display document for it (its session diffed
  // live → highlights); stored versions fetch their own files (liveDoc null).
  const selectVersion = useCallback(
    (version: DocxVersion) => {
      const hasStoredDoc =
        !!version.final_sfdt || !!version.editor_file || !!version.file;
      let live: VersionDocument | null = null;
      if (version.is_current && !hasStoredDoc) {
        const preview = historySession.previewSession();
        if (preview) {
          live = {
            loading: false,
            error: false,
            sfdt: preview.sfdt,
            degraded: false,
            editCount: preview.editCount,
            formatCount: preview.formatCount,
            pendingCount: preview.pendingCount
          };
        } else {
          // No in-progress session diff (between sessions, or right after a
          // restore/accept that nets to no change): show the current document
          // plain. Selecting a row always highlights THAT row — never redirect
          // to another version, which made the panel jump to a prior one.
          try {
            const sfdt = editor?.serialize?.();
            if (sfdt) {
              live = { loading: false, error: false, sfdt, degraded: true };
            }
          } catch {
            live = null;
          }
        }
      }
      setLiveDoc(live);
      setViewingVersion(version);
      setVersionMeta(null);
    },
    [editor, historySession]
  );

  // Back to the live editor (its toolbar returns because viewingVersion clears).
  const exitVersionView = useCallback(() => {
    setViewingVersion(null);
    setLiveDoc(null);
  }, []);

  // Step the viewer through EDIT GROUPS, not raw revisions: one click = one
  // logical edit. editGroupKey buckets a replace's delete+insert together and
  // collapses the WHOLE Robin turn into a single group (a session holds at most
  // one turn), so the assistant's changes step as one edit however many places
  // it touched. setActiveInlineRevisions rings every revision in the group (so
  // both the strikethrough and the rewritten text are ringed, not just the
  // deletion), and selectRevision scrolls the group into view (skipGroupSelect
  // keeps it on this exact edit; the native pane it would open is hidden by
  // closeTrackedChangeReviewPane's rule).
  // The viewer editor now persists across version switches (keyed only by
  // highlight mode), so onViewerEditor no longer fires per version. Reset the
  // prev/next stepping cursor whenever the shown version (or highlight mode)
  // changes so stepping starts from the top of the newly-opened document.
  useEffect(() => {
    changeStepRef.current = -1;
  }, [viewingVersion?.id, highlightsOn]);

  const stepChange = useCallback((direction: 1 | -1) => {
    const ed = viewerEditorRef.current;
    const revisions: any[] = ed?.revisions?.revisions ?? [];
    if (!revisions.length) return;
    // Bucket every revision under its group, preserving document order and the
    // order groups first appear.
    const order: string[] = [];
    const byGroup = new Map<string, any[]>();
    revisions.forEach((rev, i) => {
      const key = editGroupKey(rev) ?? rev?.revisionId ?? String(i);
      let bucket = byGroup.get(key);
      if (!bucket) {
        bucket = [];
        byGroup.set(key, bucket);
        order.push(key);
      }
      bucket.push(rev);
    });
    if (!order.length) return;
    // An inserted blank line is a paragraph-mark-only revision with an EMPTY
    // range; stepping onto it lands the caret on an empty line with nothing to
    // review ("steps on the empty line, never on the edit"). Step only among
    // groups that carry visible content — fall back to all groups only if a
    // version somehow has nothing but blank-line edits.
    const hasContent = (revs: any[]): boolean =>
      revs.some((r) =>
        (r.range ?? []).some(
          (x: any) => typeof x?.text === 'string' && x.text.length > 0
        )
      );
    const contentOrder = order.filter((k) => hasContent(byGroup.get(k) ?? []));
    const stepOrder = contentOrder.length ? contentOrder : order;
    const prev = changeStepRef.current;
    let next =
      prev < 0
        ? direction === 1
          ? 0
          : stepOrder.length - 1
        : prev + direction;
    // Wrap so the steppers never dead-end.
    if (next < 0) next = stepOrder.length - 1;
    if (next >= stepOrder.length) next = 0;
    changeStepRef.current = next;
    const group = byGroup.get(stepOrder[next]) ?? [];
    // Ring the full edit (deletion + insertion), then scroll to it.
    try {
      setActiveInlineRevisions(ed, group);
    } catch {
      /* highlighting is decoration; navigation must still run */
    }
    try {
      const selection = ed.selection;
      // Prefer a content-bearing revision so the caret lands on the edited text,
      // not the paragraph break (empty line) that may precede it in the group.
      const target =
        group.find((r) =>
          (r.range ?? []).some(
            (x: any) => typeof x?.text === 'string' && x.text.length > 0
          )
        ) ?? group[0];
      selection?.selectRevision?.(target, undefined, undefined, true);
      if (selection?.start && selection?.end) {
        ed.documentHelper?.scrollToPosition?.(selection.start, selection.end);
      }
    } catch {
      /* selection unavailable mid-teardown */
    }
  }, []);

  // When the History panel opens, select the latest (Current) version by default
  // so the viewer shows it read-only straight away. Fires once per open; a manual
  // "back to current" while the panel stays open does not re-trigger it.
  const historyAutoSelectedRef = useRef(false);
  useEffect(() => {
    if (activePanel !== 'history') {
      historyAutoSelectedRef.current = false;
      return;
    }
    if (historyAutoSelectedRef.current) return;
    const current = historyVersions.find((v) => v.is_current);
    if (current) {
      historyAutoSelectedRef.current = true;
      selectVersion(current);
    }
  }, [activePanel, historyVersions, selectVersion]);

  // Flash a save toast and auto-dismiss it. Re-showing while one is already up
  // resets the timer so a second save reads as fresh feedback. Errors linger a
  // little longer than the success confirmation.
  const flashSaveToast = (
    type: 'success' | 'error' | 'info',
    message: string,
    durationMs?: number
  ) => {
    setSaveToast({ type, message });
    if (saveToastTimer.current) clearTimeout(saveToastTimer.current);
    saveToastTimer.current = setTimeout(
      () => setSaveToast(null),
      durationMs ?? (type === 'error' ? 5000 : 2500)
    );
  };

  // The rail reports the live document's pending tracked-change count here.
  // Right after a restore, a nonzero count means the restored version carried
  // suggestions that were still awaiting review when it was saved (a .docx
  // keeps its tracked changes) — say so, or the wash on those edits reads as a
  // mystery. The time window scopes the toast to the restore's own reopen; a
  // later assistant edit must not replay it.
  const handleChangesCount = (count: number) => {
    setChangesCount(count);
    const message = restoredSuggestionsMessage(count, restoredAtRef.current);
    if (message) {
      restoredAtRef.current = 0;
      flashSaveToast('success', message, 6000);
    }
  };

  useEffect(
    () => () => {
      if (saveToastTimer.current) clearTimeout(saveToastTimer.current);
    },
    []
  );

  const handleSave = async (force = false) => {
    if (force) bindingsState.commitForSave();
    else if (!gateSave(() => handleSave(true))) return;
    try {
      // With history active, an explicit Save closes the current session (which
      // persists the document via the same onSave), so the edits become a
      // finished version rather than a mid-session autosave.
      if (history) await historySession.save();
      else await saveCurrentDocument(await exportDoc());
      flashSaveToast('success', 'Document saved');
    } catch (err) {
      flashSaveToast('error', 'Could not save document');
      onError?.((err as Error).message || String(err));
    }
  };

  // Re-fetch the saved public copy for download. no-store because saves reuse
  // the same object key, so the HTTP cache could otherwise serve stale bytes.
  const fetchDownloadBlob = async (url: string) => {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('Could not download the document');
    return await res.blob();
  };

  const handleDownload = async (force = false) => {
    if (downloading) return;
    if (force) bindingsState.commitForSave();
    else if (!gateDownload(() => handleDownload(true))) return;
    setDownloading(true);
    try {
      // Save current edits first, then serve the host's public copy — content
      // controls are stripped server-side on save, so the raw editor bytes
      // must never be what the user walks away with.
      const blob = await exportDoc();
      const saveResult =
        onSave && (dirtyRef.current || !!history)
          ? history
            ? await historySession.save()
            : await saveCurrentDocument(blob)
          : undefined;
      const url = (saveResult as DocxSaveResult | undefined)?.file ?? downloadUrl;
      // No public copy exists for standalone hosts — their exported bytes are
      // the only source.
      if (url) triggerDownload(await fetchDownloadBlob(url));
      else triggerDownload(blob);
    } catch (err) {
      onError?.((err as Error).message || String(err));
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadPdf = async (force = false) => {
    if (!onExportPdf || exportingPdf) return;
    if (force) bindingsState.commitForSave();
    else if (!gateDownload(() => handleDownloadPdf(true))) return;
    setExportingPdf(true);
    try {
      // The host converts the SAVED document, so persist current edits first —
      // the PDF must match what's on screen.
      const blob = await exportDoc();
      if (onSave && (dirtyRef.current || !!history)) {
        if (history) await historySession.save();
        else await saveCurrentDocument(blob);
      }
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
    run: (blob: Blob, saveResult?: unknown) => void | Promise<void>,
    // Only the download outcome may bypass the gate (via "Download Anyway");
    // sign/send stay hard-gated. The flush still runs so typed edits commit.
    bypassGate = false
  ) => {
    if (terminalRunning) return;
    if (bypassGate) bindingsState.commitForSave();
    // Gated here rather than per-handler: this is the single funnel every
    // terminal action goes through, so a document the binding engine considers
    // invalid cannot be signed, sent or downloaded from any of them.
    else if (!readyToExport()) return;
    setTerminalRunning(true);
    try {
      const blob = await exportDoc();
      const saveResult =
        onSave && (dirtyRef.current || !!history)
          ? history
            ? await historySession.save()
            : await saveCurrentDocument(blob)
          : undefined;
      await run(blob, saveResult);
    } catch (err) {
      onError?.((err as Error).message || String(err));
    } finally {
      setTerminalRunning(false);
    }
  };

  const handleTerminalAction = (force = false): Promise<void> | void => {
    // Terminal download gets the soft gate + "Download Anyway"; other terminal
    // outcomes keep the hard gate inside saveThenRun.
    if (
      terminalAction === 'download' &&
      !force &&
      !gateDownload(() => handleTerminalAction(true))
    )
      return;
    return saveThenRun(async (blob, saveResult) => {
      if (terminalAction === 'download') {
        // Serve the public copy, same as the toolbar Download — the editor
        // bytes carry content controls that must not leave the platform.
        const url =
          (saveResult as DocxSaveResult | undefined)?.file ?? downloadUrl;
        if (url) triggerDownload(await fetchDownloadBlob(url));
        else triggerDownload(blob);
      } else {
        await onTerminalAction?.(saveResult);
      }
    }, force && terminalAction === 'download');
  };

  // Draft variant of the 'sign' terminal action: identical save-first flow, and
  // the host sends the document to DocuSign as a draft instead of for signature.
  const handleTerminalActionDraft = () =>
    saveThenRun((_blob, saveResult) => onTerminalActionDraft?.(saveResult));

  // PDF variant of the 'download' terminal action — same save-first flow,
  // then the host-converted PDF bytes. Gating (soft, with Download Anyway)
  // lives in handleDownloadPdf.
  const handleTerminalActionPdf = async () => {
    setTerminalRunning(true);
    try {
      await handleDownloadPdf();
    } finally {
      setTerminalRunning(false);
    }
  };

  // Restore the version currently open in the viewer. Confirms first (the
  // current document is saved as a version, so the restore is undoable), then
  // restores and returns to the live editor. Triggered by the floating action
  // in the viewer's bottom-right corner.
  const restoreViewingVersion = () => {
    if (!history || !viewingVersion) return;
    const target = viewingVersion;
    setGateWarning({
      title: 'Restore this version',
      message:
        'Restore this version? Your current document is saved ' +
        'as a version first, so you can undo this.',
      confirmLabel: 'Restore',
      confirmTitle: 'Restore this version',
      proceed: async () => {
        setGateWarning(null);
        try {
          // Persist in-progress edits as a proper, DIFFED version BEFORE
          // restoring. Restore otherwise snapshots the still-open session
          // docx-only on the backend, so those edits would lose their redlines
          // (the "saved as a version first" the dialog promises). Closing the
          // session here uploads its diff; the backend then sees it already
          // closed and skips the docx-only snapshot.
          await historySession.save();
          await history.restoreVersion(target.id);
          exitVersionView();
          restoredAtRef.current = Date.now();
          flashSaveToast('success', 'Restored — saved as a new version');
        } catch (err) {
          flashSaveToast('error', 'Could not restore this version');
          onError?.((err as Error).message || String(err));
        }
      }
    });
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
      {editor && viewingVersion && (
        <VersionBar
          version={viewingVersion}
          onExit={exitVersionView}
          editCount={versionMeta?.editCount}
          formatCount={versionMeta?.formatCount}
          pendingCount={versionMeta?.pendingCount}
          highlightsAvailable={!!versionMeta && !versionMeta.degraded}
          highlightsOn={highlightsOn}
          onToggleHighlights={setHighlightsOn}
          onPrevChange={() => stepChange(-1)}
          onNextChange={() => stepChange(1)}
        />
      )}
      {editor && !viewingVersion && (
        <DocxToolbar
          editor={editor}
          // Save stays visible even alongside a terminal action so users can
          // persist edits without committing to download/sign. Arrow-wrapped:
          // handleSave takes a force flag a raw click event must not satisfy.
          onSave={onSave ? () => handleSave() : undefined}
          // Secondary Download hides only when the terminal button IS the
          // download (one Download, not two) — beside Sign/Draft it stays, so
          // configuring Sign + Download shows both. Arrow-wrapped: the handlers
          // take a `force` flag a raw DOM click event would truthily satisfy.
          onDownload={
            hideDownload || terminalAction === 'download'
              ? undefined
              : () => handleDownload()
          }
          onDownloadPdf={
            hideDownload || terminalAction === 'download' || !onExportPdf
              ? undefined
              : () => handleDownloadPdf()
          }
          downloadBusy={exportingPdf || downloading}
          terminalAction={terminalAction}
          onTerminalAction={
            onTerminalAction ? () => handleTerminalAction() : undefined
          }
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
              // The theme gives the editor root its own 1px border; the side
              // panel / edge rail draw the right-hand seam themselves, so the
              // editor's copy would double it (visibly thicker when the panel
              // is collapsed and the rail sits flush against the editor).
              '& .e-de-ctn': { borderRight: 'none' },
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
          {history && viewingVersion && (
            <VersionViewer
              // Keyed only by highlight mode, NOT by version id, so switching
              // versions REUSES this editor (it just re-opens the new document)
              // instead of tearing down and rebuilding the heavy Syncfusion
              // container each time — the switch is far faster. Toggling
              // highlights still remounts so it re-opens with/without the marks.
              key={`hl:${highlightsOn}`}
              host={history}
              version={viewingVersion}
              serviceUrl={serviceUrl}
              headers={headers}
              highlightsOn={highlightsOn}
              // Present only for the in-progress current version: a live-diffed
              // display document to open directly (no stored files exist).
              liveDoc={liveDoc ?? undefined}
              onMeta={setVersionMeta}
              onViewerEditor={(ed) => {
                viewerEditorRef.current = ed;
                // Fresh editor (new version / highlight toggle): restart stepping.
                changeStepRef.current = -1;
              }}
            />
          )}
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
            // Closing the panel (its X) returns to the live editor: clear the
            // version view so the editing toolbar comes back.
            onClose={() => {
              setActivePanel(null);
              exitVersionView();
            }}
            reviewChanges={!!reviewChanges}
            onChangesCount={handleChangesCount}
            markDirty={markDirty}
            boundaryKey={`${railGeneration}:${openNonce ?? 0}`}
            history={history}
            currentUser={currentUser ?? DEFAULT_CURRENT_USER}
            // Every version opens read-only in the viewer with highlights; the
            // in-progress current version is diffed live inside selectVersion.
            onSelectVersion={selectVersion}
            // Report the loaded list up so the panel can auto-select the latest.
            onVersionsLoaded={setHistoryVersions}
            // Footer actions: Restore the open version; enabled while viewing,
            // but never for the current version (already the live document).
            onRestoreVersion={restoreViewingVersion}
            versionSelected={!!viewingVersion}
            restoreDisabled={!!viewingVersion?.is_current}
            selectedVersionId={viewingVersion?.id ?? null}
            // Unapproved Robin edits still tracked in the in-progress current
            // version — surfaced on its row while it's the one being viewed.
            currentPendingCount={
              viewingVersion?.is_current ? versionMeta?.pendingCount : undefined
            }
            // Reload the list whenever a save lands so a new version and the
            // "Current" tag stay fresh while the panel is open.
            historyRefreshKey={historySession.savedAt?.getTime() ?? 0}
          />
        )}
        {/* Slim edge rail on the far right: one icon per side panel. Always
            present so a panel is one click away and future panels can slot in. */}
        {editor && (
          <PanelRail
            activePanel={activePanel}
            showChanges={!!reviewChanges}
            changesCount={changesCount}
            showHistory={!!history}
            onToggle={(panel) =>
              setActivePanel((p) => {
                const next = p === panel ? null : panel;
                // Leaving the History panel returns to the live editor.
                if (p === 'history' && next !== 'history') exitVersionView();
                return next;
              })
            }
          />
        )}
      </div>
      {/* Binding-error prompt: a blocking modal. Portaled to the document body
          (same pattern as the toolbar menus) so the backdrop covers the whole
          page — nothing proceeds until the user picks the Anyway action
          (proceed despite invalid binding config) or cancels (button or Esc).
          Backdrop clicks are inert on purpose: the choice must be explicit. */}
      {gateWarning &&
        createPortal(
          <div
            css={{
              position: 'fixed',
              inset: 0,
              zIndex: 10001,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(24, 24, 27, 0.45)'
            }}
          >
            <div
              role='alertdialog'
              aria-modal='true'
              aria-label={gateWarning.title ?? 'Document has binding errors'}
              tabIndex={-1}
              ref={(node) => node?.focus()}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  gateWarning.cancel?.();
                  setGateWarning(null);
                }
              }}
              css={{
                width: 440,
                maxWidth: 'calc(100% - 48px)',
                boxSizing: 'border-box',
                padding: '20px 24px',
                borderRadius: 10,
                background: '#fff',
                color: '#27272a',
                border: '1px solid #e4e4e7',
                fontSize: 14,
                lineHeight: 1.5,
                boxShadow:
                  '0 0 0 1px rgb(0 9 50 / 4%), 0 24px 48px -12px rgb(0 9 50 / 25%)',
                outline: 'none'
              }}
            >
              <div
                css={{
                  fontSize: 15,
                  fontWeight: 600,
                  marginBottom: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8
                }}
              >
                <span
                  aria-hidden
                  css={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    flex: '0 0 auto',
                    background: '#fef3c7',
                    color: '#b45309',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                    fontWeight: 700
                  }}
                >
                  !
                </span>
                {gateWarning.title ?? 'Document has binding errors'}
              </div>
              <div
                css={{
                  marginBottom: gateWarning.proceed ? 18 : 8,
                  color: '#3f3f46'
                }}
              >
                {gateWarning.message}
              </div>
              {!gateWarning.proceed && (
                <div css={{ marginBottom: 18, color: '#71717a', fontSize: 13 }}>
                  Fix these errors before signing or sending the document.
                </div>
              )}
              <div
                css={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}
              >
                <button
                  type='button'
                  onClick={() => {
                    gateWarning.cancel?.();
                    setGateWarning(null);
                  }}
                  css={{
                    padding: '8px 14px',
                    borderRadius: 6,
                    border: '1px solid #e4e4e7',
                    background: '#fff',
                    color: '#3f3f46',
                    fontSize: 13,
                    cursor: 'pointer'
                  }}
                >
                  {gateWarning.proceed ? 'Cancel' : 'Close'}
                </button>
                {gateWarning.proceed && (
                  <button
                    type='button'
                    onClick={gateWarning.proceed}
                    title={gateWarning.confirmTitle}
                    css={{
                      padding: '8px 14px',
                      borderRadius: 6,
                      border: '1px solid transparent',
                      background: FEATHERY_RED,
                      color: '#fff',
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: 'pointer'
                    }}
                  >
                    {gateWarning.confirmLabel}
                  </button>
                )}
              </div>
            </div>
          </div>,
          featheryDoc().body
        )}
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
          {saveToast.type === 'success' && (
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
          )}
          {saveToast.type === 'error' && (
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
