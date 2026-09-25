import { featheryDoc, featheryWindow } from '../../../../utils/browser';
import { deepClone } from '../core/opc/deepClone';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  reconcileSlideSvg,
  renderSlideSvg,
  rerenderShape
} from '../core/render/svg';
import {
  readPictureCrop,
  type PictureCrop,
  type RichPara,
  type RichRun
} from '../core/model/edit';
import {
  tableCell,
  tableCellGridSpan,
  tableCellIsMergeContinuation,
  tableCellRowSpan,
  tableCellText,
  tableCells,
  tableColumns,
  tableRows
} from '../core/model/table';
import { getAttr } from '../core/opc/xml';
import type { Deck, Shape } from '../core/model/types';
import {
  usePptxEditorState,
  usePptxEditorStore
} from '../state/PptxEditorContext';
import { snapMove, type Guide } from './snap';
import { readBodyProps } from '../core/model/textLayout';
import { selectedTextRanges } from './textSelection';
import { effectiveSlideSize } from '../core/model/slideSize';
import type { TableEditOperation } from '../engine';

interface OverlayBox {
  left: number;
  top: number;
  width: number;
  height: number;
  rot: number;
  scale: number;
  group: boolean;
}
interface Geom {
  x: number;
  y: number;
  cx: number;
  cy: number;
  rot: number;
}
interface GTarget {
  shapeId: string;
  gEl: SVGGElement | null;
  baseTransform: string;
  startGeom: Geom;
  pending?: Geom;
}
interface EditingCell {
  shapeId: string;
  row: number;
  col: number;
  selectAll?: boolean;
  point?: { x: number; y: number };
}
interface CellDrag {
  shapeId: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  startX: number;
  startY: number;
  moved: boolean;
  editOnClick: boolean;
}
interface TableEdge {
  axis: 'column' | 'row';
  index: number;
  outerStart: boolean;
}
interface HandleDir {
  top?: boolean;
  left?: boolean;
  right?: boolean;
  bottom?: boolean;
}
interface Gesture {
  mode: 'move' | 'resize' | 'rotate' | 'tableEdge' | 'crop';
  dir?: HandleDir;
  startMouse: { x: number; y: number };
  startBox: OverlayBox;
  targets: GTarget[];
  center?: { x: number; y: number }; // screen center (rotate)
  startAngle?: number; // deg (rotate)
  snapX: number[];
  snapY: number[]; // candidate alignment lines (host-content px)
  tableEdge?: TableEdge;
  tableSizeStart?: number;
  tableBoundaryStartPx?: number;
  pendingSize?: number;
  pendingPosition?: number;
  cropMove?: boolean;
  startCrop?: PictureCrop;
  pendingCrop?: PictureCrop;
}

// which edges a resize handle moves
const HANDLES: {
  key: string;
  x: number;
  y: number;
  cur: string;
  dir: HandleDir;
}[] = [
  { key: 'nw', x: 0, y: 0, cur: 'nwse-resize', dir: { top: true, left: true } },
  { key: 'n', x: 0.5, y: 0, cur: 'ns-resize', dir: { top: true } },
  {
    key: 'ne',
    x: 1,
    y: 0,
    cur: 'nesw-resize',
    dir: { top: true, right: true }
  },
  { key: 'e', x: 1, y: 0.5, cur: 'ew-resize', dir: { right: true } },
  {
    key: 'se',
    x: 1,
    y: 1,
    cur: 'nwse-resize',
    dir: { bottom: true, right: true }
  },
  { key: 's', x: 0.5, y: 1, cur: 'ns-resize', dir: { bottom: true } },
  {
    key: 'sw',
    x: 0,
    y: 1,
    cur: 'nesw-resize',
    dir: { bottom: true, left: true }
  },
  { key: 'w', x: 0, y: 0.5, cur: 'ew-resize', dir: { left: true } }
];

const MIN_EMU = 90000; // ~0.1 inch min size

function tableGridSizes(shape: Shape) {
  const columns = tableColumns(shape).map(
    (column) => Number(getAttr(column, 'w')) || 0
  );
  const rows = tableRows(shape).map((row) => Number(getAttr(row, 'h')) || 0);
  return {
    columns,
    rows,
    width:
      columns.reduce((sum, width) => sum + width, 0) || shape.xfrm?.cx || 0,
    height: rows.reduce((sum, height) => sum + height, 0) || shape.xfrm?.cy || 0
  };
}

function nextTableAnchor(
  shape: Shape,
  row: number,
  col: number
): { row: number; col: number } | null {
  const rows = tableRows(shape);
  let passedCurrent = false;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const cells = tableCells(rows[rowIndex]);
    for (let colIndex = 0; colIndex < cells.length; colIndex++) {
      if (!passedCurrent) {
        if (rowIndex === row && colIndex === col) passedCurrent = true;
        continue;
      }
      if (!tableCellIsMergeContinuation(cells[colIndex]))
        return { row: rowIndex, col: colIndex };
    }
  }
  return null;
}

function rgbToHex(rgb: string): string | undefined {
  const m = rgb.match(/\d+/g);
  if (!m || m.length < 3) return undefined;
  return m
    .slice(0, 3)
    .map((n) => Number(n).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

const bulletLevel = (p: HTMLElement) =>
  Number(p.dataset.levelOverride ?? p.dataset.level ?? 0);
const bulletMargin = (p: HTMLElement) =>
  Number(p.dataset.marLOverride ?? p.dataset.baseMarLEmu ?? 0);
const bulletIndent = (p: HTMLElement) =>
  Number(p.dataset.indentOverride ?? p.dataset.baseIndentEmu ?? 0);

function positionBullet(p: HTMLElement, margin: number, indent: number): void {
  p.dataset.marLOverride = String(margin);
  p.dataset.indentOverride = String(indent);
  p.style.paddingLeft = `${margin / 9525}px`;
  const marker = p.querySelector(
    ':scope > [data-bullet]'
  ) as HTMLElement | null;
  if (marker) {
    marker.style.left = `${(margin + indent) / 9525}px`;
    marker.style.transform = indent ? '' : 'translateX(-100%)';
  }
}

function normalizeBulletLevels(root: HTMLElement): void {
  const margins = new Map<number, { margin: number; indent: number }>();
  for (const p of root.children) {
    if (!(p instanceof HTMLElement) || !p.hasAttribute('data-bullet-item'))
      continue;
    const level = bulletLevel(p);
    const target = margins.get(level);
    if (!target)
      margins.set(level, { margin: bulletMargin(p), indent: bulletIndent(p) });
    else if (
      bulletMargin(p) !== target.margin ||
      bulletIndent(p) !== target.indent
    )
      positionBullet(p, target.margin, target.indent);
  }
}

function bulletParagraphText(paragraph: HTMLElement): string {
  const copy = paragraph.cloneNode(true) as HTMLElement;
  copy
    .querySelectorAll('[data-bullet]')
    .forEach((marker: Element) => marker.remove());
  return (copy.textContent || '').replace(/\u200B/g, '');
}

function placeCaretInParagraph(paragraph: HTMLElement, atEnd: boolean): void {
  const texts: Text[] = [];
  const walker = featheryDoc().createTreeWalker(
    paragraph,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node: Node) =>
        node.parentElement?.closest('[data-bullet]')
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT
    }
  );
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node as Text;
    if ((text.textContent || '').replace(/\u200B/g, '').length)
      texts.push(text);
  }
  let target = atEnd ? texts[texts.length - 1] : texts[0];
  let offset: number;
  if (!target) {
    const holder =
      paragraph.querySelector(':scope > :not([data-bullet]):not(br)') ||
      paragraph;
    // Browsers can discard a selection anchored in an empty text node. A zero
    // width caret anchor remains addressable and is removed during extraction.
    // Reuse an empty run so the next typed character keeps that run's styling.
    target =
      Array.from(holder.childNodes).find(
        (childNode): childNode is Text => childNode.nodeType === Node.TEXT_NODE
      ) || featheryDoc().createTextNode('');
    if (!target.parentNode) holder.appendChild(target);
    target.textContent = '\u200B';
    offset = 1;
  } else {
    offset = atEnd ? target.textContent?.length ?? 0 : 0;
  }
  const range = featheryDoc().createRange();
  range.setStart(target, offset);
  range.collapse(true);
  const selection = featheryWindow().getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function bulletParagraphForSelection(
  root: HTMLElement,
  selection: Selection | null
): HTMLElement | null {
  const anchor = selection?.anchorNode;
  if (!anchor) return null;
  const anchorEl = anchor instanceof Element ? anchor : anchor.parentElement;
  const contained = anchorEl?.closest(
    '[data-bullet-item]'
  ) as HTMLElement | null;
  if (contained?.parentElement === root) return contained;
  if (anchor !== root) return null;
  const offset = selection?.anchorOffset ?? 0;
  const adjacent =
    root.children[Math.max(0, offset - 1)] || root.children[offset];
  return adjacent instanceof HTMLElement &&
    adjacent.hasAttribute('data-bullet-item')
    ? adjacent
    : null;
}

function rangeInsideParagraph(
  root: HTMLElement,
  paragraph: HTMLElement,
  range: Range
): Range | null {
  if (
    paragraph.contains(range.startContainer) &&
    paragraph.contains(range.endContainer)
  )
    return range;
  if (!range.collapsed || range.startContainer !== root) return null;
  const normalized = featheryDoc().createRange();
  normalized.selectNodeContents(paragraph);
  normalized.collapse(false);
  return normalized;
}

// Read the contentEditable DOM back into model paragraphs/runs, preserving each
// span's formatting (rich-text commit). Each top-level <div> is a paragraph.
// The text is edited in place inside the SVG's `scale(EMU_PER_PX)` group, so a
// span's computed font-size is LOCAL px = pt*96/72; invert that to get pt back.
function styleSignature(cs: CSSStyleDeclaration): string {
  return [
    cs.fontWeight,
    cs.fontStyle,
    cs.fontSize,
    cs.color,
    cs.backgroundColor,
    cs.verticalAlign,
    cs.fontFamily,
    cs.textDecorationLine
  ].join('|');
}

function extractRichText(
  root: HTMLElement,
  fontScale = 1,
  baselineStyles = new Map<string, string>()
): RichPara[] {
  const alignOf = (ta: string): RichPara['align'] =>
    ta === 'center'
      ? 'ctr'
      : ta === 'right'
      ? 'r'
      : ta === 'justify'
      ? 'just'
      : 'l';
  // One run per text node, styled by that node's OWN effective computed style —
  // so nested execCommand wrappers (<b>, <i>, <span>) each become their own run.
  const runFromTextNode = (node: Text): RichRun | null => {
    const text = (node.textContent ?? '').replace(/\u200B/g, '');
    if (!text) return null;
    const parent = node.parentElement;
    if (!parent) return { text };
    const cs = getComputedStyle(parent);
    const source = parent.closest(
      '[data-source-paragraph][data-source-run]'
    ) as HTMLElement | null;
    const sourceKey = source
      ? `${source.dataset.sourceParagraph}:${source.dataset.sourceRun}`
      : '';
    const background = cs.backgroundColor;
    const vertical = cs.verticalAlign;
    return {
      text,
      source: source
        ? {
            paragraph: Number(source.dataset.sourceParagraph),
            run: Number(source.dataset.sourceRun)
          }
        : undefined,
      styleChanged: source
        ? styleSignature(cs) !== baselineStyles.get(sourceKey)
        : true,
      bold: parseInt(cs.fontWeight, 10) >= 600,
      italic: cs.fontStyle === 'italic',
      underline: (cs.textDecorationLine || cs.textDecoration || '').includes(
        'underline'
      ),
      strike: (cs.textDecorationLine || cs.textDecoration || '').includes(
        'line-through'
      ),
      sizePt: +((parseFloat(cs.fontSize) * 72) / 96 / fontScale).toFixed(2),
      color: rgbToHex(cs.color),
      highlight:
        background &&
        background !== 'transparent' &&
        !/rgba\([^)]*,\s*0\s*\)/.test(background)
          ? rgbToHex(background)
          : undefined,
      baselinePct: vertical.endsWith('%')
        ? Number.parseFloat(vertical)
        : vertical === 'super'
        ? 30
        : vertical === 'sub'
        ? -30
        : undefined,
      font: cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim() || undefined
    };
  };
  const collectRuns = (root: HTMLElement): RichRun[] => {
    const runs: RichRun[] = [];
    const walker = featheryDoc().createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (n: Node) => {
          if (n instanceof Element) {
            if (n.hasAttribute('data-bullet')) return NodeFilter.FILTER_REJECT;
            return n.tagName === 'BR' && n.hasAttribute('data-soft-break')
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_SKIP;
          }
          return n.parentElement?.closest('[data-bullet]')
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    let n: Node | null;
    while ((n = walker.nextNode())) {
      if (n instanceof HTMLBRElement) {
        const source =
          n.dataset.sourceParagraph === undefined ||
          n.dataset.sourceRun === undefined
            ? undefined
            : {
                paragraph: Number(n.dataset.sourceParagraph),
                run: Number(n.dataset.sourceRun)
              };
        runs.push({ text: '\n', break: true, source });
        continue;
      }
      const r = runFromTextNode(n as Text);
      if (r) runs.push(r);
    }
    return runs;
  };
  const paras: RichPara[] = [];
  const blocks = [...root.childNodes].filter(
    (n) => n.nodeType === Node.ELEMENT_NODE && n.nodeName === 'DIV'
  );
  const source = blocks.length ? blocks : [root]; // fallback: root holds inline content directly
  for (const block of source) {
    const el = block as HTMLElement;
    const align =
      block === root ? 'l' : alignOf(getComputedStyle(el).textAlign);
    paras.push({
      align,
      runs: collectRuns(el),
      sourceParagraph:
        el.dataset.sourceParagraph === undefined
          ? undefined
          : Number(el.dataset.sourceParagraph),
      level:
        el.dataset.levelOverride === undefined
          ? undefined
          : Number(el.dataset.levelOverride),
      marginLeftEMU:
        el.dataset.marLOverride === undefined
          ? undefined
          : Number(el.dataset.marLOverride),
      indentEMU:
        el.dataset.indentOverride === undefined
          ? undefined
          : Number(el.dataset.indentOverride),
      bulletRemoved: el.hasAttribute('data-bullet-removed') || undefined
    });
  }
  return paras.length ? paras : [{ runs: [] }];
}

export const ZOOM_MIN = 50;
export const ZOOM_MAX = 400;

export function SvgSlide({
  readOnly = false,
  zoom = 100,
  onZoomChange
}: {
  readOnly?: boolean;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
} = {}) {
  const store = usePptxEditorStore();
  const state = usePptxEditorState();
  const hostRef = useRef<HTMLDivElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);
  const mountedSlideRef = useRef<{
    deck: Deck;
    slide: Deck['slides'][number];
    svg: SVGSVGElement;
  } | null>(null);

  const deck = state.deck;
  const activeSlide = state.activeSlide;
  const structureRev = state.structureRev;
  const rev = state.rev;
  const renderRev = state.renderRev;
  const selectedId = state.selectedId;
  const selectedIds = state.selectedIds;
  const select = store.select;
  const toggleSelect = store.toggleSelect;
  const selectMany = store.selectMany;
  const tableSelection = state.tableSelection;
  const pictureCropModeId = state.pictureCropModeId;
  const setPictureCropMode = store.setPictureCropMode;

  const [box, setBox] = useState<OverlayBox | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);

  // Trackpad pinch arrives as a wheel event with ctrlKey set, so one listener
  // covers pinch, Ctrl+scroll and Cmd+scroll. Native (non-passive) because
  // React's synthetic wheel handlers cannot preventDefault the page zoom.
  const zoomFloatRef = useRef(zoom);
  const zoomAnchorRef = useRef<{
    ax: number;
    ay: number;
    contentX: number;
    contentY: number;
    fromZoom: number;
  } | null>(null);
  useEffect(() => {
    if (Math.round(zoomFloatRef.current) !== zoom) zoomFloatRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !onZoomChange) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      // Wheel notches send ~100/notch, pinch a few units per event; clamping
      // the delta keeps one notch a step and the pinch smooth.
      const delta = Math.max(-30, Math.min(30, e.deltaY));
      const next = Math.max(
        ZOOM_MIN,
        Math.min(ZOOM_MAX, zoomFloatRef.current * Math.exp(-delta * 0.01))
      );
      const rounded = Math.round(next);
      if (rounded !== Math.round(zoomFloatRef.current)) {
        const rect = host.getBoundingClientRect();
        const ax = e.clientX - rect.left;
        const ay = e.clientY - rect.top;
        zoomAnchorRef.current = {
          ax,
          ay,
          contentX: host.scrollLeft + ax,
          contentY: host.scrollTop + ay,
          fromZoom: zoomFloatRef.current
        };
        onZoomChange(rounded);
      }
      zoomFloatRef.current = next;
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
    // !!deck: before a deck loads the stage renders a placeholder without
    // hostRef, so bind again once the real stage mounts.
  }, [onZoomChange, !!deck]);
  // After the width re-renders, restore the content point under the pointer.
  useLayoutEffect(() => {
    const host = hostRef.current;
    const anchor = zoomAnchorRef.current;
    zoomAnchorRef.current = null;
    if (!host || !anchor || !anchor.fromZoom) return;
    const scale = zoom / anchor.fromZoom;
    host.scrollLeft = anchor.contentX * scale - anchor.ax;
    host.scrollTop = anchor.contentY * scale - anchor.ay;
  }, [zoom]);

  // The stage is sized by its container, not the window: observe the host and
  // reposition the selection overlay on any size change.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setLayoutTick((t) => t + 1));
    });
    observer.observe(host);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  // Right-click context menu on table cells: row/column insert & delete.
  const [tableMenu, setTableMenu] = useState<{
    x: number;
    y: number;
    shapeId: string;
    row: number;
    col: number;
  } | null>(null);
  const [tableEdgePreview, setTableEdgePreview] = useState<{
    axis: 'column' | 'row';
    position: number;
  } | null>(null);
  const [hoveredTableEdge, setHoveredTableEdge] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [cropPreview, setCropPreview] = useState<PictureCrop | null>(null);

  // active gesture lives in one ref so the window listeners (installed once) never
  // go stale, and re-renders during a drag don't churn them.
  const gesture = useRef<Gesture | null>(null);
  const marqueeRef = useRef<{ startX: number; startY: number } | null>(null);
  const cellDragRef = useRef<CellDrag | null>(null);
  const scaleRef = useRef(1);
  const originRef = useRef({ x: 0, y: 0 }); // svg top-left within host-content px
  const dblPointRef = useRef<{ x: number; y: number } | null>(null); // last double-click point (caret placement)

  const slide = deck?.slides[activeSlide];
  const slideSize =
    deck && slide ? effectiveSlideSize(deck, slide) : deck?.size;
  const shape = slide?.shapes.find((s) => s.id === selectedId);
  const selectedShapes = (slide?.shapes ?? []).filter(
    (s) => selectedIds.includes(s.id) && s.xfrm
  );
  const selectedTable =
    selectedShapes.length === 1 && selectedShapes[0].type === 'table'
      ? selectedShapes[0]
      : null;
  const tableGrid = selectedTable ? tableGridSizes(selectedTable) : null;
  const cropShape =
    selectedShapes.length === 1 &&
    selectedShapes[0].type === 'pic' &&
    pictureCropModeId === selectedShapes[0].id
      ? selectedShapes[0]
      : null;

  useEffect(() => {
    setCropPreview(cropShape ? readPictureCrop(cropShape) : null);
  }, [cropShape, pictureCropModeId, rev]);

  // Render the SVG before measuring shapes. Revisions on the same slide reconcile
  // into the mounted tree; only loading another deck/slide swaps the root.
  useLayoutEffect(() => {
    const host = svgHostRef.current;
    if (!host || !deck || !slide) return;
    const mounted = mountedSlideRef.current;
    let svg: SVGSVGElement;
    if (
      mounted &&
      mounted.deck === deck &&
      mounted.slide === slide &&
      mounted.svg.parentElement === host
    ) {
      svg = mounted.svg;
      reconcileSlideSvg(deck, slide, svg, {
        fullContent: true,
        background: true,
        structure: true,
        slideSize: true
      });
    } else {
      svg = renderSlideSvg(deck, slide);
      host.replaceChildren(svg);
      mountedSlideRef.current = { deck, slide, svg };
    }
    store.setSvgRoot(svg);
  }, [deck, slide, structureRev, renderRev]);

  useLayoutEffect(
    () => () => {
      const svg = mountedSlideRef.current?.svg;
      if (svg && store.svgRoot === svg) store.setSvgRoot(null);
      mountedSlideRef.current = null;
    },
    []
  );

  // position the selection overlay: single shape → its box (with handles + rotation);
  // multiple → the union bounding box (move-only).
  useLayoutEffect(() => {
    const svgEl = svgHostRef.current?.querySelector('svg');
    const hostEl = hostRef.current;
    if (!deck || !svgEl || !hostEl || selectedShapes.length === 0) {
      setBox(null);
      return;
    }
    const svgRect = svgEl.getBoundingClientRect();
    const hostRect = hostEl.getBoundingClientRect();
    const scale = svgRect.width / slideSize!.cx;
    scaleRef.current = scale;
    const originX = svgRect.left - hostRect.left + hostEl.scrollLeft;
    const originY = svgRect.top - hostRect.top + hostEl.scrollTop;
    originRef.current = { x: originX, y: originY };
    if (selectedShapes.length === 1) {
      const s = selectedShapes[0].xfrm!;
      const grid =
        selectedShapes[0].type === 'table'
          ? tableGridSizes(selectedShapes[0])
          : null;
      setBox({
        left: originX + s.x * scale,
        top: originY + s.y * scale,
        width: (grid?.width || s.cx) * scale,
        height: (grid?.height || s.cy) * scale,
        rot: s.rot,
        scale,
        group: false
      });
    } else {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const sh of selectedShapes) {
        const x = sh.xfrm!;
        minX = Math.min(minX, x.x);
        minY = Math.min(minY, x.y);
        maxX = Math.max(maxX, x.x + x.cx);
        maxY = Math.max(maxY, x.y + x.cy);
      }
      setBox({
        left: originX + minX * scale,
        top: originY + minY * scale,
        width: (maxX - minX) * scale,
        height: (maxY - minY) * scale,
        rot: 0,
        scale,
        group: true
      });
    }
  }, [
    deck,
    slide,
    slideSize?.cx,
    slideSize?.cy,
    selectedIds,
    rev,
    structureRev,
    activeSlide,
    layoutTick,
    zoom
  ]);

  // ---- inline text editing, IN PLACE ----
  // Make the shape's OWN <foreignObject> text div contentEditable. Editing the very
  // element that's rendered means zero position/size/font offset, no double-text,
  // and no overlay to mount (so no flash on click). We enlarge the foreignObject
  // while editing so growing text isn't clipped, and commit on blur / Escape.
  const editShape = slide?.shapes.find((s) => s.id === editingId);
  const editDivRef = useRef<HTMLElement | null>(null);
  const editStartHtmlRef = useRef('');
  const editStylesRef = useRef(new Map<string, string>());
  const editCommittedRef = useRef(false);

  // latest commit closure, read by the (once-attached) blur listener — no stale deck/slide
  const commitRef = useRef<(options?: { render?: boolean }) => void>(() => {});
  commitRef.current = (options) => {
    if (editCommittedRef.current) return;
    editCommittedRef.current = true;
    const div = editDivRef.current;
    if (!deck || !slide || !editShape || !div) {
      setEditingId(null);
      return;
    }
    if (div.innerHTML === editStartHtmlRef.current) {
      setEditingId(null);
      return;
    }
    const body = readBodyProps(editShape.text?.node);
    const fontScale =
      body.autofit?.type === 'normal'
        ? Math.max(0.01, (body.autofit.fontScalePct ?? 100) / 100)
        : 1;
    const paras = extractRichText(div, fontScale, editStylesRef.current);
    setEditingId(null); // effect cleanup restores the fO; then re-render just this shape
    store.executeCommand(
      {
        type: 'replace-rich-text',
        slideId: slide.path,
        shapeId: editShape.id,
        paragraphs: paras
      },
      'Edit text',
      { render: options?.render !== false }
    );
  };

  useLayoutEffect(() => {
    if (!editingId || !deck) return;
    const shapeG = svgHostRef.current?.querySelector(
      `[data-shape-id="${editingId}"]`
    );
    const div = shapeG?.querySelector('[data-textbody]') as HTMLElement | null;
    const fo = shapeG?.querySelector(
      'foreignObject'
    ) as SVGForeignObjectElement | null;
    if (!div) return;
    editCommittedRef.current = false;
    editDivRef.current = div;
    normalizeBulletLevels(div);
    // Normalizing same-level bullet positions is editor setup, not a user edit.
    // Capture the baseline afterward so toolbar focus/blur cannot create a
    // hidden history entry before the actual formatting action.
    editStartHtmlRef.current = div.innerHTML;
    editStylesRef.current = new Map(
      [...div.querySelectorAll('[data-source-paragraph][data-source-run]')].map(
        (span) => {
          const el = span as HTMLElement;
          return [
            `${el.dataset.sourceParagraph}:${el.dataset.sourceRun}`,
            styleSignature(getComputedStyle(el))
          ];
        }
      )
    );
    // grow the box so overflowing text stays visible (not clipped by the fO viewport)
    const prevFoH = fo?.getAttribute('height');
    const prevFoOverflow = fo?.style.overflow ?? '';
    const prevDivOverflow = div.style.overflow;
    if (fo) {
      fo.style.overflow = 'visible';
      fo.setAttribute('height', String((slideSize?.cy || deck.size.cy) / 9525));
    }
    div.style.overflow = 'visible';
    div.setAttribute('contenteditable', 'true');
    div.focus({ preventScroll: true });
    // caret at the double-click point, else at the end
    const sel = featheryWindow().getSelection();
    sel?.removeAllRanges();
    const pt = dblPointRef.current;
    let range: Range | null = null;
    const doc = featheryDoc() as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (
        x: number,
        y: number
      ) => { offsetNode: Node; offset: number } | null;
    };
    if (pt && doc.caretRangeFromPoint) {
      range = doc.caretRangeFromPoint(pt.x, pt.y);
    } else if (pt && doc.caretPositionFromPoint) {
      // Firefox has no caretRangeFromPoint; build the range from the
      // standards-track caretPositionFromPoint instead.
      const position = doc.caretPositionFromPoint(pt.x, pt.y);
      if (position) {
        range = doc.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.collapse(true);
      }
    }
    if (!range) {
      const fallback: Range = featheryDoc().createRange();
      fallback.selectNodeContents(div);
      fallback.collapse(false);
      range = fallback;
    }
    sel?.addRange(range);

    const captureSelection = () => {
      const ranges = selectedTextRanges(div, featheryWindow().getSelection());
      if (ranges.length) store.setTextSelection({ shapeId: editingId, ranges });
      else if (
        featheryDoc().activeElement === div &&
        !store.getState().textToolbarPointer
      )
        store.setTextSelection(null);
    };
    const onBlur = (event: FocusEvent) => {
      const state = store.getState();
      const keepRange = state.textToolbarPointer;
      store.setTextToolbarPointer(false);
      const historyAction =
        event.relatedTarget instanceof Element &&
        !!event.relatedTarget.closest('[data-history-action]');
      commitRef.current({ render: !historyAction });
      if (!keepRange) store.setTextSelection(null);
    };
    const commitFromToolbar = (options?: { render?: boolean }) =>
      commitRef.current(options);
    store.setCommitSvgTextEdit(commitFromToolbar);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        div.blur();
        return;
      }
      const selection = featheryWindow().getSelection();
      const paragraph = bulletParagraphForSelection(div, selection);
      if (!paragraph) return;
      if (selection?.isCollapsed && e.key === 'ArrowDown') {
        const next = paragraph.nextElementSibling as HTMLElement | null;
        if (
          next?.hasAttribute('data-bullet-item') &&
          !bulletParagraphText(next)
        ) {
          e.preventDefault();
          placeCaretInParagraph(next, false);
          return;
        }
      }
      if (
        selection?.isCollapsed &&
        e.key === 'ArrowUp' &&
        !bulletParagraphText(paragraph)
      ) {
        const previous = paragraph.previousElementSibling as HTMLElement | null;
        if (previous?.hasAttribute('data-bullet-item')) {
          e.preventDefault();
          placeCaretInParagraph(previous, true);
          return;
        }
      }
      if (
        e.key === 'Backspace' &&
        selection?.isCollapsed &&
        selection.rangeCount
      ) {
        const range = rangeInsideParagraph(
          div,
          paragraph,
          selection.getRangeAt(0)
        );
        if (!range) return;
        const before = featheryDoc().createRange();
        before.selectNodeContents(paragraph);
        before.setEnd(range.startContainer, range.startOffset);
        const probe = featheryDoc().createElement('div');
        probe.appendChild(before.cloneContents());
        probe
          .querySelectorAll('[data-bullet]')
          .forEach((marker: Element) => marker.remove());
        if (
          (probe.textContent || '').replace(/\u200B/g, '') ||
          probe.querySelector('[data-soft-break]')
        )
          return;
        e.preventDefault();
        paragraph.querySelector(':scope > [data-bullet]')?.remove();
        delete paragraph.dataset.bulletItem;
        paragraph.dataset.bulletRemoved = '';
        paragraph.style.paddingLeft = '0px';
        paragraph.style.textIndent = '0px';
        paragraph.style.position = 'static';
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const level = bulletLevel(paragraph);
        const next = Math.max(0, Math.min(8, level + (e.shiftKey ? -1 : 1)));
        if (next === level) return;
        const bullets = [...div.children].filter(
          (p): p is HTMLElement =>
            p instanceof HTMLElement && p.hasAttribute('data-bullet-item')
        );
        const target = bullets.find(
          (p) => p !== paragraph && bulletLevel(p) === next
        );
        const root = bullets.find((p) => bulletLevel(p) === 0);
        const marL = target
          ? bulletMargin(target)
          : root
          ? bulletMargin(root) + next * 457200
          : bulletMargin(paragraph) + (next - level) * 457200;
        const indent = target ? bulletIndent(target) : bulletIndent(paragraph);
        paragraph.dataset.levelOverride = String(next);
        positionBullet(paragraph, marL, indent);
        return;
      }
      if (e.key === 'Enter' && selection?.rangeCount) {
        const range = rangeInsideParagraph(
          div,
          paragraph,
          selection.getRangeAt(0)
        );
        if (!range) return;
        e.preventDefault();
        range.deleteContents();
        if (e.shiftKey) {
          const br = featheryDoc().createElement('br');
          br.dataset.softBreak = '';
          range.insertNode(br);
          const caret = featheryDoc().createRange();
          caret.setStartAfter(br);
          caret.collapse(true);
          selection.removeAllRanges();
          selection.addRange(caret);
          return;
        }
        const tail = range.cloneRange();
        tail.setEnd(paragraph, paragraph.childNodes.length);
        const moved = tail.extractContents();
        const next = paragraph.cloneNode(false) as HTMLElement;
        const marker = paragraph.querySelector(':scope > [data-bullet]');
        if (marker) next.appendChild(marker.cloneNode(true));
        next.appendChild(moved);
        if (!next.querySelector(':scope > :not([data-bullet])'))
          next.appendChild(featheryDoc().createElement('br'));
        paragraph.after(next);
        placeCaretInParagraph(next, false);
      }
    };
    div.addEventListener('blur', onBlur);
    div.addEventListener('keydown', onKey);
    div.addEventListener('mouseup', captureSelection);
    div.addEventListener('keyup', captureSelection);
    featheryDoc().addEventListener('selectionchange', captureSelection);
    return () => {
      if (store.commitSvgTextEdit === commitFromToolbar)
        store.setCommitSvgTextEdit(null);
      div.removeEventListener('blur', onBlur);
      div.removeEventListener('keydown', onKey);
      div.removeEventListener('mouseup', captureSelection);
      div.removeEventListener('keyup', captureSelection);
      featheryDoc().removeEventListener('selectionchange', captureSelection);
      div.removeAttribute('contenteditable');
      div.style.overflow = prevDivOverflow;
      if (fo) {
        fo.style.overflow = prevFoOverflow;
        if (prevFoH != null) fo.setAttribute('height', prevFoH);
      }
      editDivRef.current = null;
    };
  }, [editingId]);

  // Table cells are individually editable. Unlike a regular shape text body,
  // each cell has its own DrawingML txBody, so commit only that cell.
  useLayoutEffect(() => {
    if (!editingCell || !deck || !slide) return;
    const cell = editingCell;
    const shapeG = svgHostRef.current?.querySelector(
      `[data-shape-id="${cell.shapeId}"]`
    );
    const div = shapeG?.querySelector(
      `[data-table-cell][data-row="${cell.row}"][data-col="${cell.col}"]`
    ) as HTMLElement | null;
    if (!div) {
      setEditingCell(null);
      return;
    }
    div.setAttribute('contenteditable', 'true');
    div.style.overflow = 'auto';
    div.focus({ preventScroll: true });
    const selection = featheryWindow().getSelection();
    const range = featheryDoc().createRange();
    if (cell.selectAll) {
      range.selectNodeContents(div);
    } else {
      const doc = featheryDoc() as Document & {
        caretPositionFromPoint?: (
          x: number,
          y: number
        ) => { offsetNode: Node; offset: number } | null;
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
      };
      const caret =
        cell.point && doc.caretPositionFromPoint?.(cell.point.x, cell.point.y);
      const legacy =
        !caret && cell.point
          ? doc.caretRangeFromPoint?.(cell.point.x, cell.point.y)
          : null;
      if (caret) range.setStart(caret.offsetNode, caret.offset);
      else if (legacy)
        range.setStart(legacy.startContainer, legacy.startOffset);
      else {
        range.selectNodeContents(div);
        range.collapse(false);
      }
    }
    selection?.removeAllRanges();
    selection?.addRange(range);
    let committed = false;
    const target = slide.shapes.find((s) => s.id === cell.shapeId);
    const textOperation = (): TableEditOperation | undefined => {
      if (!target) return undefined;
      const value = (div.innerText ?? div.textContent ?? '').replace(/\n$/, '');
      if (tableCellText(tableCell(target, cell.row, cell.col)) === value)
        return undefined;
      return { kind: 'set-cell-text', row: cell.row, col: cell.col, value };
    };
    const commit = () => {
      if (committed) return;
      committed = true;
      const operation = textOperation();
      if (operation && target)
        store.executeCommand(
          {
            type: 'edit-table',
            slideId: slide.path,
            shapeId: target.id,
            operations: [operation]
          },
          'Edit table cell'
        );
      setEditingCell(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        div.blur();
        return;
      }
      if (e.key !== 'Tab' || !target) return;
      e.preventDefault();
      e.stopPropagation();
      committed = true;
      const operations: TableEditOperation[] = [];
      const text = textOperation();
      if (text) operations.push(text);
      let next = nextTableAnchor(target, cell.row, cell.col);
      if (!next) {
        next = { row: tableRows(target).length, col: 0 };
        operations.push({ kind: 'add-row' });
      }
      const { row, col } = next;
      if (operations.length)
        store.executeCommand(
          {
            type: 'edit-table',
            slideId: slide.path,
            shapeId: target.id,
            operations
          },
          operations.some((operation) => operation.kind === 'add-row')
            ? 'Add table row'
            : 'Edit table cell'
        );
      // Tab and Shift+Tab advance to the next cell, as requested.
      store.setTableSelection({
        shapeId: target.id,
        startRow: row,
        startCol: col,
        endRow: row,
        endCol: col
      });
      setEditingCell({ shapeId: target.id, row, col, selectAll: true });
    };
    div.addEventListener('blur', commit);
    div.addEventListener('keydown', onKey);
    return () => {
      div.removeEventListener('blur', commit);
      div.removeEventListener('keydown', onKey);
      div.removeAttribute('contenteditable');
      div.style.overflow = 'hidden';
    };
  }, [editingCell, deck, slide]);

  const startGesture =
    (mode: 'move' | 'resize' | 'rotate', dir?: HandleDir) =>
    (e: React.MouseEvent) => {
      if (!box || selectedShapes.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      const scale = scaleRef.current;
      const origin = originRef.current;
      // targets: all selected for move; primary only for resize/rotate
      const shapes =
        mode === 'move' ? selectedShapes : selectedShapes.slice(0, 1);
      const targets: GTarget[] = shapes.map((s) => {
        const gEl = svgHostRef.current?.querySelector(
          `[data-shape-id="${s.id}"]`
        ) as SVGGElement | null;
        return {
          shapeId: s.id,
          gEl,
          baseTransform: gEl?.getAttribute('transform') || '',
          startGeom: { ...s.xfrm! }
        };
      });
      // alignment candidates from UNSELECTED shapes + the slide edges/center
      const snapX: number[] = [];
      const snapY: number[] = [];
      if (mode === 'move' && deck && slide) {
        for (const s of slide.shapes) {
          if (selectedIds.includes(s.id) || !s.xfrm) continue;
          const x = s.xfrm;
          snapX.push(
            origin.x + x.x * scale,
            origin.x + (x.x + x.cx / 2) * scale,
            origin.x + (x.x + x.cx) * scale
          );
          snapY.push(
            origin.y + x.y * scale,
            origin.y + (x.y + x.cy / 2) * scale,
            origin.y + (x.y + x.cy) * scale
          );
        }
        const size = effectiveSlideSize(deck, slide);
        snapX.push(
          origin.x,
          origin.x + (size.cx / 2) * scale,
          origin.x + size.cx * scale
        );
        snapY.push(
          origin.y,
          origin.y + (size.cy / 2) * scale,
          origin.y + size.cy * scale
        );
      }
      // box.left/top are host-relative (including host scroll); the gesture
      // compares against viewport clientX/Y, so shift the center into
      // viewport space or rotation pivots around the wrong point (and can
      // read as spinning the opposite way when the editor sits mid-page).
      const hostEl = hostRef.current;
      const hostRect = hostEl?.getBoundingClientRect();
      const centerX =
        (hostRect?.left ?? 0) -
        (hostEl?.scrollLeft ?? 0) +
        box.left +
        box.width / 2;
      const centerY =
        (hostRect?.top ?? 0) -
        (hostEl?.scrollTop ?? 0) +
        box.top +
        box.height / 2;
      gesture.current = {
        mode,
        dir,
        startMouse: { x: e.clientX, y: e.clientY },
        startBox: box,
        targets,
        snapX,
        snapY,
        center: { x: centerX, y: centerY },
        startAngle:
          (Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180) / Math.PI
      };
    };

  const startTableEdge =
    (edge: TableEdge, boundaryPx: number) => (e: React.MouseEvent) => {
      if (!box || !selectedTable || !tableGrid) return;
      e.preventDefault();
      e.stopPropagation();
      const sizes = edge.axis === 'column' ? tableGrid.columns : tableGrid.rows;
      const index = edge.outerStart ? 0 : edge.index;
      const size = sizes[index];
      if (!Number.isFinite(size) || size < MIN_EMU) return;
      gesture.current = {
        mode: 'tableEdge',
        tableEdge: edge,
        tableSizeStart: size,
        tableBoundaryStartPx: boundaryPx,
        startMouse: { x: e.clientX, y: e.clientY },
        startBox: box,
        targets: [
          {
            shapeId: selectedTable.id,
            gEl: null,
            baseTransform: '',
            startGeom: { ...selectedTable.xfrm! }
          }
        ],
        snapX: [],
        snapY: []
      };
    };

  const startCropGesture =
    (dir?: HandleDir, cropMove = false) =>
    (e: React.MouseEvent) => {
      if (!box || !cropShape || !cropPreview) return;
      e.preventDefault();
      e.stopPropagation();
      const gEl = svgHostRef.current?.querySelector(
        `[data-shape-id="${cropShape.id}"]`
      ) as SVGGElement | null;
      gesture.current = {
        mode: 'crop',
        dir,
        cropMove,
        startCrop: deepClone(cropPreview),
        startMouse: { x: e.clientX, y: e.clientY },
        startBox: box,
        targets: [
          {
            shapeId: cropShape.id,
            gEl,
            baseTransform: gEl?.getAttribute('transform') || '',
            startGeom: { ...cropShape.xfrm! }
          }
        ],
        snapX: [],
        snapY: []
      };
    };

  const fitTableEdge = (edge: TableEdge) => (e: React.MouseEvent) => {
    if (!deck || !slide || !selectedTable) return;
    e.preventDefault();
    e.stopPropagation();
    const index = edge.outerStart ? 0 : edge.index;
    store.executeCommand(
      {
        type: 'edit-table',
        slideId: slide.path,
        shapeId: selectedTable.id,
        operations: [
          { kind: edge.axis === 'column' ? 'fit-column' : 'fit-row', index }
        ]
      },
      edge.axis === 'column' ? 'Fit table column' : 'Fit table row'
    );
  };

  // window listeners installed ONCE — read gesture state from the ref so they never
  // go stale. Previews mutate the SVG <g> / overlay directly (no full re-render);
  // everything commits to the model on release.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const cellDrag = cellDragRef.current;
      if (cellDrag) {
        if (
          Math.hypot(e.clientX - cellDrag.startX, e.clientY - cellDrag.startY) >
          3
        )
          cellDrag.moved = true;
        const hit =
          ((e.target as Element | null)?.closest?.(
            `[data-shape-id="${cellDrag.shapeId}"] [data-table-cell]`
          ) as HTMLElement | null) ||
          (featheryDoc()
            .elementFromPoint?.(e.clientX, e.clientY)
            ?.closest?.(
              `[data-shape-id="${cellDrag.shapeId}"] [data-table-cell]`
            ) as HTMLElement | null);
        if (hit) {
          const row = Number(hit.dataset.row);
          const col = Number(hit.dataset.col);
          if (
            Number.isInteger(row) &&
            Number.isInteger(col) &&
            (row !== cellDrag.endRow || col !== cellDrag.endCol)
          ) {
            cellDrag.endRow = row;
            cellDrag.endCol = col;
            cellDrag.moved = true;
            store.setTableSelection({
              shapeId: cellDrag.shapeId,
              startRow: cellDrag.startRow,
              startCol: cellDrag.startCol,
              endRow: row,
              endCol: col
            });
          }
        }
        return;
      }
      // marquee selection
      if (marqueeRef.current) {
        const m = marqueeRef.current;
        setMarquee({
          x: Math.min(m.startX, e.clientX),
          y: Math.min(m.startY, e.clientY),
          w: Math.abs(e.clientX - m.startX),
          h: Math.abs(e.clientY - m.startY)
        });
        return;
      }
      const g = gesture.current;
      if (!g) return;
      const scale = scaleRef.current;
      const dxRaw = e.clientX - g.startMouse.x;
      const dyRaw = e.clientY - g.startMouse.y;
      if (g.mode === 'crop') {
        const start = g.startCrop!;
        const radians = (g.startBox.rot * Math.PI) / 180;
        const localDx = dxRaw * Math.cos(radians) + dyRaw * Math.sin(radians);
        const localDy = -dxRaw * Math.sin(radians) + dyRaw * Math.cos(radians);
        const dxPct = (localDx / Math.max(1, g.startBox.width)) * 100;
        const dyPct = (localDy / Math.max(1, g.startBox.height)) * 100;
        const next = deepClone(start);
        const clamp = (value: number, max: number) =>
          Math.max(0, Math.min(max, value));
        if (g.cropMove) {
          let horizontalCrop = start.cropPct.left + start.cropPct.right;
          let verticalCrop = start.cropPct.top + start.cropPct.bottom;
          let baseLeft = start.cropPct.left;
          let baseTop = start.cropPct.top;
          let createdHorizontalCrop = false;
          let createdVerticalCrop = false;
          // An uncropped image has no spare source area, so panning would be
          // mathematically clamped to zero. Create a modest centered crop on
          // the first drag and shrink the frame by the same amount. Keeping
          // frameSize / visibleSource constant crops the image without zooming.
          if (horizontalCrop < 0.01 && Math.abs(dxPct) > 0.1) {
            horizontalCrop = 12;
            baseLeft = 6;
            createdHorizontalCrop = true;
          }
          if (verticalCrop < 0.01 && Math.abs(dyPct) > 0.1) {
            verticalCrop = 12;
            baseTop = 6;
            createdVerticalCrop = true;
          }
          const visibleW = (100 - horizontalCrop) / 100;
          const visibleH = (100 - verticalCrop) / 100;
          if (createdHorizontalCrop || createdVerticalCrop) {
            const target = g.targets[0];
            const s = target.startGeom;
            const x = createdHorizontalCrop
              ? s.x + s.cx * (baseLeft / 100)
              : s.x;
            const y = createdVerticalCrop ? s.y + s.cy * (baseTop / 100) : s.y;
            const cx = createdHorizontalCrop ? s.cx * visibleW : s.cx;
            const cy = createdVerticalCrop ? s.cy * visibleH : s.cy;
            target.pending = { x, y, cx, cy, rot: s.rot };
            setBox({
              ...g.startBox,
              left: g.startBox.left + (x - s.x) * scale,
              top: g.startBox.top + (y - s.y) * scale,
              width: Math.max(8, cx * scale),
              height: Math.max(8, cy * scale)
            });
          } else if (
            start.cropPct.left + start.cropPct.right < 0.01 ||
            start.cropPct.top + start.cropPct.bottom < 0.01
          ) {
            // Returning to the gesture origin must also discard an automatically
            // created frame crop from an earlier mousemove in this gesture.
            g.targets[0].pending = undefined;
            setBox(g.startBox);
          }
          // Drag the source image beneath a fixed crop frame, like PowerPoint.
          next.cropPct.left = clamp(
            baseLeft - dxPct * visibleW,
            horizontalCrop
          );
          next.cropPct.right = horizontalCrop - next.cropPct.left;
          next.cropPct.top = clamp(baseTop - dyPct * visibleH, verticalCrop);
          next.cropPct.bottom = verticalCrop - next.cropPct.top;
        } else {
          const d = g.dir!;
          const target = g.targets[0];
          const s = target.startGeom;
          const visibleW = Math.max(
            0.001,
            (100 - start.cropPct.left - start.cropPct.right) / 100
          );
          const visibleH = Math.max(
            0.001,
            (100 - start.cropPct.top - start.cropPct.bottom) / 100
          );
          let { x, y, cx, cy } = s;
          if (d.left) {
            const maxLeft = Math.min(
              99 - start.cropPct.right,
              start.cropPct.left +
                Math.max(0, 1 - MIN_EMU / s.cx) * visibleW * 100
            );
            next.cropPct.left = clamp(
              start.cropPct.left + (localDx / scale / s.cx) * visibleW * 100,
              maxLeft
            );
            const effective =
              ((next.cropPct.left - start.cropPct.left) / 100 / visibleW) *
              s.cx;
            x = s.x + effective;
            cx = s.cx - effective;
          }
          if (d.right) {
            const maxRight = Math.min(
              99 - start.cropPct.left,
              start.cropPct.right +
                Math.max(0, 1 - MIN_EMU / s.cx) * visibleW * 100
            );
            next.cropPct.right = clamp(
              start.cropPct.right - (localDx / scale / s.cx) * visibleW * 100,
              maxRight
            );
            const effective =
              (-(next.cropPct.right - start.cropPct.right) / 100 / visibleW) *
              s.cx;
            cx = s.cx + effective;
          }
          if (d.top) {
            const maxTop = Math.min(
              99 - start.cropPct.bottom,
              start.cropPct.top +
                Math.max(0, 1 - MIN_EMU / s.cy) * visibleH * 100
            );
            next.cropPct.top = clamp(
              start.cropPct.top + (localDy / scale / s.cy) * visibleH * 100,
              maxTop
            );
            const effective =
              ((next.cropPct.top - start.cropPct.top) / 100 / visibleH) * s.cy;
            y = s.y + effective;
            cy = s.cy - effective;
          }
          if (d.bottom) {
            const maxBottom = Math.min(
              99 - start.cropPct.top,
              start.cropPct.bottom +
                Math.max(0, 1 - MIN_EMU / s.cy) * visibleH * 100
            );
            next.cropPct.bottom = clamp(
              start.cropPct.bottom - (localDy / scale / s.cy) * visibleH * 100,
              maxBottom
            );
            const effective =
              (-(next.cropPct.bottom - start.cropPct.bottom) / 100 / visibleH) *
              s.cy;
            cy = s.cy + effective;
          }
          target.pending = {
            x,
            y,
            cx: Math.max(MIN_EMU, cx),
            cy: Math.max(MIN_EMU, cy),
            rot: s.rot
          };
          setBox({
            ...g.startBox,
            left: g.startBox.left + (x - s.x) * scale,
            top: g.startBox.top + (y - s.y) * scale,
            width: Math.max(8, cx * scale),
            height: Math.max(8, cy * scale)
          });
        }
        g.pendingCrop = next;
        setCropPreview(next);
        const image = g.targets[0].gEl?.querySelector('image');
        if (image) {
          const { cx, cy } = g.targets[0].startGeom;
          const left = next.cropPct.left / 100;
          const top = next.cropPct.top / 100;
          const right = next.cropPct.right / 100;
          const bottom = next.cropPct.bottom / 100;
          const visibleW = Math.max(0.001, 1 - left - right);
          const visibleH = Math.max(0.001, 1 - top - bottom);
          image.setAttribute('x', String((-cx * left) / visibleW));
          image.setAttribute('y', String((-cy * top) / visibleH));
          image.setAttribute('width', String(cx / visibleW));
          image.setAttribute('height', String(cy / visibleH));
        }
      } else if (g.mode === 'move') {
        const {
          dx,
          dy,
          guides: gs
        } = snapMove(g.startBox, dxRaw, dyRaw, g.snapX, g.snapY);
        for (const t of g.targets) {
          t.gEl?.setAttribute(
            'transform',
            `translate(${dx / scale} ${dy / scale}) ${t.baseTransform}`
          );
          t.pending = {
            ...t.startGeom,
            x: t.startGeom.x + dx / scale,
            y: t.startGeom.y + dy / scale
          };
        }
        setBox({
          ...g.startBox,
          left: g.startBox.left + dx,
          top: g.startBox.top + dy
        });
        setGuides(gs);
      } else if (g.mode === 'resize') {
        const t = g.targets[0];
        const d = g.dir!;
        const s = t.startGeom;
        const dxE = dxRaw / scale;
        const dyE = dyRaw / scale;
        let { x, y, cx, cy } = s;
        if (d.left) {
          x = s.x + dxE;
          cx = Math.max(MIN_EMU, s.cx - dxE);
        }
        if (d.right) {
          cx = Math.max(MIN_EMU, s.cx + dxE);
        }
        if (d.top) {
          y = s.y + dyE;
          cy = Math.max(MIN_EMU, s.cy - dyE);
        }
        if (d.bottom) {
          cy = Math.max(MIN_EMU, s.cy + dyE);
        }
        t.pending = { x, y, cx, cy, rot: s.rot };
        let { left, top, width, height } = g.startBox;
        if (d.left) {
          left = g.startBox.left + dxRaw;
          width = Math.max(8, g.startBox.width - dxRaw);
        }
        if (d.right) {
          width = Math.max(8, g.startBox.width + dxRaw);
        }
        if (d.top) {
          top = g.startBox.top + dyRaw;
          height = Math.max(8, g.startBox.height - dyRaw);
        }
        if (d.bottom) {
          height = Math.max(8, g.startBox.height + dyRaw);
        }
        setBox({ ...g.startBox, left, top, width, height });
      } else if (g.mode === 'tableEdge') {
        const edge = g.tableEdge!;
        const radians = (g.startBox.rot * Math.PI) / 180;
        const axisPx =
          edge.axis === 'column'
            ? dxRaw * Math.cos(radians) + dyRaw * Math.sin(radians)
            : -dxRaw * Math.sin(radians) + dyRaw * Math.cos(radians);
        const direction = edge.outerStart ? -1 : 1;
        const next = Math.max(
          MIN_EMU,
          g.tableSizeStart! + (direction * axisPx) / scale
        );
        const effectivePx = (next - g.tableSizeStart!) * scale * direction;
        g.pendingSize = next;
        g.pendingPosition = edge.outerStart ? effectivePx / scale : undefined;
        setTableEdgePreview({
          axis: edge.axis,
          position: g.tableBoundaryStartPx! + effectivePx
        });
        if (edge.axis === 'column') {
          setBox({
            ...g.startBox,
            left: g.startBox.left + (edge.outerStart ? effectivePx : 0),
            width:
              g.startBox.width + (edge.outerStart ? -effectivePx : effectivePx)
          });
        } else {
          setBox({
            ...g.startBox,
            top: g.startBox.top + (edge.outerStart ? effectivePx : 0),
            height:
              g.startBox.height + (edge.outerStart ? -effectivePx : effectivePx)
          });
        }
      } else {
        // rotate
        const t = g.targets[0];
        const s = t.startGeom;
        const ang =
          (Math.atan2(e.clientY - g.center!.y, e.clientX - g.center!.x) * 180) /
          Math.PI;
        let rot = s.rot + (ang - g.startAngle!);
        const snapped = Math.round(rot / 15) * 15; // snap to 15° near increments
        if (Math.abs(snapped - rot) < 4) rot = snapped;
        rot = ((rot % 360) + 360) % 360;
        t.gEl?.setAttribute(
          'transform',
          `translate(${s.x} ${s.y}) rotate(${rot} ${s.cx / 2} ${s.cy / 2})`
        );
        t.pending = { ...s, rot };
        setBox({ ...g.startBox, rot });
      }
    };
    const onUp = (e: MouseEvent) => {
      const cellDrag = cellDragRef.current;
      if (cellDrag) {
        cellDragRef.current = null;
        if (!cellDrag.moved && cellDrag.editOnClick)
          setEditingCell({
            shapeId: cellDrag.shapeId,
            row: cellDrag.startRow,
            col: cellDrag.startCol,
            point: { x: e.clientX, y: e.clientY }
          });
        return;
      }
      // finish marquee → select intersecting shapes
      if (marqueeRef.current) {
        const m = marqueeRef.current;
        marqueeRef.current = null;
        setMarquee(null);
        const st = store.getState();
        const sl = st.deck?.slides[st.activeSlide];
        const hostEl = hostRef.current;
        if (st.deck && sl && hostEl) {
          const hr = hostEl.getBoundingClientRect();
          const scale = scaleRef.current;
          const o = originRef.current;
          const rx1 = Math.min(m.startX, e.clientX) - hr.left;
          const ry1 = Math.min(m.startY, e.clientY) - hr.top;
          const rx2 = Math.max(m.startX, e.clientX) - hr.left;
          const ry2 = Math.max(m.startY, e.clientY) - hr.top;
          const hit: string[] = [];
          for (const s of sl.shapes) {
            if (!s.xfrm) continue;
            const sx1 = o.x + s.xfrm.x * scale;
            const sy1 = o.y + s.xfrm.y * scale;
            const sx2 = sx1 + s.xfrm.cx * scale;
            const sy2 = sy1 + s.xfrm.cy * scale;
            if (sx1 < rx2 && sx2 > rx1 && sy1 < ry2 && sy2 > ry1)
              hit.push(s.id);
          }
          selectMany(hit);
        }
        return;
      }
      const g = gesture.current;
      gesture.current = null;
      setGuides([]);
      setTableEdgePreview(null);
      if (!g) return;
      const st = store.getState();
      const sl = st.deck?.slides[st.activeSlide];
      if (!st.deck || !sl) return;
      if (g.mode === 'crop') {
        const sh = sl.shapes.find(
          (candidate) => candidate.id === g.targets[0].shapeId
        );
        if (sh && g.pendingCrop) {
          store.executeCommand(
            {
              type: 'set-picture-crop',
              slideId: sl.path,
              shapeId: sh.id,
              crop: g.pendingCrop,
              geometry: g.targets[0].pending
            },
            'Crop picture'
          );
        }
        return;
      }
      if (g.mode === 'tableEdge') {
        const sh = sl.shapes.find((shape) => shape.id === g.targets[0].shapeId);
        if (
          sh &&
          g.pendingSize !== undefined &&
          Math.round(g.pendingSize) !== g.tableSizeStart
        ) {
          const edge = g.tableEdge!;
          const operations: TableEditOperation[] = [];
          if (edge.outerStart && g.pendingPosition !== undefined) {
            const start = g.targets[0].startGeom;
            operations.push({
              kind: 'set-geometry',
              geometry:
                edge.axis === 'column'
                  ? { x: Math.round(start.x + g.pendingPosition) }
                  : { y: Math.round(start.y + g.pendingPosition) }
            });
          }
          const index = edge.outerStart ? 0 : edge.index;
          operations.push(
            edge.axis === 'column'
              ? { kind: 'set-column-width', index, width: g.pendingSize }
              : { kind: 'set-row-height', index, height: g.pendingSize }
          );
          store.executeCommand(
            {
              type: 'edit-table',
              slideId: sl.path,
              shapeId: sh.id,
              operations
            },
            edge.axis === 'column' ? 'Resize table column' : 'Resize table row'
          );
        }
        return;
      }
      const updates = g.targets.flatMap((target) => {
        if (
          !target.pending ||
          !sl.shapes.some((shape) => shape.id === target.shapeId)
        )
          return [];
        const geometry =
          g.mode === 'move'
            ? { x: target.pending.x, y: target.pending.y }
            : g.mode === 'rotate'
            ? { rot: target.pending.rot }
            : target.pending;
        return [{ shapeId: target.shapeId, geometry }];
      });
      if (updates.length) {
        const label =
          g.mode === 'move'
            ? updates.length > 1
              ? 'Move shapes'
              : 'Move shape'
            : g.mode === 'rotate'
            ? 'Rotate shape'
            : 'Resize shape';
        store.executeCommand(
          { type: 'set-shape-geometries', slideId: sl.path, updates },
          label
        );
      }
    };
    featheryWindow().addEventListener('mousemove', onMove);
    featheryWindow().addEventListener('mouseup', onUp);
    return () => {
      featheryWindow().removeEventListener('mousemove', onMove);
      featheryWindow().removeEventListener('mouseup', onUp);
    };
  }, []);

  // click a shape to select (shift = add/remove); empty space starts a marquee
  const onHostDown = (e: React.MouseEvent) => {
    if (tableMenu && e.button === 0) setTableMenu(null);
    if (readOnly || gesture.current || editingId || editingCell) return;
    const t = e.target as HTMLElement;
    // Take keyboard focus so shortcuts stay scoped to THIS editor instance
    // (never focus away from an in-place contenteditable edit).
    if (!t.closest?.('[contenteditable="true"]'))
      hostRef.current?.focus({ preventScroll: true });
    // Keep the linked DOM node stable from mouse-down through click. Selecting
    // its shape here can update overlays/focus before the browser dispatches click.
    if (t.closest?.('[data-hyperlink]')) return;
    store.setTextSelection(null);
    if (t.closest?.('[data-overlay]')) return; // overlay/handles drive editing
    const g = t.closest?.('[data-shape-id]') as HTMLElement | null;
    const id = g?.dataset.shapeId;
    if (id) {
      const wasSelected = selectedIds.includes(id);
      const cell = t.closest?.('[data-table-cell]') as HTMLElement | null;
      const row = Number(cell?.dataset.row);
      const col = Number(cell?.dataset.col);
      const isTableCell =
        !!cell &&
        Number.isInteger(row) &&
        Number.isInteger(col) &&
        slide?.shapes.find((shape) => shape.id === id)?.type === 'table';
      if (isTableCell) hostRef.current?.focus({ preventScroll: true });
      if (e.shiftKey) toggleSelect(id);
      else if (!wasSelected) {
        select(id);
        if (isTableCell)
          store.setTableSelection({
            shapeId: id,
            startRow: row,
            startCol: col,
            endRow: row,
            endCol: col
          });
      } else if (
        e.button === 0 &&
        slide?.shapes.find((shape) => shape.id === id)?.type === 'table'
      ) {
        if (isTableCell) {
          e.preventDefault();
          const current = store.getState().tableSelection;
          const editOnClick =
            current?.shapeId === id &&
            current.startRow === row &&
            current.endRow === row &&
            current.startCol === col &&
            current.endCol === col;
          store.setTableSelection({
            shapeId: id,
            startRow: row,
            startCol: col,
            endRow: row,
            endCol: col
          });
          cellDragRef.current = {
            shapeId: id,
            startRow: row,
            startCol: col,
            endRow: row,
            endCol: col,
            startX: e.clientX,
            startY: e.clientY,
            moved: false,
            editOnClick
          };
        } else startGesture('move')(e);
      } else if (
        wasSelected &&
        e.button === 0 &&
        !t.closest?.('[data-hyperlink]')
      )
        startGesture('move')(e);
    } else {
      if (!e.shiftKey) select(null);
      marqueeRef.current = { startX: e.clientX, startY: e.clientY };
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    if (readOnly) return;
    const cell = (e.target as HTMLElement).closest?.(
      '[data-table-cell], [data-table-cell-bg]'
    ) as HTMLElement | null;
    const shapeG = cell?.closest?.('[data-shape-id]') as HTMLElement | null;
    const shapeId = shapeG?.dataset.shapeId;
    const row = Number(cell?.dataset.row);
    const col = Number(cell?.dataset.col);
    if (!cell || !shapeId || !Number.isInteger(row) || !Number.isInteger(col)) {
      setTableMenu(null);
      return;
    }
    e.preventDefault();
    const hostRect = hostRef.current?.getBoundingClientRect();
    select(shapeId);
    store.setTableSelection({
      shapeId,
      startRow: row,
      startCol: col,
      endRow: row,
      endCol: col
    });
    setTableMenu({
      x: e.clientX - (hostRect?.left ?? 0) + (hostRef.current?.scrollLeft ?? 0),
      y: e.clientY - (hostRect?.top ?? 0) + (hostRef.current?.scrollTop ?? 0),
      shapeId,
      row,
      col
    });
  };

  const runTableMenu = (
    operations: import('../engine').TableEditOperation[],
    label: string
  ) => {
    const menu = tableMenu;
    setTableMenu(null);
    if (!menu) return;
    const st = store.getState();
    const sl = st.deck?.slides[st.activeSlide];
    if (!sl) return;
    store.executeCommand(
      {
        type: 'edit-table',
        slideId: sl.path,
        shapeId: menu.shapeId,
        operations
      },
      label
    );
  };

  const onHostClick = (e: React.MouseEvent) => {
    if (editingId || editingCell) return;
    const link = (e.target as Element).closest?.(
      'a[data-hyperlink]'
    ) as HTMLAnchorElement | null;
    if (!link) return;
    e.preventDefault();
    e.stopPropagation();
    const slideTarget = link.dataset.slideTarget;
    if (slideTarget && deck) {
      const index = deck.slides.findIndex(
        (candidate) => candidate.path === slideTarget
      );
      if (index >= 0) store.setActiveSlide(index);
      return;
    }
    const href = link.getAttribute('href');
    if (href) featheryWindow().open(href, '_blank', 'noopener,noreferrer');
  };

  // double-click a text shape (or its selection overlay) to edit its text in place
  const onDoubleClick = (e: React.MouseEvent) => {
    if (readOnly) return;
    const t = e.target as HTMLElement;
    const cell = t.closest?.('[data-table-cell]') as HTMLElement | null;
    if (cell) {
      const g = cell.closest?.('[data-shape-id]') as HTMLElement | null;
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      if (
        g?.dataset.shapeId &&
        Number.isInteger(row) &&
        Number.isInteger(col)
      ) {
        select(g.dataset.shapeId);
        store.setTableSelection({
          shapeId: g.dataset.shapeId,
          startRow: row,
          startCol: col,
          endRow: row,
          endCol: col
        });
        const selection = featheryWindow().getSelection();
        const range = featheryDoc().createRange();
        range.selectNodeContents(cell);
        selection?.removeAllRanges();
        selection?.addRange(range);
        setEditingCell({
          shapeId: g.dataset.shapeId,
          row,
          col,
          selectAll: true
        });
      }
      return;
    }
    let id = (t.closest?.('[data-shape-id]') as HTMLElement | null)?.dataset
      .shapeId;
    if (!id && t.closest?.('[data-overlay]')) id = selectedId ?? undefined; // dbl-click the overlay of the selected shape
    const target = slide?.shapes.find((sh) => sh.id === id);
    if (target?.type === 'pic') {
      select(id ?? null);
      setPictureCropMode(id ?? null);
      return;
    }
    if (target?.text) {
      dblPointRef.current = { x: e.clientX, y: e.clientY };
      select(id ?? null);
      setEditingId(id ?? null);
    }
  };

  // Table selection navigation, plus Delete / Backspace for selected shapes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editingId || editingCell) return; // let contentEditable handle Backspace/Delete while editing
      if (e.key === 'Escape' && pictureCropModeId) {
        e.preventDefault();
        setPictureCropMode(null);
        return;
      }
      if (e.key === 'Escape' && selectedIds.length) {
        e.preventDefault();
        select(null);
        return;
      }
      const meta = e.metaKey || e.ctrlKey;
      // Cmd/Ctrl+A selects every positioned shape on the slide.
      if (meta && e.key.toLowerCase() === 'a' && slide) {
        e.preventDefault();
        store.selectMany(
          slide.shapes.filter((shape) => shape.xfrm).map((shape) => shape.id)
        );
        return;
      }
      // Cmd/Ctrl+B/I/U toggle the selected shape's text style (while editing,
      // the browser handles these inside the contenteditable instead).
      if (meta && deck && slide && selectedIds.length === 1) {
        const key = e.key.toLowerCase();
        const styleKey =
          key === 'b'
            ? 'bold'
            : key === 'i'
            ? 'italic'
            : key === 'u'
            ? 'underline'
            : null;
        if (styleKey) {
          const shape = slide.shapes.find(
            (candidate) => candidate.id === selectedIds[0]
          );
          const run = shape?.text?.paragraphs.flatMap((p) => p.runs)[0];
          if (shape && run) {
            e.preventDefault();
            store.executeCommand(
              {
                type: 'format-text',
                slideId: slide.path,
                shapeId: shape.id,
                style: { [styleKey]: !(run as any)[styleKey] }
              },
              'Format text'
            );
            return;
          }
        }
      }
      // Arrow keys nudge the selection (Shift = larger step), like PowerPoint.
      if (
        !meta &&
        deck &&
        slide &&
        selectedIds.length &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)
      ) {
        e.preventDefault();
        const step = (e.shiftKey ? 10 : 1) * 9525; // 1px / 10px at 96dpi, in EMU
        const dx =
          e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy =
          e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const updates = selectedIds.flatMap((shapeId) => {
          const shape = slide.shapes.find(
            (candidate) => candidate.id === shapeId
          );
          if (!shape?.xfrm) return [];
          return [
            {
              shapeId,
              geometry: { x: shape.xfrm.x + dx, y: shape.xfrm.y + dy }
            }
          ];
        });
        if (updates.length)
          store.executeCommand(
            { type: 'set-shape-geometries', slideId: slide.path, updates },
            updates.length > 1 ? 'Move shapes' : 'Move shape'
          );
        return;
      }
      if (e.key === 'Tab' && deck && slide) {
        const active = featheryDoc().activeElement;
        const host = hostRef.current;
        // A highlighted table cell owns Tab while focus is on the slide. Once the
        // user focuses a toolbar control, preserve normal browser focus traversal.
        if (
          active !== featheryDoc().body &&
          active !== host &&
          !host?.contains(active)
        )
          return;
        const state = store.getState();
        const range = state.tableSelection;
        const table =
          range && state.selectedIds.includes(range.shapeId)
            ? slide.shapes.find(
                (shape) => shape.id === range.shapeId && shape.type === 'table'
              )
            : undefined;
        if (range && table) {
          e.preventDefault();
          let next = nextTableAnchor(table, range.endRow, range.endCol);
          if (!next) {
            next = { row: tableRows(table).length, col: 0 };
            store.executeCommand(
              {
                type: 'edit-table',
                slideId: slide.path,
                shapeId: table.id,
                operations: [{ kind: 'add-row' }]
              },
              'Add table row'
            );
          }
          store.setTableSelection({
            shapeId: table.id,
            startRow: next.row,
            startCol: next.col,
            endRow: next.row,
            endCol: next.col
          });
          return;
        }
      }
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        deck &&
        slide &&
        selectedShapes.length
      ) {
        e.preventDefault();
        const shapeIds = selectedShapes.map((shape) => shape.id);
        store.executeCommand(
          {
            type: 'delete-shapes',
            slideId: slide.path,
            shapeIds
          },
          shapeIds.length > 1 ? 'Delete shapes' : 'Delete shape'
        );
        select(null);
      }
    };
    // Scoped to the stage host: two editors on a page must not both react.
    if (readOnly) return;
    const host = hostRef.current;
    host?.addEventListener('keydown', onKey);
    return () => host?.removeEventListener('keydown', onKey);
  }, [
    deck,
    slide,
    selectedIds,
    editingId,
    editingCell,
    pictureCropModeId,
    setPictureCropMode
  ]);

  if (!deck)
    return (
      <div style={styles.empty}>
        <p style={{ color: '#889' }}>Open a .pptx to begin.</p>
      </div>
    );

  return (
    <div
      ref={hostRef}
      data-pptx-stage
      tabIndex={-1}
      style={styles.wrap}
      onMouseDown={onHostDown}
      onClick={onHostClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <div ref={svgHostRef} style={{ ...styles.frame, width: `${zoom}%` }} />
      {tableMenu && (
        <div
          data-overlay
          style={{
            position: 'absolute',
            left: tableMenu.x,
            top: tableMenu.y,
            zIndex: 40,
            minWidth: 190,
            padding: 4,
            background: '#fff',
            border: '1px solid #e4e4e7',
            borderRadius: 8,
            boxShadow: '0 6px 18px rgba(23,26,28,.13)',
            display: 'flex',
            flexDirection: 'column'
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {(
            [
              [
                'Insert row above',
                [{ kind: 'add-row', index: tableMenu.row }],
                'Add table row'
              ],
              [
                'Insert row below',
                [{ kind: 'add-row', index: tableMenu.row + 1 }],
                'Add table row'
              ],
              [
                'Insert column left',
                [{ kind: 'add-column', index: tableMenu.col }],
                'Add table column'
              ],
              [
                'Insert column right',
                [{ kind: 'add-column', index: tableMenu.col + 1 }],
                'Add table column'
              ],
              [
                'Delete row',
                [{ kind: 'remove-row', index: tableMenu.row }],
                'Remove table row'
              ],
              [
                'Delete column',
                [{ kind: 'remove-column', index: tableMenu.col }],
                'Remove table column'
              ]
            ] as const
          ).map(([label, operations, commandLabel]) => (
            <button
              key={label}
              type='button'
              onClick={() => runTableMenu([...operations], commandLabel)}
              style={{
                display: 'block',
                width: '100%',
                padding: '7px 10px',
                border: 'none',
                borderRadius: 6,
                background: 'transparent',
                color: '#3f3f46',
                fontSize: 12.5,
                textAlign: 'left',
                cursor: 'pointer'
              }}
              onMouseEnter={(e) =>
                ((e.target as HTMLElement).style.background = '#f4f4f5')
              }
              onMouseLeave={(e) =>
                ((e.target as HTMLElement).style.background = 'transparent')
              }
            >
              {label}
            </button>
          ))}
          <button
            type='button'
            onClick={() => {
              const menu = tableMenu;
              setTableMenu(null);
              if (!menu) return;
              const st = store.getState();
              const sl = st.deck?.slides[st.activeSlide];
              if (!sl) return;
              store.executeCommand(
                {
                  type: 'delete-shapes',
                  slideId: sl.path,
                  shapeIds: [menu.shapeId]
                },
                'Delete table'
              );
              select(null);
            }}
            style={{
              display: 'block',
              width: '100%',
              padding: '7px 10px',
              border: 'none',
              borderTop: '1px solid #e4e4e7',
              borderRadius: 6,
              background: 'transparent',
              color: '#dc3a4b',
              fontSize: 12.5,
              textAlign: 'left',
              cursor: 'pointer'
            }}
          >
            Delete table
          </button>
        </div>
      )}
      {/* alignment guides (during a snap) */}
      {guides.map((gd, i) => (
        <div
          key={i}
          data-overlay
          style={{
            position: 'absolute',
            background: '#e2467a',
            pointerEvents: 'none',
            zIndex: 20,
            ...(gd.x !== undefined
              ? { left: gd.x, top: 0, width: 1, height: '100%' }
              : { left: 0, top: gd.y, width: '100%', height: 1 })
          }}
        />
      ))}
      {/* marquee selection rectangle */}
      {marquee &&
        (() => {
          const hr = hostRef.current?.getBoundingClientRect();
          const ox = hr?.left ?? 0;
          const oy = hr?.top ?? 0;
          return (
            <div
              style={{
                position: 'absolute',
                left: marquee.x - ox,
                top: marquee.y - oy,
                width: marquee.w,
                height: marquee.h,
                border: '1px solid #5b8def',
                background: 'rgba(91,141,239,0.12)',
                pointerEvents: 'none',
                zIndex: 20
              }}
            />
          );
        })()}
      {/* editing affordance: a non-interactive outline around the box being edited in place */}
      {box && (editingId || editingCell) && (
        <div
          style={{
            position: 'absolute',
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
            transform: `rotate(${box.rot}deg)`,
            transformOrigin: 'center',
            outline: '1.5px solid #5b8def',
            pointerEvents: 'none',
            zIndex: 16
          }}
        />
      )}
      {box && !editingId && !editingCell && (
        <div
          data-overlay
          data-table-selection={selectedTable ? '' : undefined}
          data-picture-crop-frame={cropShape ? '' : undefined}
          style={{
            position: 'absolute',
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
            transform: `rotate(${box.rot}deg)`,
            transformOrigin: 'center',
            boxSizing: 'border-box',
            border: cropShape
              ? '2px solid #ffffff'
              : box.group
              ? '1.5px dashed #5b8def'
              : '1.5px solid #5b8def',
            boxShadow: cropShape ? '0 0 0 1px rgba(0,0,0,.65)' : undefined,
            cursor: cropShape ? 'default' : selectedTable ? 'default' : 'move',
            zIndex: 15,
            pointerEvents: cropShape ? 'auto' : 'none'
          }}
        >
          {cropShape &&
            cropPreview &&
            (() => {
              const { left, top, right, bottom } = cropPreview.cropPct;
              const width = Math.max(1, 100 - left - right);
              const height = Math.max(1, 100 - top - bottom);
              const imageLeft = (-left / width) * 100;
              const imageTop = (-top / height) * 100;
              const imageWidth = 10000 / width;
              const imageHeight = 10000 / height;
              const round = cropPreview.clipGeometry === 'ellipse' ? '50%' : 2;
              return (
                <>
                  <div
                    data-picture-crop-preview
                    style={{
                      position: 'absolute',
                      inset: 0,
                      overflow: 'visible',
                      pointerEvents: 'none'
                    }}
                  >
                    {cropShape.imageSrc && (
                      <>
                        <img
                          src={cropShape.imageSrc}
                          alt=''
                          draggable={false}
                          style={{
                            position: 'absolute',
                            left: `${imageLeft}%`,
                            top: `${imageTop}%`,
                            width: `${imageWidth}%`,
                            height: `${imageHeight}%`,
                            opacity: 0.3,
                            pointerEvents: 'none'
                          }}
                        />
                        <img
                          src={cropShape.imageSrc}
                          alt=''
                          draggable={false}
                          style={{
                            position: 'absolute',
                            left: `${imageLeft}%`,
                            top: `${imageTop}%`,
                            width: `${imageWidth}%`,
                            height: `${imageHeight}%`,
                            clipPath: `inset(${top}% ${right}% ${bottom}% ${left}%)`,
                            pointerEvents: 'none'
                          }}
                        />
                      </>
                    )}
                  </div>
                  <div
                    data-picture-crop-region
                    title='Drag to reposition the crop'
                    onMouseDown={startCropGesture(undefined, true)}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      boxSizing: 'border-box',
                      border: '2px solid #fff',
                      outline: '1px solid rgba(0,0,0,.75)',
                      borderRadius: round,
                      cursor: 'move',
                      pointerEvents: 'auto'
                    }}
                  >
                    {HANDLES.map((handle) => (
                      <div
                        key={`crop-${handle.key}`}
                        data-picture-crop-handle={handle.key}
                        title={`Adjust ${handle.key} crop edge`}
                        onMouseDown={startCropGesture(handle.dir)}
                        style={{
                          position: 'absolute',
                          width: handle.x === 0.5 ? 18 : 9,
                          height: handle.y === 0.5 ? 18 : 9,
                          left: `calc(${handle.x * 100}% - ${
                            handle.x === 0.5 ? 9 : 4.5
                          }px)`,
                          top: `calc(${handle.y * 100}% - ${
                            handle.y === 0.5 ? 9 : 4.5
                          }px)`,
                          background: '#111',
                          border: '2px solid #fff',
                          borderRadius: 1,
                          boxSizing: 'border-box',
                          cursor: handle.cur,
                          pointerEvents: 'auto'
                        }}
                      />
                    ))}
                  </div>
                  <div
                    data-picture-crop-help
                    style={{
                      position: 'absolute',
                      left: '50%',
                      bottom: -32,
                      transform: 'translateX(-50%)',
                      whiteSpace: 'nowrap',
                      padding: '4px 8px',
                      borderRadius: 4,
                      background: '#1f2633',
                      color: '#fff',
                      fontSize: 11,
                      pointerEvents: 'none',
                      boxShadow: '0 2px 6px rgba(0,0,0,.25)'
                    }}
                  >
                    Drag inside to move image · drag handles to resize crop ·
                    Esc to finish
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      right: 4,
                      top: 4,
                      padding: '2px 5px',
                      borderRadius: 3,
                      background: 'rgba(20,24,32,.72)',
                      color: '#fff',
                      fontSize: 10,
                      pointerEvents: 'none'
                    }}
                  >
                    {Math.round(width)}% × {Math.round(height)}% source
                  </div>
                </>
              );
            })()}
          {/* resize handles + rotation only for a single selection */}
          {!box.group &&
            !selectedTable &&
            !cropShape &&
            HANDLES.map((h) => (
              <div
                key={h.key}
                data-overlay
                onMouseDown={startGesture('resize', h.dir)}
                style={{
                  position: 'absolute',
                  width: 9,
                  height: 9,
                  background: '#fff',
                  border: '1.5px solid #5b8def',
                  borderRadius: 2,
                  left: `calc(${h.x * 100}% - 5px)`,
                  top: `calc(${h.y * 100}% - 5px)`,
                  cursor: h.cur,
                  pointerEvents: 'auto'
                }}
              />
            ))}
          {selectedTable &&
            tableGrid &&
            (() => {
              let x = 0;
              let y = 0;
              const columnEdges = [
                { index: -1, position: 0, outerStart: true },
                ...tableGrid.columns.map((width, index) => {
                  x += width * box.scale;
                  return { index, position: x, outerStart: false };
                })
              ];
              const rowEdges = [
                { index: -1, position: 0, outerStart: true },
                ...tableGrid.rows.map((height, index) => {
                  y += height * box.scale;
                  return { index, position: y, outerStart: false };
                })
              ];
              const range =
                tableSelection?.shapeId === selectedTable.id
                  ? tableSelection
                  : null;
              const minRow = range
                ? Math.min(range.startRow, range.endRow)
                : -1;
              let maxRow = range ? Math.max(range.startRow, range.endRow) : -1;
              const minCol = range
                ? Math.min(range.startCol, range.endCol)
                : -1;
              let maxCol = range ? Math.max(range.startCol, range.endCol) : -1;
              // A selected merged anchor represents its entire visible cell. Expand
              // until every merged anchor touched by the range is fully enclosed.
              if (range) {
                let expanded = true;
                while (expanded) {
                  expanded = false;
                  for (let row = minRow; row <= maxRow; row++)
                    for (let col = minCol; col <= maxCol; col++) {
                      const cell = tableCell(selectedTable, row, col);
                      if (!cell || tableCellIsMergeContinuation(cell)) continue;
                      const nextRow = Math.min(
                        tableGrid.rows.length - 1,
                        row + tableCellRowSpan(cell) - 1
                      );
                      const nextCol = Math.min(
                        tableGrid.columns.length - 1,
                        col + tableCellGridSpan(cell) - 1
                      );
                      if (nextRow > maxRow) {
                        maxRow = nextRow;
                        expanded = true;
                      }
                      if (nextCol > maxCol) {
                        maxCol = nextCol;
                        expanded = true;
                      }
                    }
                }
              }
              const selectionLeft = range
                ? tableGrid.columns
                    .slice(0, minCol)
                    .reduce((sum, width) => sum + width, 0) * box.scale
                : 0;
              const selectionTop = range
                ? tableGrid.rows
                    .slice(0, minRow)
                    .reduce((sum, height) => sum + height, 0) * box.scale
                : 0;
              const selectionWidth = range
                ? tableGrid.columns
                    .slice(minCol, maxCol + 1)
                    .reduce((sum, width) => sum + width, 0) * box.scale
                : 0;
              const selectionHeight = range
                ? tableGrid.rows
                    .slice(minRow, maxRow + 1)
                    .reduce((sum, height) => sum + height, 0) * box.scale
                : 0;
              return (
                <>
                  {range && (
                    <div
                      data-overlay
                      data-table-range
                      style={{
                        position: 'absolute',
                        left: selectionLeft,
                        top: selectionTop,
                        width: selectionWidth,
                        height: selectionHeight,
                        boxSizing: 'border-box',
                        border: '2px solid #2f6fed',
                        background: 'rgba(47,111,237,0.13)',
                        pointerEvents: 'none'
                      }}
                    />
                  )}
                  <div
                    data-overlay
                    data-table-move-handle
                    title='Move table'
                    onMouseDown={startGesture('move')}
                    style={{
                      position: 'absolute',
                      left: -13,
                      top: -13,
                      width: 12,
                      height: 12,
                      borderRadius: 2,
                      background: '#5b8def',
                      cursor: 'move',
                      pointerEvents: 'auto'
                    }}
                  />
                  {columnEdges.map((edge) => (
                    <div
                      key={`column-${edge.index}`}
                      data-overlay
                      data-table-edge='column'
                      data-index={edge.index}
                      title={`Resize column ${
                        edge.outerStart ? 1 : edge.index + 1
                      }`}
                      onMouseEnter={() =>
                        setHoveredTableEdge(`column-${edge.index}`)
                      }
                      onMouseLeave={() => setHoveredTableEdge(null)}
                      onMouseDown={startTableEdge(
                        {
                          axis: 'column',
                          index: edge.index,
                          outerStart: edge.outerStart
                        },
                        edge.position
                      )}
                      onDoubleClick={fitTableEdge({
                        axis: 'column',
                        index: edge.index,
                        outerStart: edge.outerStart
                      })}
                      style={{
                        position: 'absolute',
                        left: edge.position - 5,
                        top: 0,
                        width: 10,
                        height: '100%',
                        cursor: 'col-resize',
                        pointerEvents: 'auto',
                        background:
                          hoveredTableEdge === `column-${edge.index}`
                            ? 'linear-gradient(to right, transparent 4px, #5b8def 4px, #5b8def 6px, transparent 6px)'
                            : undefined
                      }}
                    />
                  ))}
                  {rowEdges.map((edge) => (
                    <div
                      key={`row-${edge.index}`}
                      data-overlay
                      data-table-edge='row'
                      data-index={edge.index}
                      title={`Resize row ${
                        edge.outerStart ? 1 : edge.index + 1
                      }`}
                      onMouseEnter={() =>
                        setHoveredTableEdge(`row-${edge.index}`)
                      }
                      onMouseLeave={() => setHoveredTableEdge(null)}
                      onMouseDown={startTableEdge(
                        {
                          axis: 'row',
                          index: edge.index,
                          outerStart: edge.outerStart
                        },
                        edge.position
                      )}
                      onDoubleClick={fitTableEdge({
                        axis: 'row',
                        index: edge.index,
                        outerStart: edge.outerStart
                      })}
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: edge.position - 5,
                        width: '100%',
                        height: 10,
                        cursor: 'row-resize',
                        pointerEvents: 'auto',
                        background:
                          hoveredTableEdge === `row-${edge.index}`
                            ? 'linear-gradient(to bottom, transparent 4px, #5b8def 4px, #5b8def 6px, transparent 6px)'
                            : undefined
                      }}
                    />
                  ))}
                  {tableEdgePreview && (
                    <div
                      data-overlay
                      style={{
                        position: 'absolute',
                        pointerEvents: 'none',
                        background: '#5b8def',
                        ...(tableEdgePreview.axis === 'column'
                          ? {
                              left: tableEdgePreview.position,
                              top: 0,
                              width: 2,
                              height: '100%'
                            }
                          : {
                              top: tableEdgePreview.position,
                              left: 0,
                              height: 2,
                              width: '100%'
                            })
                      }}
                    />
                  )}
                </>
              );
            })()}
          {!box.group && !cropShape && (
            <>
              <div
                data-overlay
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: -24,
                  width: 1,
                  height: 22,
                  background: '#5b8def',
                  transform: 'translateX(-0.5px)',
                  pointerEvents: 'none'
                }}
              />
              <div
                data-overlay
                onMouseDown={startGesture('rotate')}
                title='Rotate'
                aria-label='Rotate shape'
                style={{
                  position: 'absolute',
                  left: 'calc(50% - 9px)',
                  top: -42,
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: '#fff',
                  border: '1.5px solid #5b8def',
                  boxShadow: '0 1px 3px rgba(23,26,28,.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  // No native rotate cursor exists; use a circular-arrow SVG
                  // cursor (hotspot centered) with grab as the fallback.
                  cursor: `url("data:image/svg+xml,${encodeURIComponent(
                    "<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24'><g fill='none' stroke='#fff' stroke-width='5' stroke-linecap='round'><path d='M20 12a8 8 0 1 1-2.34-5.66'/></g><g fill='none' stroke='#171a1c' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M20 12a8 8 0 1 1-2.34-5.66'/><path d='M18.5 2.5v4h-4'/></g></svg>"
                  )}") 11 11, grab`,
                  pointerEvents: 'auto'
                }}
              >
                {/* Rotate glyph so the handle reads as rotation, not a dot. */}
                <svg
                  viewBox='0 0 24 24'
                  width={11}
                  height={11}
                  style={{
                    fill: 'none',
                    stroke: '#5b8def',
                    strokeWidth: 2.6,
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                    pointerEvents: 'none'
                  }}
                >
                  <path d='M20 12a8 8 0 1 1-2.34-5.66' />
                  <path d='M18.5 3v3.5H15' />
                </svg>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    flex: 1,
    position: 'relative',
    overflow: 'auto',
    display: 'flex',
    alignItems: 'flex-start',
    padding: 16,
    background: '#e9ecf2',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    outline: 'none'
  },
  frame: {
    width: 'min(1100px, 100%)',
    // A shrinkable flex child caps the zoom at 100%: the width climbs but the
    // box is squeezed back to fit. Auto margins (not justify-content) center
    // it so the left edge stays reachable once it overflows.
    flexShrink: 0,
    margin: '0 auto',
    boxShadow: '0 2px 16px rgba(0,0,0,0.18)',
    background: '#fff'
  },
  empty: {
    flex: 1,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    background: '#e9ecf2'
  }
};
