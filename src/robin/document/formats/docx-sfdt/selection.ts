/**
 * The person's selection as the descriptor carries it (contract section 9): the editor reports its
 * selection as hierarchical positions (`section;block;...;offset`, inline content control
 * boundaries counting one position each); here they become paragraph ids and offsets into each
 * paragraph's own text, the values a `set` match target or a `read` works from.
 */
import type { DocumentView, LaidOutPage } from '../../pack';
import type { NfNode } from '../../tree';
import { editorParagraphs } from './positions';
import { walkPositions } from './reconcile';

/** What the host reports: the editor's start and end positions and the selected text. */
export interface NativeSelection {
  start: string;
  end: string;
  text: string;
}

/** A paragraph's own-text offset for an editor offset: the inverse of `editorOffset`. */
function ownOffset(paragraph: NfNode, editorAt: number): number {
  let found: number | null = null;
  const total = walkPositions(paragraph, (run, own, native) => {
    // a position before this run (on a marker, an image or a control end) is where its text starts
    if (editorAt <= native) {
      found = own;
      return true;
    }
    if (editorAt <= native + String(run.text ?? '').length) {
      found = own + (editorAt - native);
      return true;
    }
    return false;
  });
  return found ?? total.own;
}

/** A reader of the editor's positions (`section;block;...;offset`) as paragraph ids and own-text offsets */
function positionsOf(
  view: DocumentView
): (position: string) => { id: string; offset: number } | null {
  const byPosition = new Map(
    [...editorParagraphs(view).values()].map((p) => [p.position, p])
  );
  return (position) => {
    const parts = position.split(';');
    const offset = Number(parts.pop());
    const found = byPosition.get(parts.join(';'));
    if (!found || !Number.isInteger(offset)) return null;
    const { paragraph, opensControl } = found;
    // The start of a block control takes one position before the text of the paragraph it opens on
    const editorAt = opensControl ? offset - 1 : offset;
    return { id: paragraph.id, offset: ownOffset(paragraph, editorAt) };
  };
}

export function selectionOf(
  view: DocumentView,
  native: unknown
): {
  start: { id: string; offset: number };
  end: { id: string; offset: number };
  text: string;
} | null {
  const s = native as Partial<NativeSelection> | null;
  if (!s || typeof s.start !== 'string' || typeof s.end !== 'string')
    return null;
  const order = new Map<string, number>();
  view.nodes().forEach((node, index) => order.set(node.id, index));
  const point = positionsOf(view);
  let start = point(s.start);
  let end = point(s.end);
  if (!start || !end) return null;
  // a selection made backwards reports its anchor first
  const before =
    (order.get(start.id) ?? 0) - (order.get(end.id) ?? 0) ||
    start.offset - end.offset;
  if (before > 0) [start, end] = [end, start];
  return { start, end, text: typeof s.text === 'string' ? s.text : '' };
}

/** Each laid-out page with the page number it shows, its paragraphs read from the editor's positions as the selection's are */
export function pagesOf(
  view: DocumentView,
  native: unknown
): LaidOutPage[] | null {
  if (!Array.isArray(native) || !native.length) return null;
  const point = positionsOf(view);
  return native.map((page) => ({
    paragraphs: (Array.isArray(page?.paragraphs)
      ? page.paragraphs
      : []
    ).flatMap((position: unknown) => {
      const at = typeof position === 'string' ? point(position) : null;
      return at ? [at] : [];
    }),
    number: Number.isInteger(page?.number) ? page.number : null
  }));
}
