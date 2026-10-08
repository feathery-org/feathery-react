/**
 * `outline` (contract section 3): the id-annotated tree the model plans from.
 *
 * One line per node, the root's children at the top level and at most `depth` levels below them.
 * The first token of a node line is its id and the second its kind; the pack renders the rest. A
 * child is indented deeper than its parent; a pack may print a label line before a child list.
 * A node whose children are cut by the depth says how many are not shown.
 */
import { OutlineResult } from './envelope';
import type { DocumentView, Pack } from './pack';
import { hash64, isPlainObject, NfNode } from './tree';

export const OUTLINE_DEPTH_MIN = 1;
export const OUTLINE_DEPTH_MAX = 6;

const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

export function resolveDepth(pack: Pack, depth?: number): number {
  const d = depth ?? pack.outline.defaultDepth;
  return Math.min(
    OUTLINE_DEPTH_MAX,
    Math.max(OUTLINE_DEPTH_MIN, Math.floor(d))
  );
}

export function renderOutline(
  view: DocumentView,
  pack: Pack,
  depth?: number
): OutlineResult {
  const resolved = resolveDepth(pack, depth);
  const lines: string[] = [];
  const childrenOf = (node: NfNode) =>
    pack.tree.childLists(node).map((key) => ({
      key,
      kids: (Array.isArray(node[key]) ? (node[key] as unknown[]) : []).filter(
        isPlainObject
      ) as NfNode[]
    }));
  const count = (node: NfNode): number =>
    childrenOf(node).reduce(
      (n, { kids }) => n + kids.length + kids.reduce((m, k) => m + count(k), 0),
      0
    );

  const renderChildren = (node: NfNode, level: number, indent: number) => {
    for (const { key, kids } of childrenOf(node)) {
      if (!kids.length) continue;
      const label = pack.outline.listLabel?.(node, key) ?? null;
      const pad = '  '.repeat(indent);
      if (label) lines.push(`${pad}${oneLine(label)}:`);
      for (const kid of kids) render(kid, level, label ? indent + 1 : indent);
    }
  };
  const render = (node: NfNode, level: number, indent: number) => {
    const detail = oneLine(pack.outline.detail(node, view));
    const hidden = level >= resolved ? count(node) : 0;
    lines.push(
      `${'  '.repeat(indent)}${node.id} ${node.kind}${
        detail ? ` ${detail}` : ''
      }${hidden ? ` [+${hidden} below]` : ''}`
    );
    if (level < resolved) renderChildren(node, level + 1, indent + 1);
  };
  renderChildren(view.nf.root, 0, 0);
  const text = lines.join('\n');
  return { ok: true, outlineHash: hash64(text), depth: resolved, lines: text };
}
