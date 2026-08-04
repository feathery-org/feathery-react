import { useCallback, useEffect, useRef, useState } from 'react';
import { featheryDoc, featheryWindow } from '../../../utils/browser';
import { dynamicImport } from '../../../integrations/utils';
import {
  findReplaceCounterpart,
  installRevisionGroupIsolation,
  parseRevisionGroupTag
} from '../../../assistant/tools/syncfusionDocumentOps';
import { EJ2_SCRIPT_URL, EJ2_STYLE_URLS } from './constants';
import { DocxSource } from './types';

// Replaced by Rollup/Webpack from SYNCFUSION_LICENSE_KEY at package build
// time. The typeof guard keeps source-level test/dev transforms safe when they
// do not run either bundler.
declare const __SYNCFUSION_LICENSE_KEY__: string;
const BUILT_IN_SYNCFUSION_LICENSE_KEY =
  typeof __SYNCFUSION_LICENSE_KEY__ === 'undefined'
    ? ''
    : __SYNCFUSION_LICENSE_KEY__;

// Inject the Syncfusion theme CSS once (deduped across all editor instances).
const LOADED_STYLES = new Set<string>();
function loadStyles() {
  const doc = featheryDoc();
  EJ2_STYLE_URLS.forEach((href) => {
    if (LOADED_STYLES.has(href)) return;
    LOADED_STYLES.add(href);
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    doc.head.appendChild(link);
  });
  loadAccentOverride();
}

// The Syncfusion tailwind3 theme's accent is indigo (--color-sf-primary
// #6366f1). Retint the primary family to the Feathery red so the editor's
// accents — context menus, primary buttons, focus rings, selection highlight,
// title bar — match the rest of the product. Applied at :root because the
// context menu renders in a portal on <body>, out of the editor's subtree.
const ACCENT_STYLE_ID = 'feathery-docx-accent';
function loadAccentOverride() {
  const doc = featheryDoc();
  if (doc.getElementById(ACCENT_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = ACCENT_STYLE_ID;
  style.textContent = `:root{
    --color-sf-primary:#e2626e;
    --color-sf-primary-bg-color:#e2626e;
    --color-sf-primary-bg-color-hover:#dc3a4b;
    --color-sf-primary-bg-color-focus:#dc3a4b;
    --color-sf-primary-bg-color-pressed:#c9313f;
    --color-sf-primary-outline:#e2626e;
    --color-sf-primary-border-color:#e2626e;
    --color-sf-primary-border-color-hover:#dc3a4b;
    --color-sf-primary-border-color-focus:#dc3a4b;
    --color-sf-primary-border-color-pressed:#c9313f;
    --color-sf-primary-dark:#dc3a4b;
    --color-sf-primary-darker:#c9313f;
  }`;
  doc.head.appendChild(style);
}

// GitHub-style tracked-change rendering: insertions get a green highlight,
// deletions a red one, and a replace pair reads as red struck-through old
// text followed by green new text — one edit, resolved together. Revised
// text keeps its normal font color. Syncfusion draws the document on CANVAS,
// so this is a renderer
// patch, not CSS: `checkRevisionType()` is the single source feeding the
// author-color text and the underline/strike decorations across every render
// path (text, lists, images, paragraph marks) — blank it, then paint our own
// word-level decoration using the same geometry as Syncfusion's native
// highlighter fillRect. The patch also draws a boundary ring around the edit
// the review UI marks active, and records each pending edit's on-canvas
// geometry for overlays (margin gutter bars).
const REVISION_RENDER_PATCH = '__featheryGitHubRevisionRendering';
const INSERTION_HIGHLIGHT = '#d7e8b6';
const DELETION_HIGHLIGHT = '#ffd4d2';
const STRIKE_COLOR = 'rgba(23, 26, 28, 0.6)';
// Boundary ring on the active edit (mockup's `.chg.on`): a single line drawn
// fully INSIDE the highlight box, flush with its edge.
const RING_LINE = 'rgba(43, 49, 52, 0.34)';
const RING_WIDTH = 2;
const RING_RADIUS = 4;

// Editor-instance keys shared with the review UI and overlays.
const ACTIVE_REVISION_KEY = '__robinActiveRevision';
const ACTIVE_BOXES_KEY = '__robinActiveBoxes';
const REVISION_RECTS_KEY = '__robinRevisionRects';
const AFTER_RENDER_KEY = '__robinAfterRender';

/** One pending edit's painted extent, in viewport-canvas coordinates. */
export interface RevisionRect {
  kind: 'add' | 'del' | 'mod';
  top: number;
  bottom: number;
}

/**
 * Mark ONE edit as active in the document: the renderer draws a boundary
 * ring around every run of that revision (and its replace counterpart).
 * Repaints only when the value actually changes.
 */
export function setActiveInlineRevision(ed: any, revision: any): void {
  if (!ed) return;
  const next = revision ?? null;
  if ((ed[ACTIVE_REVISION_KEY] ?? null) === next) return;
  ed[ACTIVE_REVISION_KEY] = next;
  try {
    ed.viewer?.renderVisiblePages?.();
  } catch {
    // Repaint is best-effort; the next natural render picks the ring up.
  }
}

/** The geometry recorded during the last render pass (see RevisionRect). */
export function getRevisionRects(ed: any): Map<any, RevisionRect> {
  return ed?.[REVISION_RECTS_KEY] ?? new Map();
}

/** Subscribe to "a render pass just finished" (single subscriber). */
export function setAfterRenderCallback(ed: any, cb: (() => void) | null): void {
  if (ed) ed[AFTER_RENDER_KEY] = cb ?? undefined;
}

// Exported for tests (installed automatically at editor create).
export function installRevisionHighlightRendering(ed: any) {
  const renderer = ed?.documentHelper?.render;
  if (!renderer || renderer[REVISION_RENDER_PATCH]) return;
  renderer[REVISION_RENDER_PATCH] = true;

  // What this box's tracked content is, for decoration purposes. A run that
  // is both inserted and deleted (edited within an insertion) reads as a
  // deletion.
  const classifyBox = (
    elementBox: any
  ): { revision: any; kind: 'add' | 'del'; counterpart: any } | undefined => {
    const count = elementBox?.revisionLength ?? 0;
    let revision: any;
    let kind: 'add' | 'del' | undefined;
    for (let i = 0; i < count; i++) {
      const rev = elementBox.getRevision(i);
      const type = rev?.revisionType;
      if (type === 'Deletion' || type === 'MoveFrom') {
        revision = rev;
        kind = 'del';
        break;
      }
      if (type === 'Insertion' || type === 'MoveTo') {
        revision = rev;
        kind = 'add';
      }
    }
    if (!kind) return undefined;
    let counterpart: any;
    try {
      counterpart = findReplaceCounterpart(revision);
    } catch {
      counterpart = undefined;
    }
    return { revision, kind, counterpart };
  };

  // One gutter bar per edit: both halves of a replace accumulate under the
  // deletion revision. Human (untagged) edits get no bar.
  const recordRect = (
    info: { revision: any; kind: 'add' | 'del'; counterpart: any },
    box: { y: number; h: number }
  ) => {
    if (!parseRevisionGroupTag(info.revision?.customData)) return;
    const rects: Map<any, RevisionRect> =
      ed[REVISION_RECTS_KEY] ?? (ed[REVISION_RECTS_KEY] = new Map());
    const key =
      info.counterpart && info.kind === 'add'
        ? info.counterpart
        : info.revision;
    const entry = rects.get(key);
    if (entry) {
      entry.top = Math.min(entry.top, box.y);
      entry.bottom = Math.max(entry.bottom, box.y + box.h);
    } else {
      rects.set(key, {
        kind: info.counterpart ? 'mod' : info.kind,
        top: box.y,
        bottom: box.y + box.h
      });
    }
  };

  renderer.checkRevisionType = () => [];

  const originalRenderText = renderer.renderTextElementBox.bind(renderer);
  renderer.renderTextElementBox = (
    elementBox: any,
    left: number,
    top: number,
    underlineY: number
  ) => {
    const info = elementBox?.width > 0 ? classifyBox(elementBox) : undefined;
    let box: { x: number; y: number; w: number; h: number } | undefined;
    if (info) {
      box = {
        x: Math.floor(
          renderer.getScaledValue(left + (elementBox.margin?.left ?? 0), 1)
        ),
        y: Math.floor(
          renderer.getScaledValue(top + (elementBox.margin?.top ?? 0), 2) - 1
        ),
        w: Math.ceil(renderer.getScaledValue(elementBox.width) + 1),
        h: Math.ceil(renderer.getScaledValue(elementBox.height) + 1)
      };
      try {
        const ctx = renderer.pageContext;
        ctx.fillStyle =
          info.kind === 'del' ? DELETION_HIGHLIGHT : INSERTION_HIGHLIGHT;
        ctx.fillRect(box.x, box.y, box.w, box.h);
      } catch {
        // Highlight is decoration only; the text itself must still render.
      }
      recordRect(info, box);
    }
    const out = originalRenderText(elementBox, left, top, underlineY);
    if (info && box) {
      try {
        const ctx = renderer.pageContext;
        // The old half of a replace reads struck-through.
        if (info.counterpart && info.kind === 'del') {
          ctx.fillStyle = STRIKE_COLOR;
          ctx.fillRect(
            box.x,
            Math.round(box.y + box.h * 0.55),
            box.w,
            Math.max(1, Math.round(renderer.getScaledValue(0.8)))
          );
        }
        // Boxes of the active edit — both halves of a replace count as the
        // one edit — are collected and rung ONCE at the end of the page
        // render, so touching runs share a single merged ring. The line
        // widget identifies which text line the run sits on.
        const active = ed[ACTIVE_REVISION_KEY];
        if (
          active &&
          (info.revision === active || info.counterpart === active)
        ) {
          (ed[ACTIVE_BOXES_KEY] ?? (ed[ACTIVE_BOXES_KEY] = [])).push({
            ...box,
            line: elementBox.line
          });
        }
      } catch {
        // Decoration only; never break text rendering.
      }
    }
    return out;
  };

  // Boundary ring around the active edit, drawn after the page renders so
  // the ring sits on top of everything. Runs are grouped by the LINE they
  // sit on (never merged across lines — the ±1px box fudge makes adjacent
  // lines' boxes overlap vertically, which would union a wrapped edit into a
  // paragraph-wide rectangle), and within a line only TOUCHING runs merge
  // (a replace's delete+insert halves ring as one; disjoint runs of a split
  // revision ring separately rather than swallowing untouched text between).
  const drawActiveRing = (fromIndex: number) => {
    const boxes: Array<{
      x: number;
      y: number;
      w: number;
      h: number;
      line: any;
    }> = (ed[ACTIVE_BOXES_KEY] ?? []).slice(fromIndex);
    if (!boxes.length) return;
    const byLine = new Map<any, typeof boxes>();
    for (const b of boxes) {
      // Fall back to a coarse y-bucket if the line widget is unavailable.
      const key = b.line ?? `y:${Math.round(b.y / 8)}`;
      const group = byLine.get(key);
      if (group) group.push(b);
      else byLine.set(key, [b]);
    }
    const unions: Array<{
      x: number;
      y: number;
      right: number;
      bottom: number;
    }> = [];
    const TOUCH_GAP = 3;
    for (const group of byLine.values()) {
      const lineUnions: typeof unions = [];
      for (const b of group.sort((a, z) => a.x - z.x)) {
        const u = lineUnions[lineUnions.length - 1];
        if (u && b.x <= u.right + TOUCH_GAP) {
          u.x = Math.min(u.x, b.x);
          u.y = Math.min(u.y, b.y);
          u.right = Math.max(u.right, b.x + b.w);
          u.bottom = Math.max(u.bottom, b.y + b.h);
        } else {
          lineUnions.push({
            x: b.x,
            y: b.y,
            right: b.x + b.w,
            bottom: b.y + b.h
          });
        }
      }
      unions.push(...lineUnions);
    }
    try {
      const ctx = renderer.pageContext;
      ctx.save();
      ctx.strokeStyle = RING_LINE;
      ctx.lineWidth = RING_WIDTH;
      // Canvas strokes straddle the path, so inset by half the stroke width:
      // the ring's OUTER edge lands exactly on the highlight boundary — no
      // whitespace against the wash, no bleed into neighbouring characters.
      const inset = RING_WIDTH / 2;
      for (const u of unions) {
        const x = u.x + inset;
        const y = u.y + inset;
        const w = u.right - u.x - RING_WIDTH;
        const h = u.bottom - u.y - RING_WIDTH;
        if (w <= 0 || h <= 0) continue;
        if (typeof ctx.roundRect === 'function') {
          ctx.beginPath();
          ctx.roundRect(x, y, w, h, RING_RADIUS);
          ctx.stroke();
        } else {
          ctx.strokeRect(x, y, w, h);
        }
      }
      ctx.restore();
    } catch {
      // Decoration only.
    }
  };

  // Per-page hook on the renderer itself (renderWidgets renders ONE page):
  // reset the geometry collections when the first visible page starts, draw
  // this page's share of the active ring when it finishes (after its content,
  // before the next page), and publish the pass when the last page is done.
  // Hooking the renderer — not the viewer — survives whatever render path
  // triggered the pass.
  const originalRenderWidgets = renderer.renderWidgets.bind(renderer);
  renderer.renderWidgets = (
    page: any,
    left: number,
    top: number,
    width: number,
    height: number
  ) => {
    const visible: any[] = ed.viewer?.visiblePages ?? [];
    if (!visible.length || visible[0] === page) {
      ed[REVISION_RECTS_KEY] = new Map();
      ed[ACTIVE_BOXES_KEY] = [];
    }
    const startCount = (ed[ACTIVE_BOXES_KEY] ?? []).length;
    const out = originalRenderWidgets(page, left, top, width, height);
    drawActiveRing(startCount);
    if (!visible.length || visible[visible.length - 1] === page) {
      try {
        ed[AFTER_RENDER_KEY]?.();
      } catch {
        // A subscriber's failure must not break rendering.
      }
    }
    return out;
  };
}

async function resolveBuffer(source: DocxSource): Promise<ArrayBuffer> {
  if ('buffer' in source) return source.buffer;
  const res = await fetch(source.url);
  if (!res.ok) {
    throw new Error(`Failed to fetch document (${res.status})`);
  }
  return res.arrayBuffer();
}

// scriptjs can report the CDN bundle "loaded" a beat before the (multi-MB) ej2
// UMD finishes attaching `ej` to window (notably under Next). Poll for it rather
// than checking once.
function waitForEj(timeoutMs = 15000): Promise<any> {
  return new Promise((resolve) => {
    const done = () => (featheryWindow() as any).ej?.documenteditor;
    if (done()) return resolve((featheryWindow() as any).ej);
    const start = Date.now();
    const iv = setInterval(() => {
      if (done() || Date.now() - start > timeoutMs) {
        clearInterval(iv);
        resolve((featheryWindow() as any).ej);
      }
    }, 50);
  });
}

interface Props {
  source?: DocxSource;
  licenseKey?: string;
  serviceUrl?: string;
  /** Extra headers for Syncfusion serviceUrl requests (e.g. Feathery auth). */
  headers?: Record<string, string>[];
  readOnly?: boolean;
  /** Bump to force a reopen of the same source URL (e.g. after regenerate). */
  openNonce?: number;
  onReady?: () => void;
  /** Hands the live DocumentEditor instance to the host (e.g. the AI assistant
   *  drives the document directly through this — no iframe boundary). */
  onEditorReady?: (editor: any) => void;
  onDirty?: () => void;
  onError?: (error: string) => void;
}

interface Result {
  containerRef: React.RefObject<HTMLDivElement | null>;
  editor: any;
  loading: boolean;
  error: string | null;
  exportDoc: () => Promise<Blob>;
  resize: () => void;
}

// Loads Syncfusion from the CDN at runtime and mounts the DocumentEditorContainer
// directly into the page (no iframe). The editor instance is exposed so the
// toolbar — and the AI assistant — can drive it via its API directly.
export function useDocxEditor({
  source,
  licenseKey,
  serviceUrl,
  headers,
  readOnly,
  openNonce = 0,
  onReady,
  onEditorReady,
  onDirty,
  onError
}: Props): Result {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const containerInstRef = useRef<any>(null);
  // Ignore Syncfusion contentChange while we are programmatically opening a
  // document — those events fire during load/destroy and must not mark dirty
  // or kick off host re-renders mid-flight.
  const ignoreContentChangeRef = useRef(true);
  const onDirtyRef = useRef(onDirty);
  onDirtyRef.current = onDirty;
  const [editor, setEditor] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isReadOnly = !!readOnly;

  const fail = useCallback(
    (err: unknown) => {
      const msg = (err as Error)?.message || String(err);
      console.error('Feathery document editor error:', msg);
      setError(msg);
      setLoading(false);
      onError?.(msg);
    },
    [onError]
  );

  const headersKey = JSON.stringify(headers ?? []);
  // A caller may still override the package-bundled key explicitly. Normal
  // Feathery form usage needs no license configuration when the package was
  // built with SYNCFUSION_LICENSE_KEY.
  const resolvedLicenseKey = licenseKey || BUILT_IN_SYNCFUSION_LICENSE_KEY;

  // Load the CDN assets and instantiate the editor. Recreated only if license
  // or serviceUrl changes — NOT on readOnly toggles (those update in place).
  // Recreating mid-fetch/open destroys Syncfusion while it still holds null
  // internal state and surfaces as "Cannot convert undefined or null to object".
  useEffect(() => {
    let cancelled = false;
    let instance: any = null;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        ignoreContentChangeRef.current = true;
        loadStyles();
        await dynamicImport(EJ2_SCRIPT_URL);
        const ej = await waitForEj();
        if (cancelled) return;
        if (!ej?.documenteditor) {
          throw new Error('Syncfusion Document Editor failed to load');
        }
        if (!containerRef.current) return;

        if (resolvedLicenseKey) {
          ej.base.registerLicense(resolvedLicenseKey);
        }
        ej.documenteditor.DocumentEditorContainer.Inject(
          ej.documenteditor.Toolbar
        );
        instance = new ej.documenteditor.DocumentEditorContainer({
          enableToolbar: false,
          showPropertiesPane: false,
          serviceUrl: serviceUrl || '',
          headers: headers || [],
          height: '100%'
        });
        // Wait until Syncfusion finishes creating the inner DocumentEditor —
        // opening a doc before `created` leaves a blank default document.
        await new Promise<void>((resolve, reject) => {
          const t = featheryWindow().setTimeout(
            () => reject(new Error('Document editor failed to create')),
            15000
          );
          instance.addEventListener('created', () => {
            featheryWindow().clearTimeout(t);
            resolve();
          });
          instance.appendTo(containerRef.current);
        });
        if (cancelled) return;
        containerInstRef.current = instance;

        const ed = instance.documentEditor;
        if (!ed) {
          throw new Error('Document editor instance missing after create');
        }
        ed.isReadOnly = isReadOnly;
        ed.addEventListener('contentChange', () => {
          if (ignoreContentChangeRef.current) return;
          onDirtyRef.current?.();
        });
        // Native right-click menu — insert/delete table rows & columns,
        // cut/copy/paste, etc. (the built-in toolbar is disabled).
        ed.enableContextMenu = true;
        try {
          // The grouped review panel (TrackedChangeGroups) is this editor's
          // review surface. Syncfusion auto-opens its own Changes pane the
          // moment tracked changes appear (reviewPaneHelper), covering the
          // panel — mark the pane user-closed, the same switch its ✕ sets,
          // so the auto-open never fires.
          ed.showRevisions = false;
          if (ed.commentReviewPane) ed.commentReviewPane.isUserClosed = true;
          // Tagged tracked changes from different accept groups must not
          // coalesce into one revision; see installRevisionGroupIsolation.
          installRevisionGroupIsolation(ed);
          // GitHub-style change rendering: green/red highlights, no author
          // color, no underline/strikethrough.
          installRevisionHighlightRendering(ed);
        } catch {
          // Review-pane/grouping setup must never block the editor mount.
        }
        setEditor(ed);
        onEditorReady?.(ed);

        // With no source the editor opens a blank document immediately.
        if (!source) {
          ignoreContentChangeRef.current = false;
          setLoading(false);
          onReady?.();
        }
      } catch (err) {
        if (!cancelled) fail(err);
      }
    })();

    return () => {
      cancelled = true;
      ignoreContentChangeRef.current = true;
      setEditor(null);
      try {
        instance?.destroy?.();
      } catch {
        /* editor already torn down */
      }
      containerInstRef.current = null;
    };
    // `source` / `isReadOnly` intentionally omitted — open and readOnly are
    // handled by sibling effects so we never tear down mid-fetch.
  }, [resolvedLicenseKey, serviceUrl, headersKey]);

  // Apply read-only in place; do not recreate the editor.
  useEffect(() => {
    if (!editor) return;
    editor.isReadOnly = isReadOnly;
  }, [editor, isReadOnly]);

  // Open / re-open the source document. Syncfusion's open() takes SFDT text —
  // NOT a .docx blob — so a .docx is converted server-side first: POST it to
  // `${serviceUrl}Import` (multipart field "files"); the response is SFDT,
  // sometimes wrapped in `{"sfdt": "..."}` depending on the service build.
  // Depend on the URL/buffer identity (not the wrapper object) so parent
  // re-renders that recreate `{ url }` don't cancel an in-flight open.
  const sourceUrl = source && 'url' in source ? source.url : undefined;
  const sourceBuffer = source && 'buffer' in source ? source.buffer : undefined;

  useEffect(() => {
    if (!editor || (!sourceUrl && !sourceBuffer)) return;
    let cancelled = false;
    const openSource: DocxSource = sourceBuffer
      ? { buffer: sourceBuffer }
      : { url: sourceUrl as string };

    (async () => {
      try {
        ignoreContentChangeRef.current = true;
        setLoading(true);
        setError(null);
        const buffer = await resolveBuffer(openSource);
        if (cancelled) return;
        if (!serviceUrl) {
          throw new Error('serviceUrl is required to open a .docx');
        }
        // Match the dashboard DocxPage path: hand Syncfusion the .docx blob
        // and let it convert via serviceUrl. Manual Import→SFDT was returning
        // optimized/base64 SFDT that open() often left as a blank document.
        const blob = new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        });
        const liveEditor = containerInstRef.current?.documentEditor ?? editor;
        if (typeof liveEditor.openAsync === 'function') {
          await liveEditor.openAsync(blob);
        } else {
          liveEditor.open(blob);
        }
        if (cancelled) return;
        ignoreContentChangeRef.current = false;
        setLoading(false);
        onReady?.();
      } catch (err) {
        if (!cancelled) fail(err);
      }
    })();

    return () => {
      cancelled = true;
      ignoreContentChangeRef.current = true;
    };
  }, [editor, sourceUrl, sourceBuffer, serviceUrl, openNonce]);
  const exportDoc = useCallback((): Promise<Blob> => {
    if (!editor) return Promise.reject(new Error('Editor is not ready'));
    return editor.saveAsBlob('Docx');
  }, [editor]);

  const resize = useCallback(() => containerInstRef.current?.resize?.(), []);

  // DocumentEditorContainer caches its layout geometry at `created` and never
  // observes its host box, so a later resize leaves it laid out against stale
  // dimensions until something forces a reflow — opening a document was that
  // trigger, hence the jump. rAF-coalesced: resize() is a full relayout, and
  // deferring out of the observer callback avoids an undelivered-notifications
  // warning. Watch the parent: resize() pins an inline px width on the host,
  // so an observer there goes deaf after one tick.
  useEffect(() => {
    const el = containerRef.current?.parentElement;
    if (!el || !editor) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (frame) return;
      frame = featheryWindow().requestAnimationFrame(() => {
        frame = 0;
        // Resizing to 0 while hidden makes Syncfusion compute a degenerate
        // layout it does not recover from when the box returns.
        const { width, height } = el.getBoundingClientRect();
        if (width > 0 && height > 0) {
          // Syncfusion latches this in its window handler, it gates re-measure
          editor.isContainerResize = false;
          containerInstRef.current?.resize?.();
          // resize() relays out but never refits the zoom, and the built-in
          // status bar only redraws its label when told to
          if (editor.viewer?.zoomType === 'FitPageWidth') {
            editor.fitPage('FitPageWidth');
            containerInstRef.current?.statusBar?.updateZoomContent?.();
          }
        }
      });
    });
    observer.observe(el);
    return () => {
      if (frame) featheryWindow().cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [editor]);

  return { containerRef, editor, loading, error, exportDoc, resize };
}
