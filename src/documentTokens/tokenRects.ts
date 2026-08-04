/**
 * Where each token's text sits on screen, in the editor's own coordinates.
 *
 * The document is painted to a canvas, so there is no element to style — a
 * background has to be drawn over the top, and that needs coordinates.
 * SyncFusion exposes no public "where is this bookmark on screen"
 * (`selection.getRect` takes an internal TextPosition), so this reads the
 * layout tree directly.
 *
 * That makes this the one module coupled to SyncFusion internals. It degrades
 * quietly: anything it cannot measure simply is not drawn, so a version bump
 * that moves these fields costs the colour, not the document.
 *
 * Ported from the prototype's tokenRects.ts, which measured the same way
 * against the same widget tree.
 */

import { bookmarkFor } from './controls';

export interface TokenRect {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  /** The editor's zoom, so the corner radius can scale with the text. */
  zoom: number;
}

interface ElementLike {
  width?: number;
  height?: number;
  name?: string;
  referenceEnd?: unknown;
  line?: LineLike;
}
interface LineLike {
  children?: ElementLike[];
  height?: number;
  paragraph?: ParagraphLike;
}
interface Rectangle {
  x?: number;
  y?: number;
}
interface ParagraphLike {
  x?: number;
  y?: number;
  childWidgets?: { height?: number }[];
  bodyWidget?: { page?: { boundingRectangle?: Rectangle } };
}
interface DocumentHelperLike {
  bookmarks?: {
    get(name: string): (ElementLike & { line?: LineLike }) | undefined;
  };
  pages?: { boundingRectangle?: Rectangle }[];
}

/** Measure the on-screen rectangle of every given token id. */
export function measureTokenRects(editor: any, ids: string[]): TokenRect[] {
  const helper = editor?.documentHelper as DocumentHelperLike | undefined;
  const bookmarks = helper?.bookmarks;
  if (!bookmarks?.get) return [];

  const zoom = editor?.zoomFactor || 1;
  const rects: TokenRect[] = [];

  for (const id of ids) {
    const name = bookmarkFor(id);
    const start = bookmarks.get(name);
    const line = start?.line;
    const paragraph = line?.paragraph;
    if (!start || !line?.children || typeof paragraph?.x !== 'number') continue;

    const children = line.children;
    const startIndex = children.indexOf(start);
    if (startIndex < 0) continue;

    // x: the widths of everything on the line before the bookmark.
    let offsetX = 0;
    for (let i = 0; i < startIndex; i += 1) offsetX += children[i].width ?? 0;

    // width: everything between the bookmark's two markers.
    let width = 0;
    for (let i = startIndex + 1; i < children.length; i += 1) {
      const child = children[i];
      if (child === start.referenceEnd || child.name === name) break;
      width += child.width ?? 0;
    }
    if (width <= 0) continue;

    // y: the paragraph's top plus the lines above this one inside it.
    let offsetY = paragraph.y ?? 0;
    for (const sibling of paragraph.childWidgets ?? []) {
      if ((sibling as any) === line) break;
      offsetY += sibling.height ?? 0;
    }

    // Widget coordinates are page-relative and unzoomed. The page rectangle is
    // kept in viewport space by the editor — it already carries the centering
    // offset and the scroll position — so adding it lands where the caret is.
    const page =
      paragraph.bodyWidget?.page?.boundingRectangle ??
      helper?.pages?.[0]?.boundingRectangle;
    if (!page) continue;

    rects.push({
      id,
      left: (paragraph.x + offsetX) * zoom + (page.x ?? 0),
      top: offsetY * zoom + (page.y ?? 0),
      width: width * zoom,
      height: (line.height ?? 0) * zoom,
      zoom
    });
  }

  return rects;
}

/** Cheap equality so the overlay only re-renders when something moved. */
export function sameRects(a: TokenRect[], b: TokenRect[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((rect, i) => {
    const other = b[i];
    return (
      rect.id === other.id &&
      rect.zoom === other.zoom &&
      Math.abs(rect.left - other.left) < 0.5 &&
      Math.abs(rect.top - other.top) < 0.5 &&
      Math.abs(rect.width - other.width) < 0.5 &&
      Math.abs(rect.height - other.height) < 0.5
    );
  });
}

/** The scrolling surface the overlay lives in, so it tracks scroll for free. */
export function findViewerSurface(
  root: HTMLElement | null
): HTMLElement | null {
  return root?.querySelector<HTMLElement>('.e-de-background') ?? null;
}
