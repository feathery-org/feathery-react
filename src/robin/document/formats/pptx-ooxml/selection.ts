import type { DocumentView, LaidOutPage } from '../../pack';
import { walk, type NfNode } from '../../tree';
import type { Pending } from './adapter/toNormalForm';
import { ownText } from './outline';
import { pptxTree } from './tree';

const liveSlide = (view: DocumentView, path: unknown) =>
  (view.nf.root.slides as NfNode[]).find(
    (slide) =>
      slide.path === path && !(slide.pending as Pending | undefined)?.deletion
  );

function paragraphsIn(node: NfNode): NfNode[] {
  const out: NfNode[] = [];
  walk(node, pptxTree, ({ node: kid }) => {
    if (kid.kind === 'paragraph') out.push(kid);
  });
  return out;
}

export function pagesOf(
  view: DocumentView,
  native: unknown
): LaidOutPage[] | null {
  if (!Array.isArray(native)) return null;
  return native.map((path, i) => {
    const slide = liveSlide(view, path);
    return {
      paragraphs: slide
        ? paragraphsIn(slide).map((paragraph) => ({
            id: paragraph.id,
            offset: 0
          }))
        : [],
      number: i + 1
    };
  });
}

/** The selected shapes as the span of their text */
export function selectionOf(
  view: DocumentView,
  native: unknown
): {
  start: { id: string; offset: number };
  end: { id: string; offset: number };
  text: string;
} | null {
  const { slide: path, shapes } = (native ?? {}) as {
    slide?: string;
    shapes?: string[];
  };
  const slide = liveSlide(view, path);
  if (!slide || !shapes?.length) return null;
  const paragraphs: NfNode[] = [];
  walk(slide, pptxTree, ({ node }) => {
    if (node.shapeId !== undefined && shapes.includes(String(node.shapeId)))
      paragraphs.push(...paragraphsIn(node));
  });
  const unique = [...new Set(paragraphs)];
  if (!unique.length) return null;
  const last = unique[unique.length - 1];
  return {
    start: { id: unique[0].id, offset: 0 },
    end: { id: last.id, offset: (ownText(last) ?? '').length },
    text: unique.map((paragraph) => ownText(paragraph) ?? '').join('\n')
  };
}
