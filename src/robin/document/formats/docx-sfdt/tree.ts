/**
 * The tree shape of the normal form: which lists hold child nodes, what kind a written node is,
 * and what may hold what.
 */
import type { PackTree } from '../../pack';
import type { NfNode } from '../../tree';
import {
  BLOCK_KINDS,
  HEADER_FOOTER,
  INLINE_KINDS,
  KIND,
  TEXT_FRAME,
  toNfKey
} from './adapter/keys';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (n: Obj, key: string) => Array.isArray(n[key]);

function childLists(node: NfNode): string[] {
  switch (node.kind) {
    case KIND.document:
      return has(node, 'sections') ? ['sections'] : [];
    case KIND.section: {
      const out = has(node, 'blocks') ? ['blocks'] : [];
      const hf = node[HEADER_FOOTER];
      if (isObject(hf))
        for (const story of Object.keys(hf))
          if (isObject(hf[story]) && has(hf[story] as Obj, 'blocks'))
            out.push(`${HEADER_FOOTER}/${story}/blocks`);
      return out;
    }
    case KIND.table:
      return has(node, 'rows') ? ['rows'] : [];
    case KIND.row:
      return has(node, 'cells') ? ['cells'] : [];
    case KIND.shape: {
      const frame = node[toNfKey(TEXT_FRAME)];
      return isObject(frame) && has(frame, 'blocks')
        ? [`${TEXT_FRAME}/blocks`]
        : [];
    }
    default:
      return ['blocks', 'inlines'].filter((k) => has(node, k));
  }
}

const blockLists = (key: string) => key === 'blocks' || key.endsWith('/blocks');

/** The kind of a written node with no `kind`, from its shape and the list it is written into. */
function inferKind(
  node: Obj,
  parentKind: string,
  listKey: string
): string | null {
  if (listKey === 'sections') return KIND.section;
  if (listKey === 'rows') return KIND.row;
  if (listKey === 'cells') return KIND.cell;
  if (blockLists(listKey)) {
    if (has(node, 'rows')) return KIND.table;
    if (isObject(node.contentControlProperties) || isObject(node.binding))
      return has(node, 'blocks') ? KIND.control : null;
    if (has(node, 'inlines') || 'style' in node || 'markStyle' in node)
      return KIND.paragraph;
    return null;
  }
  if (listKey === 'inlines') {
    if (
      (isObject(node.contentControlProperties) || 'binding' in node) &&
      has(node, 'inlines')
    )
      return KIND.control;
    if (typeof node.text === 'string') return KIND.run;
    if (typeof node.bookmarkType === 'number') return KIND.bookmark;
    if (typeof node.fieldType === 'number') return KIND.field;
    if (node.imageString !== undefined) return KIND.image;
    if (isObject(node.textFrame)) return KIND.shape;
    return null;
  }
  return parentKind ? null : null;
}

function accepts(parentKind: string, listKey: string, kind: string): boolean {
  if (listKey === 'sections')
    return parentKind === KIND.document && kind === KIND.section;
  if (listKey === 'rows') return parentKind === KIND.table && kind === KIND.row;
  if (listKey === 'cells') return parentKind === KIND.row && kind === KIND.cell;
  if (blockLists(listKey)) return BLOCK_KINDS.has(kind);
  if (listKey === 'inlines') return INLINE_KINDS.has(kind);
  return false;
}

/** A bound control's binding survives edits; the id table pins on it first. */
function identity(node: NfNode): string | null {
  const b = node.binding;
  if (!isObject(b)) return null;
  if (b.table !== undefined) return `table:${String(b.table)}`;
  return b.name !== undefined
    ? `binding:${String(b.name)}:${String(b.row ?? '')}`
    : null;
}

export const docxTree: PackTree = { childLists, inferKind, accepts, identity };
