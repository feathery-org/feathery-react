/**
 * The person's selection as the descriptor carries it (contract section 9): the editor reports its
 * selection as hierarchical positions (`section;block;...;offset`, inline content control
 * boundaries counting one position each); here they become paragraph ids and offsets into each
 * paragraph's own text, the values a `set` match target or a `read` works from.
 */
import type { DocumentView } from '../../pack';
import type { NfNode } from '../../tree';
import { KIND } from './adapter/keys';
import { hierOf, walkPositions } from './reconcile';

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
  const paragraphs = new Map<string, NfNode>();
  const order = new Map<string, number>();
  view.nodes().forEach((node, index) => {
    order.set(node.id, index);
    if (node.kind !== KIND.paragraph) return;
    const hi = hierOf(view, node.id);
    if (hi) paragraphs.set(hi, node);
  });
  const point = (position: string) => {
    const parts = position.split(';');
    const offset = Number(parts.pop());
    const paragraph = paragraphs.get(parts.join(';'));
    if (!paragraph || !Number.isInteger(offset)) return null;
    return { id: paragraph.id, offset: ownOffset(paragraph, offset) };
  };
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
