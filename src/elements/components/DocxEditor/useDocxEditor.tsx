import { useCallback, useEffect, useRef, useState } from 'react';
import { featheryDoc, featheryWindow } from '../../../utils/browser';
import { dynamicImport } from '../../../integrations/utils';
import {
  disableUserTrackChanges,
  findReplaceCounterpart,
  installRevisionGroupIsolation,
  installTrackedContentControlDeletion,
  preserveDocumentViewDuring,
  registerWrappingDocumentEditorContainer
} from '../../../utils/documentEditorPrimitives';
import { EJ2_SCRIPT_URL, EJ2_STYLE_URLS } from './constants';
import { stampMissingContentControlColors } from './contentControlSafety';
import { installDocumentTailInvariant } from './documentTailInvariant';
import { DocxSource } from './types';
import {
  DocxBindingsState,
  useDocxBindings,
  UseDocxBindingsOptions
} from './bindings/useDocxBindings';

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

// GitHub-style tracked-change rendering: green wash for insertions, red wash
// + red struck text for deletions, replace = struck old + green new. The
// document is drawn on CANVAS, so this is a renderer patch, not CSS — blank
// `checkRevisionType()` (sole source of native revision styling) and paint
// our own decoration; also rings the active edit and records edit geometry.
const REVISION_RENDER_PATCH = '__featheryGitHubRevisionRendering';
// The add/del washes from the design mockup's light palette.
const INSERTION_HIGHLIGHT = 'rgba(14, 122, 77, 0.15)';
const DELETION_HIGHLIGHT = 'rgba(176, 48, 43, 0.15)';
// Deleted GLYPHS render in the palette's red; added text keeps the
// document's own font color.
const DELETION_TEXT_COLOR = '#b0302b';
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
// Opening a document plants Syncfusion's default caret, firing a
// selectionChange indistinguishable from a real click; the rail ignores it.
const OPENING_DOCUMENT_KEY = '__featheryOpeningDocument';

/** True while a source document is being opened/reopened on this editor. */
export function isOpeningDocument(ed: any): boolean {
  return !!ed?.[OPENING_DOCUMENT_KEY];
}

// A conversion that never completes must not strand the editor in `loading`.
const DOCUMENT_LOAD_TIMEOUT_MS = 20000;

/**
 * Resolves when Syncfusion finishes laying the document out. `documentChange`
 * fires exactly once per open, after open()/openAsync() has already resolved,
 * and is the only signal that the document is really on screen.
 */
function waitForDocumentLoad(ed: any): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        ed.removeEventListener?.('documentChange', finish);
      } catch {
        /* instance already torn down */
      }
      resolve();
    };
    try {
      ed.addEventListener?.('documentChange', finish);
    } catch {
      finish();
      return;
    }
    setTimeout(finish, DOCUMENT_LOAD_TIMEOUT_MS);
  });
}

/** One pending edit's painted extent, in viewport-canvas coordinates. */
export interface RevisionRect {
  kind: 'add' | 'del' | 'mod';
  top: number;
  bottom: number;
}

const sameRevisionSet = (a: Set<any> | null, b: Set<any> | null): boolean => {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
};

/** Mark a set of edits active: the renderer rings each one's runs and its
 *  replace counterpart's. Repaints only when the set actually changes. */
export function setActiveInlineRevisions(ed: any, revisions: any[]): void {
  if (!ed) return;
  const next = revisions.length ? new Set(revisions) : null;
  if (sameRevisionSet(ed[ACTIVE_REVISION_KEY] ?? null, next)) return;
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

  // A run that is both inserted and deleted (edited within an insertion)
  // reads as a deletion.
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

  // One gutter bar per edit (human edits included); a replace's halves
  // accumulate under the deletion revision.
  const recordRect = (
    info: { revision: any; kind: 'add' | 'del'; counterpart: any },
    box: { y: number; h: number }
  ) => {
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
    let out;
    if (info?.kind === 'del') {
      // Per-call swap: the fake Deletion entry makes the engine itself draw
      // red glyphs + its baseline-aware single strike (no Insertion type in
      // the entry → no underline).
      const prevCheck = renderer.checkRevisionType;
      renderer.checkRevisionType = () => [
        { type: 'Deletion', color: DELETION_TEXT_COLOR }
      ];
      try {
        out = originalRenderText(elementBox, left, top, underlineY);
      } finally {
        renderer.checkRevisionType = prevCheck;
      }
    } else {
      out = originalRenderText(elementBox, left, top, underlineY);
    }
    if (info && box) {
      try {
        // Active-edit boxes (either replace half counts) are rung ONCE at
        // page end so touching runs share a merged ring; `line` scopes them.
        const active: Set<any> | null = ed[ACTIVE_REVISION_KEY];
        if (
          active &&
          (active.has(info.revision) || active.has(info.counterpart))
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

  // Tracked table rows: the engine REPLACES each cell's real background with
  // an opaque revision tint, hiding the table's styling. Hide the row
  // revision from the original call so true shading paints, then overlay the
  // same translucent wash tracked text gets.
  if (typeof renderer.renderCellBackground === 'function') {
    const originalRenderCellBackground =
      renderer.renderCellBackground.bind(renderer);
    renderer.renderCellBackground = (
      height: number,
      cellWidget: any,
      leftMargin: number,
      rightMargin: number,
      lineWidth: number
    ) => {
      const rowFormat = cellWidget?.ownerRow?.rowFormat;
      const count = rowFormat?.revisionLength ?? 0;
      if (!count) {
        return originalRenderCellBackground(
          height,
          cellWidget,
          leftMargin,
          rightMargin,
          lineWidth
        );
      }
      // Same choice the engine makes: the row's LAST revision decides.
      let wash = INSERTION_HIGHLIGHT;
      try {
        const type = rowFormat.getRevision?.(count - 1)?.revisionType;
        if (type === 'Deletion' || type === 'MoveFrom')
          wash = DELETION_HIGHLIGHT;
      } catch {
        // Unreadable revision: keep the insertion wash.
      }
      // `revisionLength` is a configurable prototype getter: an own-property
      // shadow hides it for this call; deleting the shadow restores it.
      let shadowed = false;
      try {
        Object.defineProperty(rowFormat, 'revisionLength', {
          value: 0,
          configurable: true
        });
        shadowed = true;
      } catch {
        // Not shadowable: fall through to native tinting rather than lose
        // the change indicator entirely.
      }
      let out;
      try {
        out = originalRenderCellBackground(
          height,
          cellWidget,
          leftMargin,
          rightMargin,
          lineWidth
        );
      } finally {
        if (shadowed) delete rowFormat.revisionLength;
      }
      if (shadowed) {
        try {
          // The original's own cell-rect math, scaled the same way.
          const ctx = renderer.pageContext;
          const left = cellWidget.x - leftMargin - lineWidth / 2;
          const top =
            cellWidget.y -
            (cellWidget.margin.top - cellWidget.containerWidget.topBorderWidth);
          const width =
            cellWidget.width + leftMargin + rightMargin + lineWidth / 2;
          ctx.fillStyle = wash;
          ctx.fillRect(
            renderer.getScaledValue(left, 1),
            renderer.getScaledValue(top, 2),
            renderer.getScaledValue(width),
            renderer.getScaledValue(height)
          );
        } catch {
          // Wash is decoration only; the cell already painted its shading.
        }
      }
      return out;
    };
  }

  // Active-edit boundary ring, drawn after page content. Boxes group by LINE
  // (the ±1px fudge overlaps adjacent lines vertically — cross-line unions
  // would ring the whole paragraph) and only TOUCHING runs merge within a
  // line, so a replace rings as one while disjoint runs ring separately.
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
      // Strokes straddle the path: inset by half the width so the ring's
      // OUTER edge lands on the highlight boundary (no gap, no bleed).
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

  // Per-page hook (renderWidgets renders ONE page): reset collections on the
  // first visible page, ring each page after its content, publish after the
  // last. Hooking the renderer — not the viewer — survives every render path.
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

  // SyncFusion paints a repeat header on continuation pages from a throwaway
  // table clone and re-registers the clone's revisions on every paint. With a
  // pending revision in a repeat-header row that walk throws mid-paint and
  // every later page stays blank, so registration is off while the painter runs
  if (typeof renderer.renderHeader === 'function') {
    const originalRenderHeader = renderer.renderHeader.bind(renderer);
    renderer.renderHeader = (page: any, widget: any, header: any) => {
      const editorModule = ed.editorModule ?? ed.editor;
      if (!editorModule) return originalRenderHeader(page, widget, header);
      const constructForTable = editorModule.constructRevisionsForTable;
      const constructFromID = editorModule.constructRevisionFromID;
      editorModule.constructRevisionsForTable = () => {};
      editorModule.constructRevisionFromID = () => {};
      try {
        return originalRenderHeader(page, widget, header);
      } finally {
        editorModule.constructRevisionsForTable = constructForTable;
        editorModule.constructRevisionFromID = constructFromID;
      }
    };
  }
}

// Keep every shared-surface review customization behind the same predicate as
// the rail. Gated-off editors retain Syncfusion's native rendering, Changes
// pane, and revision merge behavior.
export function configureTrackedChangeReview(ed: any, enabled: boolean): void {
  if (!enabled) return;
  ed.showRevisions = false;
  // Assist is the only author that may turn tracking on, and only inside a
  // synchronous write batch. User typing in a review host starts untracked.
  disableUserTrackChanges(ed);
  if (ed.commentReviewPane) ed.commentReviewPane.isUserClosed = true;
  installRevisionGroupIsolation(ed);
  installRevisionHighlightRendering(ed);
}

export function resizeDocxEditor(
  container: any,
  editor: any,
  refitZoom = false
): void {
  if (!container) return;
  if (!editor) {
    container.resize?.();
    return;
  }
  preserveDocumentViewDuring(editor, () => {
    editor.isContainerResize = false;
    if (typeof editor.resize === 'function') editor.resize();
    else container.resize?.();
    if (refitZoom && editor.viewer?.zoomType === 'FitPageWidth') {
      editor.fitPage('FitPageWidth');
      container.statusBar?.updateZoomContent?.();
    }
  });
}

// Table row-height drag-resize is dead code in Syncfusion 34.1.31: hovering a
// row's bottom edge shows the row-resize cursor and mousedown records undo
// state, but handleResizing's row branch computes the drag distance and never
// applies it (resizeTableRow exists, referenced nowhere). Wiring it up as-is
// would still misresize: updateRowHeight adds the pixel-space drag straight
// into rowFormat.height, which the engine reads as POINTS everywhere else, and
// resizeTableRow's startingPoint advance mixes the same two units. Replace
// both with pixel-consistent versions (converting to points exactly once, at
// the rowFormat.height write) and route the row branch into them. Undo/redo
// needs nothing: the resize history already snapshots rowFormat.height
// before/after the drag and only awaited the mutation itself.
const ROW_RESIZE_PATCH = '__featheryTableRowResizeFix';
// One drag gesture's state: base height at mousedown + accumulated travel.
const ROW_DRAG_GESTURE = '__featheryRowDragGesture';
// Word's minimum row height: 2.7pt == 3.6px.
const MIN_ROW_HEIGHT_PX = 3.6;
const PX_PER_PT = 96 / 72;

// Exported for tests (installed automatically at editor create).
export function installTableRowResizeFix(ed: any) {
  const tableResize = ed?.editorModule?.tableResize;
  if (!tableResize || tableResize[ROW_RESIZE_PATCH]) return;
  if (
    typeof tableResize.handleResizing !== 'function' ||
    typeof tableResize.resizeTableRow !== 'function' ||
    typeof tableResize.updateRowHeight !== 'function' ||
    typeof tableResize.getRowFormatHeight !== 'function' ||
    typeof tableResize.handleResize !== 'function' ||
    typeof tableResize.updateResizingHistory !== 'function' ||
    // Upstream wired the row branch up (or reshaped the module): leave the
    // native implementation alone. EJ2_VERSION is pinned, so this probe only
    // decides behavior across deliberate version bumps.
    /resizeTableRow/.test(tableResize.handleResizing.toString())
  ) {
    return;
  }
  tableResize[ROW_RESIZE_PATCH] = true;

  // dragValue is in unzoomed document pixels throughout: the viewer divides
  // pointer offsets by zoomFactor before they reach TableResizer, and the
  // column branch consumes the same delta with no further conversion.
  //
  // A drag is a stream of increments (the engine advances startingPoint after
  // each applied move). Re-deriving "current height" from RENDERED widget
  // geometry on every move feeds layout rounding (cell margins, page reflow)
  // back into the next increment and the row jitters around the mouse — so
  // the base height is captured ONCE per gesture and every move resizes to
  // base + total mouse travel. The gesture resets at mousedown/mouseup.
  tableResize.updateRowHeight = function (row: any, dragValue: number) {
    const rowFormat = row.rowFormat;
    let gesture = this[ROW_DRAG_GESTURE];
    if (!gesture) {
      gesture = this[ROW_DRAG_GESTURE] = {
        basePx:
          rowFormat.heightType === 'Exactly'
            ? rowFormat.height * PX_PER_PT
            : // Rendered height (max cell widget height) — already pixels.
              this.getRowFormatHeight(row),
        travelPx: 0
      };
    }
    gesture.travelPx += dragValue;
    const newPx = Math.max(
      gesture.basePx + gesture.travelPx,
      MIN_ROW_HEIGHT_PX
    );
    if (rowFormat.heightType === 'Auto') rowFormat.heightType = 'AtLeast';
    rowFormat.height = newPx / PX_PER_PT;
  };

  const originalHandleResize = tableResize.handleResize.bind(tableResize);
  tableResize.handleResize = function (point: any) {
    // Mousedown starts a fresh gesture.
    this[ROW_DRAG_GESTURE] = null;
    return originalHandleResize(point);
  };

  const originalUpdateResizingHistory =
    tableResize.updateResizingHistory.bind(tableResize);
  tableResize.updateResizingHistory = function (point: any) {
    // Mouseup ends the gesture.
    this[ROW_DRAG_GESTURE] = null;
    return originalUpdateResizingHistory(point);
  };

  // The original (never-invoked) implementation, minus its Exactly-row
  // startingPoint advance that converted the pixel delta as if it were points.
  tableResize.resizeTableRow = function (dragValue: number) {
    let table = this.currentResizingTable;
    if (!table || !dragValue || this.resizerPosition === -1) return;
    const selection = this.owner.selectionModule;
    // Skip child-table layout while mutating; the parent relayouts below.
    if (table.isInsideTable) this.owner.isLayoutEnabled = false;
    const row = table.childWidgets?.[this.resizerPosition];
    if (row) {
      this.updateRowHeight(row, dragValue);
      selection.selectPosition(selection.start, selection.end);
    }
    if (table.isInsideTable) {
      table = this.owner.documentHelper.layout.getParentTable(table);
      this.owner.isLayoutEnabled = true;
    }
    if (row) this.startingPoint.y += dragValue;
    this.owner.documentHelper.layout.reLayoutTable(table);
    this.owner.editorModule.isSkipOperationsBuild =
      this.owner.enableCollaborativeEditing;
    this.owner.editorModule.reLayout(this.owner.selectionModule);
    this.owner.editorModule.isSkipOperationsBuild = false;
    if (
      this.currentResizingTable &&
      this.currentResizingTable.childWidgets?.[this.resizerPosition] ===
        undefined
    ) {
      this.resizerPosition = -1;
    }
  };

  const originalHandleResizing = tableResize.handleResizing.bind(tableResize);
  tableResize.handleResizing = function (
    touchPoint: any,
    isTableMarkerDragging?: boolean,
    dragValue?: number
  ) {
    if (!isTableMarkerDragging && this.resizeNode === 1) {
      this.owner.isShiftingEnabled = true;
      this.resizeTableRow(touchPoint.y - this.startingPoint.y);
      return;
    }
    return originalHandleResizing(touchPoint, isTableMarkerDragging, dragValue);
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

export interface DocxBindingsConfig
  extends Omit<UseDocxBindingsOptions, 'editor' | 'loading' | 'readOnly'> {
  enabled?: boolean;
}

interface Props {
  source?: DocxSource;
  licenseKey?: string;
  serviceUrl?: string;
  /** Extra headers for Syncfusion serviceUrl requests (e.g. Feathery auth). */
  headers?: Record<string, string>[];
  readOnly?: boolean;
  /** Must match the condition that mounts TrackedChangeGroups. */
  reviewChanges?: boolean;
  /** Bump to force a reopen of the same source URL (e.g. after regenerate). */
  openNonce?: number;
  onReady?: () => void;
  /** Hands the live DocumentEditor instance to the host (e.g. the AI assistant
   *  drives the document directly through this — no iframe boundary). */
  onEditorReady?: (editor: any) => void;
  onDirty?: () => void;
  onError?: (error: string) => void;
  /**
   * Opt-in document bindings: [[...]] tokens become live fields and formulas that
   * recalculate as the document is edited. Absent or disabled means not one line
   * of binding code runs, and the editor behaves exactly as it always has.
   */
  bindings?: DocxBindingsConfig;
}

interface Result {
  containerRef: React.RefObject<HTMLDivElement | null>;
  editor: any;
  loading: boolean;
  error: string | null;
  exportDoc: () => Promise<Blob>;
  resize: () => void;
  bindings: DocxBindingsState;
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
  reviewChanges = false,
  openNonce = 0,
  onReady,
  onEditorReady,
  onDirty,
  onError,
  bindings
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
  const bindingsEnabled = !!bindings?.enabled;

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

  // Changing the review gate must recreate the instance (so an editor that
  // becomes gated-off cannot retain instance-scoped patches) - but never while
  // a create/open is in flight: destroying Syncfusion mid-open leaves it with
  // null internal state and surfaces as "Cannot convert undefined or null to
  // object". Hold a gate flip until the load settles (`loading` covers both
  // the create and the open; an open failure also settles it via fail()).
  const [reviewGate, setReviewGate] = useState(reviewChanges);
  const reviewGateRef = useRef(reviewGate);
  reviewGateRef.current = reviewGate;
  useEffect(() => {
    if (reviewChanges !== reviewGate && !loading) setReviewGate(reviewChanges);
  }, [reviewChanges, reviewGate, loading]);

  // The document as it stands, carried across an instance recreation.
  //
  // A gate flip is not a document change - and the host derives the gate from
  // `readOnly` (`assistantEnabled && !readOnly`), so finalizing an envelope for
  // signature flips it mid-session. Recreating the instance then re-ran the open
  // effect, which re-fetches `sourceUrl` - the PRE-SAVE url - and the editor came
  // back holding older bytes than the ones the user was just looking at:
  // unreviewed assistant edits and unsaved typing, gone with no signal at all.
  //
  // So the recreation carries the live document with it. Only when there is
  // something to lose: a pristine document re-opens from its source exactly as
  // before, which stays the most faithful path for it. The stash is keyed to the
  // source it came from, so a regenerate (new url, or a bumped `openNonce`)
  // always wins over it.
  const carriedRef = useRef<{ sfdt: string; key: string } | null>(null);
  const unsavedRef = useRef(false);
  // The key of the document currently OPEN in the instance - not the key the
  // props describe. They differ for exactly one render when a gate flip and a
  // regenerate land together, and stamping the stash with the incoming key there
  // would restore the outgoing document into the new one.
  const openedKeyRef = useRef('');

  // Load the CDN assets and instantiate the editor. Ordinary readOnly updates
  // happen in place; changing the review gate recreates the instance so an
  // editor that becomes gated-off cannot retain instance-scoped patches.
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
          height: '100%',
          // Syncfusion minifies serialized SFDT by default, renaming every key
          // the binding engine AND the section-outline reader rely on - a
          // document would come back looking like it had no bindings and no
          // sections at all. Construction is the only place this reliably takes
          // effect. Set unconditionally: section reordering is always available,
          // so every editor must serialize verbose keys (the only cost is a
          // slightly larger serialize payload on save/export).
          documentEditorSettings: { optimizeSfdt: false }
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
        // Assistant batches operate on the inner editor, but SyncFusion also
        // caches track-changes on this wrapping container. Keep that ownership
        // relationship available at the common batch boundary so both flags
        // can always return to user-editing mode together.
        registerWrappingDocumentEditorContainer(ed, instance);
        installDocumentTailInvariant(
          ed,
          ej.documenteditor.HelperMethods?.getSfdtDocument?.bind(
            ej.documenteditor.HelperMethods
          )
        );
        // SyncFusion rebuilds its page DOM after a tracked edit. Chromium's
        // generic scroll anchoring then treats that controlled relayout as
        // newly inserted page content and adjusts scrollTop a frame after the
        // editor transaction has restored its viewport. The editor already
        // owns cursor/viewport mapping, so leave browser anchoring disabled on
        // its private scroller and let SyncFusion remain the sole scroll owner.
        const viewer = ed.documentHelper?.viewerContainer as
          | HTMLElement
          | undefined;
        if (viewer) viewer.style.overflowAnchor = 'none';
        ed.isReadOnly = isReadOnly;
        ed.addEventListener('contentChange', () => {
          if (ignoreContentChangeRef.current) return;
          unsavedRef.current = true;
          onDirtyRef.current?.();
        });
        // Native right-click menu — insert/delete table rows & columns,
        // cut/copy/paste, etc. (the built-in toolbar is disabled).
        ed.enableContextMenu = true;
        try {
          configureTrackedChangeReview(ed, reviewGate);
          if (reviewGate) disableUserTrackChanges(ed, instance);
          // Engine-level fixes to the editing surface itself, not review
          // customizations: every host gets them, gated or not.
          installTableRowResizeFix(ed);
          installTrackedContentControlDeletion(ed);
          // Status bar (bottom right): hide the Web-layout toggle — it flips
          // the document into continuous view, which breaks the paginated
          // editing/print flows this editor is built around.
          const webButton = instance.statusBar?.webButton;
          if (webButton?.style) webButton.style.display = 'none';
        } catch {
          // Review-pane/grouping/engine patches must never block the mount.
        }
        setEditor(ed);
        onEditorReady?.(ed);

        // With no source the editor opens a blank document immediately - and
        // there is no open effect to put a carried document back, so it happens
        // here instead. Typing into a sourceless editor is work like any other.
        if (!source) {
          const carried = carriedRef.current;
          carriedRef.current = null;
          if (carried && carried.key === openKeyRef.current) {
            try {
              ed.open(carried.sfdt);
            } catch {
              // A blank document is the fallback, as it was before the carry.
            }
          }
          if (reviewGate) disableUserTrackChanges(ed, instance);
          openedKeyRef.current = openKeyRef.current;
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
      const live = instance?.documentEditor;
      if (live && (unsavedRef.current || live.revisions?.length)) {
        try {
          carriedRef.current = {
            sfdt: live.serialize(),
            key: openedKeyRef.current
          };
        } catch {
          // An unreadable instance leaves the source open as the fallback.
          carriedRef.current = null;
        }
      }
      try {
        instance?.destroy?.();
      } catch {
        /* editor already torn down */
      }
      containerInstRef.current = null;
    };
    // `source` / `isReadOnly` intentionally omitted — open and readOnly are
    // handled by sibling effects so we never tear down mid-fetch.
    // `reviewGate` (not `reviewChanges`) so a gate flip waits out any
    // in-flight load before recreating - see its declaration above.
    // `bindingsEnabled` because the SFDT verbosity it needs is a construction
    // option; toggling it has to build a new instance to take effect.
  }, [resolvedLicenseKey, serviceUrl, headersKey, reviewGate, bindingsEnabled]);

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
  // What "the same document, opened the same time" means, for the carried stash.
  const openKey = `${openNonce ?? 0}|${sourceUrl ?? ''}|${
    sourceBuffer ? sourceBuffer.byteLength : ''
  }`;
  const openKeyRef = useRef(openKey);
  openKeyRef.current = openKey;

  useEffect(() => {
    if (!editor || (!sourceUrl && !sourceBuffer)) return;
    const carried = carriedRef.current;
    carriedRef.current = null;
    if (carried && carried.key === openKey) {
      // Same document, new instance: put back exactly what was on screen
      // instead of re-fetching bytes that predate it.
      try {
        editor.open(carried.sfdt);
        openedKeyRef.current = openKey;
        ignoreContentChangeRef.current = false;
        setLoading(false);
        onReady?.();
        return;
      } catch (err) {
        // Falling through to the source is a worse outcome than this open, but
        // it is a working one, and it is what happened before the carry.
        console.warn(
          'Feathery: could not restore the in-progress document after recreating the editor; reopening the source.',
          err
        );
      }
    }
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
        liveEditor[OPENING_DOCUMENT_KEY] = true;
        // open() resolves before the converted document is laid out, so anything
        // reading the document here sees the previous (often blank) one.
        // Registered before the open so a fast load cannot outrun the listener.
        const documentLoaded = waitForDocumentLoad(liveEditor);
        try {
          if (typeof liveEditor.openAsync === 'function') {
            await liveEditor.openAsync(blob);
          } else {
            liveEditor.open(blob);
          }
        } catch (err) {
          // A failed open must not leave the flag stuck true — that would
          // mute the review rail for the editor's whole life.
          liveEditor[OPENING_DOCUMENT_KEY] = false;
          throw err;
        }
        if (cancelled) {
          liveEditor[OPENING_DOCUMENT_KEY] = false;
          return;
        }
        await documentLoaded;
        if (cancelled) {
          liveEditor[OPENING_DOCUMENT_KEY] = false;
          return;
        }
        // A .docx round trip drops every content control's colour, and the
        // border renderer reads it unguarded - so without this, clicking any
        // content control throws mid-paint and half the page disappears. Runs
        // for every document, not just bound ones: a template authored in Word
        // hits it too. See contentControlSafety.
        stampMissingContentControlColors(liveEditor);
        // Opening SFDT can copy trackChanges=true onto the editor (and the
        // container, via documentChange). Put the review host back in user
        // mode before keystrokes can land.
        if (reviewGateRef.current)
          disableUserTrackChanges(liveEditor, containerInstRef.current);
        openedKeyRef.current = openKey;
        // A freshly opened document has nothing unsaved in it yet.
        unsavedRef.current = false;
        ignoreContentChangeRef.current = false;
        setLoading(false);
        onReady?.();
        // One extra frame of grace: Syncfusion's default-caret selectionChange
        // sometimes lands a beat after openAsync resolves, not inside it.
        featheryWindow().requestAnimationFrame(() => {
          liveEditor[OPENING_DOCUMENT_KEY] = false;
        });
      } catch (err) {
        if (!cancelled) fail(err);
      }
    })();

    return () => {
      cancelled = true;
      ignoreContentChangeRef.current = true;
    };
  }, [editor, sourceUrl, sourceBuffer, serviceUrl, openNonce]);

  // Bindings attach only once a document is actually open, and never to a
  // read-only one: reconciliation writes to the document, and a finalized or
  // signed envelope is not ours to rewrite.
  const bindingsState = useDocxBindings({
    ...bindings,
    enabled: bindingsEnabled,
    editor,
    loading,
    readOnly: isReadOnly,
    // Engine writes echo back as contentChange. The initial reconcile is the one
    // that must not count as the user dirtying anything - computing a template's
    // formulas is the editor doing its job, not an edit.
    onSuppressContentChange: (suppressed) => {
      ignoreContentChangeRef.current = suppressed;
    }
  });

  const exportDoc = useCallback((): Promise<Blob> => {
    if (!editor) return Promise.reject(new Error('Editor is not ready'));
    return editor.saveAsBlob('Docx');
  }, [editor]);

  const resizeEditor = useCallback(
    (refitZoom = false) => {
      const container = containerInstRef.current;
      // DocumentEditorContainer#resize enters refreshLayout, which homes the
      // cursor before rebuilding. The editor's own resize API performs the
      // required geometry refresh without that navigation side effect; keep
      // Ayesha's host-resize owner but use the narrower native operation.
      resizeDocxEditor(container, editor, refitZoom);
    },
    [editor]
  );
  const resize = useCallback(() => resizeEditor(), [resizeEditor]);

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
    let lastW = 0;
    let lastH = 0;
    const observer = new ResizeObserver(() => {
      if (frame) return;
      frame = featheryWindow().requestAnimationFrame(() => {
        frame = 0;
        // Resizing to 0 while hidden makes Syncfusion compute a degenerate
        // layout it does not recover from when the box returns.
        const { width, height } = el.getBoundingClientRect();
        if (width <= 0 || height <= 0) return;
        // Streaming chat/panel renders tick the observer without changing the
        // editor's box; Syncfusion's resize homes the cursor and scrolls to
        // the document top, so a same-size refresh is pure damage. Only pay
        // the relayout when the geometry truly changed.
        if (Math.abs(width - lastW) < 1 && Math.abs(height - lastH) < 1) return;
        lastW = width;
        lastH = height;
        resizeEditor(true);
      });
    });
    observer.observe(el);
    return () => {
      if (frame) featheryWindow().cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [editor, resizeEditor]);

  return {
    containerRef,
    editor,
    loading,
    error,
    exportDoc,
    resize,
    bindings: bindingsState
  };
}
