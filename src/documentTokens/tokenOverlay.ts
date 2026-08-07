/**
 * Editor-only token overlay.
 *
 * Paints a translucent background behind every token so an editor reads at a
 * glance which fields are typed in (light blue) and which are computed (light
 * gray) — WITHOUT touching the document. Unlike `highlight.ts`, which sets
 * Syncfusion's `highlightColor` character format (and so has to be stripped
 * before export), this draws plain `<div>`s and leaves the .docx untouched.
 *
 * The editor renders to <canvas>, so tokens are not DOM nodes we can style.
 * Instead we mount an absolutely-positioned layer INSIDE Syncfusion's page
 * container — the element that already holds the page canvases and whose
 * width/height reflect the current zoom. Because the overlay divs are CHILDREN
 * of that container, they scroll and zoom with the content automatically; there
 * is no scroll-offset math to keep in sync.
 *
 * Everything here is cosmetic: any control whose geometry cannot be resolved is
 * skipped, and a host that never exposes a page container yields no overlay.
 * Nothing in this module is ever allowed to throw into the editor.
 */

import { decodeTag, isDetached } from './controls';
import { TokenSpec } from './plan';

/**
 * Unzoomed width of the box drawn for an EMPTY token, so a field with no value
 * still shows a token exists. Scaled by zoom with every other dimension.
 */
const EMPTY_TOKEN_WIDTH = 10;

/**
 * Tunable overlay colours. Inputs (editable field / memory tokens) get a light
 * blue; derived (formula) tokens a light gray. Kept translucent so the token
 * text underneath stays fully legible. Tune the pair here.
 */
export const INPUT_OVERLAY = 'rgba(173,214,255,0.35)';
export const DERIVED_OVERLAY = 'rgba(210,210,214,0.40)';

/** Marks our layer so nothing else in the container is mistaken for it. */
const OVERLAY_CLASS = 'feathery-token-overlay';

/** A rectangle in the page container's own pixel coordinate space. */
type Rect = { left: number; top: number; width: number; height: number };

const isDerived = (spec: TokenSpec): boolean =>
  typeof spec.formula === 'string' && spec.formula.trim().length > 0;

/** Kind → colour. Exported so the mapping is testable without a real editor. */
export const overlayColor = (spec: TokenSpec): string =>
  isDerived(spec) ? DERIVED_OVERLAY : INPUT_OVERLAY;

/**
 * The token controls to paint, each with its colour. Foreign controls (not
 * ours) and undecodable tags are skipped. Reads the editor, never the cycle, so
 * the overlay reflects exactly what is in the document.
 */
export const tokenControls = (
  documentEditor: any
): Array<{ control: any; color: string }> => {
  const collection = documentEditor?.documentHelper?.contentControlCollection;
  if (!Array.isArray(collection)) return [];
  const out: Array<{ control: any; color: string }> = [];
  for (const control of collection) {
    const spec = decodeTag(control?.contentControlProperties?.tag ?? '');
    if (spec === null) continue;
    // A row deleted through the editor leaves its control in the collection
    // (measured) still carrying a stale line — painting it would float a box
    // over a token that no longer exists. Skip anything not in the live layout.
    if (isDetached(control)) continue;
    out.push({ control, color: overlayColor(spec) });
  }
  return out;
};

/**
 * The page container: Syncfusion's `<div class="e-de-background"
 * id="de_<id>_editor_pageContainer">`. It holds the page canvases, its size
 * already reflects zoom, and it scrolls as a unit — so a layer parented here
 * needs no scroll or zoom correction of its own.
 */
const resolvePageContainer = (documentEditor: any): HTMLElement | null => {
  const helper = documentEditor?.documentHelper;
  const direct = helper?.pageContainer;
  if (direct && direct.nodeType === 1) return direct as HTMLElement;

  const root: any = documentEditor?.element ?? helper?.viewerContainer;
  if (root?.querySelector) {
    return (
      root.querySelector('[id$="_editor_pageContainer"]') ??
      root.querySelector('.e-de-background') ??
      null
    );
  }
  return null;
};

// ── The document → page-container transform ─────────────────────────────────
// The ONE place that turns Syncfusion's internal layout geometry into pixels in
// the page container's coordinate space. Every field it reads is undocumented
// private surface (hence `any`), so this is where in-browser tuning lands.

/** The page widget a line belongs to, walked up the container chain. */
const pageOf = (line: any): any => {
  let node = line?.paragraph;
  let guard = 0;
  while (node && guard < 50) {
    if (node.page) return node.page;
    node = node.containerWidget ?? node.bodyWidget ?? node.owner;
    guard += 1;
  }
  return null;
};

/**
 * The top-left of a line's page, in page-container pixels. Reads the page's DOM
 * canvas position directly (already in zoomed pixels) so no page-stacking math
 * is needed; falls back to the page widget's layout rectangle scaled by zoom.
 */
export const pageOffset = (
  documentEditor: any,
  line: any,
  zoom: number
): { left: number; top: number } | null => {
  const page = pageOf(line);
  const rect = page?.boundingRectangle;
  if (!rect || typeof rect.x !== 'number' || typeof rect.y !== 'number') {
    return null;
  }
  // Match Syncfusion's OWN caret/selection transform verbatim (Selection.getRect
  // / updateCaretPosition), which is the pipeline it draws with:
  //   left = boundingRectangle.x + localX * zoom
  //   top  = (boundingRectangle.y - pageGap*(pageIndex+1)) * zoom + pageGap*(pageIndex+1)
  // The inter-page gap is added back UN-scaled. Our old `rect.y * zoom` scaled the
  // whole y and so drifted by pageGap*(pageIndex+1)*(zoom-1) — growing with zoom
  // and with page index (worst on page 2+). `boundingRectangle.x` is already a
  // rendered-pixel centering offset and is not scaled; the token's own within-page
  // offset (getLeftInternal/getTop, unzoomed) is scaled in controlRects. The
  // overlay layer rides the scrolled container, so no scroll term is needed.
  const pageGap = Number(documentEditor?.viewer?.pageGap) || 0;
  const pages = documentEditor?.documentHelper?.pages;
  const idx =
    typeof page.index === 'number'
      ? page.index
      : Array.isArray(pages)
      ? pages.indexOf(page)
      : 0;
  const top = (rect.y - pageGap * (idx + 1)) * zoom + pageGap * (idx + 1);
  return { left: rect.x, top };
};

/** The lines of a control's paragraph, so a multi-line token can be walked. */
const linesOf = (line: any): any[] => {
  const children = line?.paragraph?.childWidgets;
  return Array.isArray(children) ? children : line ? [line] : [];
};

/** Character length of an element box, for addressing its right edge. */
const lengthOf = (box: any): number => {
  if (typeof box?.getLength === 'function') return box.getLength();
  return typeof box?.length === 'number' ? box.length : 1;
};

/**
 * Whether a widget is the END marker of THIS content control. The paired end
 * carries a `.reference` back to the start; the type check is a fallback for a
 * build that does not wire the reference.
 */
const isControlEnd = (box: any, start: any): boolean =>
  box === start?.reference ||
  (box !== start &&
    box?.contentControlProperties !== undefined &&
    box?.type === 1);

/**
 * Document-space rects (unzoomed, page-relative) for one token — one per line
 * it spans. Walks the element boxes from the start content control forward to
 * its matching end, grouping by line.
 *
 * Inline element boxes do NOT store an absolute `.x` (Syncfusion only sets that
 * for floating shapes); horizontal position is computed on demand by
 * `selection.getLeftInternal`, and the line's document `.y` by `getTop` — the
 * exact primitives the canvas selection-highlight uses. Reusing them keeps this
 * transform truthful without re-deriving the layout math. Bounded so a
 * malformed document cannot spin.
 */
export const documentRects = (
  sel: any,
  control: any
): Array<{ line: any; rect: Rect }> => {
  if (
    typeof sel?.getLeftInternal !== 'function' ||
    typeof sel?.getTop !== 'function'
  ) {
    return [];
  }

  const startLine = control?.line;
  const lines = linesOf(startLine);
  const startLineIndex = Math.max(0, lines.indexOf(startLine));
  const startBoxIndex = Array.isArray(startLine?.children)
    ? startLine.children.indexOf(control)
    : -1;
  if (startBoxIndex < 0) return [];

  const groups: Array<{ line: any; rect: Rect }> = [];
  let scanned = 0;
  const MAX_BOXES = 2000;

  for (let li = startLineIndex; li < lines.length; li += 1) {
    const line = lines[li];
    const boxes: any[] = Array.isArray(line?.children) ? line.children : [];
    // Skip the start marker on the first line; every later line starts at 0.
    const from = li === startLineIndex ? startBoxIndex + 1 : 0;
    let first: any = null;
    let last: any = null;
    let done = false;

    for (let bi = from; bi < boxes.length; bi += 1) {
      scanned += 1;
      if (scanned > MAX_BOXES) return groups;
      const box = boxes[bi];
      if (isControlEnd(box, control)) {
        done = true;
        break;
      }
      if (first === null) first = box;
      last = box;
    }

    if (first !== null && last !== null) {
      const left = Number(sel.getLeftInternal(line, first, 0));
      const right = Number(sel.getLeftInternal(line, last, lengthOf(last)));
      const top = Number(sel.getTop(line));
      const height = Number(line?.height);
      if (Number.isFinite(left) && Number.isFinite(right) && right > left) {
        groups.push({
          line,
          rect: {
            left,
            top: Number.isFinite(top) ? top : 0,
            width: right - left,
            height: Number.isFinite(height) ? height : 0
          }
        });
      }
    }
    if (done) break;
  }

  // An EMPTY token has no element boxes between its start and end, so the walk
  // above finds no content and would leave it invisible — impossible to tell a
  // control is there. Give it a thin caret-width box at the position right after
  // its start marker, so an empty field still reads as a token.
  if (groups.length === 0 && startLine) {
    const left = Number(
      sel.getLeftInternal(startLine, control, lengthOf(control))
    );
    const top = Number(sel.getTop(startLine));
    const height = Number(startLine?.height);
    if (Number.isFinite(left) && Number.isFinite(top)) {
      groups.push({
        line: startLine,
        rect: {
          left,
          top,
          width: EMPTY_TOKEN_WIDTH,
          height: Number.isFinite(height) ? height : 0
        }
      });
    }
  }

  return groups;
};

/** Pixel rects for one token in the page container's coordinate space. */
export const controlRects = (
  documentEditor: any,
  control: any,
  zoom: number
): Rect[] => {
  try {
    const sel = documentEditor?.selection;
    const out: Rect[] = [];
    for (const { line, rect } of documentRects(sel, control)) {
      const offset = pageOffset(documentEditor, line, zoom);
      if (!offset || rect.width <= 0 || rect.height <= 0) continue;
      // The token's within-page geometry (getLeftInternal/getTop/line.height) is
      // UNZOOMED — measured: identical at 100% and 200% — so every dimension is
      // scaled by zoom here. The page offset is already in rendered pixels and
      // is added un-scaled.
      out.push({
        left: offset.left + rect.left * zoom,
        top: offset.top + rect.top * zoom,
        width: rect.width * zoom,
        height: rect.height * zoom
      });
    }
    return out;
  } catch {
    // Cosmetic: a control whose internal geometry cannot be read is skipped.
    return [];
  }
};

/**
 * Mount the overlay inside the editor's page container and keep it in sync.
 * Returns a detach that removes the layer and every listener. A host with no
 * resolvable page container gets a no-op detach — the overlay simply does not
 * appear, which is the correct outcome for a purely cosmetic layer.
 */
export const attachTokenOverlay = (documentEditor: any): (() => void) => {
  const pageContainer = resolvePageContainer(documentEditor);
  if (!pageContainer) return () => undefined;

  const doc = pageContainer.ownerDocument;
  const view = doc?.defaultView ?? null;

  const layer = doc.createElement('div');
  layer.className = OVERLAY_CLASS;
  layer.style.position = 'absolute';
  layer.style.top = '0';
  layer.style.left = '0';
  layer.style.pointerEvents = 'none';
  pageContainer.appendChild(layer);

  // The layer is top:0/left:0 absolute, so it only aligns with the container's
  // top-left if the container is itself a positioning context; force one if not.
  if (view?.getComputedStyle?.(pageContainer).position === 'static') {
    pageContainer.style.position = 'relative';
  }

  const sync = (): void => {
    try {
      layer.textContent = '';
      const zoom = Number(documentEditor?.zoomFactor) || 1;
      for (const { control, color } of tokenControls(documentEditor)) {
        for (const rect of controlRects(documentEditor, control, zoom)) {
          const cell = doc.createElement('div');
          cell.style.position = 'absolute';
          cell.style.pointerEvents = 'none';
          cell.style.background = color;
          cell.style.left = `${rect.left}px`;
          cell.style.top = `${rect.top}px`;
          cell.style.width = `${rect.width}px`;
          cell.style.height = `${rect.height}px`;
          layer.appendChild(cell);
        }
      }
    } catch {
      // Never let a cosmetic repaint take the editor down.
    }
  };

  let frame = 0;
  const scheduleSync = (): void => {
    if (frame) return;
    if (view?.requestAnimationFrame) {
      frame = view.requestAnimationFrame(() => {
        frame = 0;
        sync();
      });
    } else {
      sync();
    }
  };

  // Reposition only on events that move token geometry within the container.
  // NOT on scroll — the layer rides the scrolled container with the canvases.
  // `documentChange` fires when a document finishes opening, which is the load
  // this overlay must paint on.
  documentEditor?.addEventListener?.('zoomFactorChange', scheduleSync);
  documentEditor?.addEventListener?.('contentChange', scheduleSync);
  documentEditor?.addEventListener?.('documentChange', scheduleSync);
  view?.addEventListener?.('resize', scheduleSync);

  // The document opens asynchronously, so at attach — and even at the first
  // contentChange — the controls may not be laid out yet, leaving the overlay
  // blank until the next resize. A few deferred syncs paint them without one.
  sync();
  const retries = [150, 500, 1200].map((delay) =>
    setTimeout(scheduleSync, delay)
  );

  return () => {
    if (frame && view?.cancelAnimationFrame) view.cancelAnimationFrame(frame);
    frame = 0;
    retries.forEach(clearTimeout);
    documentEditor?.removeEventListener?.('zoomFactorChange', scheduleSync);
    documentEditor?.removeEventListener?.('contentChange', scheduleSync);
    documentEditor?.removeEventListener?.('documentChange', scheduleSync);
    view?.removeEventListener?.('resize', scheduleSync);
    layer.remove();
  };
};
