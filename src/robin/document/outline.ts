/**
 * `outline` (contract section 3): the id-annotated tree the model plans from.
 *
 * One line per node: `<id> <kind> [@<shape8>] <pack detail>`. A node with child lists (a
 * container) carries the first 8 hex of its shape, which a write accepts wherever it carries a
 * shape; a base is never shown. A child is indented deeper than its parent; a pack may print a
 * label line before a child list.
 *
 * With no depth, a pack that says what is below block level gets the block level: every node but
 * those, which are left out with what is under them. Otherwise the root's children are the top
 * level and `depth` levels are rendered below them; a node whose children are cut says how many
 * are not shown.
 */
import { OutlineResult } from './envelope';
import type { DocumentView, Pack } from './pack';
import { hash64, isPlainObject, listAt, NfNode, shapeOf } from './tree';

export const OUTLINE_DEPTH_MIN = 1;
export const OUTLINE_DEPTH_MAX = 6;
/** Hex digits of a shape an outline line shows; a write accepts a shape this long as a prefix. */
export const SHAPE_PREFIX = 8;

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
  const below =
    depth === undefined
      ? pack.outline.belowBlocks?.bind(pack.outline)
      : undefined;
  const resolved = below ? OUTLINE_DEPTH_MAX : resolveDepth(pack, depth);
  const lines: string[] = [];
  let deepest = 1;
  const childrenOf = (node: NfNode) =>
    pack.tree.childLists(node).map((key) => ({
      key,
      kids: (
        (listAt(node, key) ?? []).filter(isPlainObject) as NfNode[]
      ).filter((k) => !below?.(k))
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
    deepest = Math.max(deepest, level);
    const detail = oneLine(pack.outline.detail(node, view));
    const shape = pack.tree.childLists(node).length
      ? ` @${shapeOf(node, pack.tree).slice(0, SHAPE_PREFIX)}`
      : '';
    const cut = !below && level >= resolved;
    const hidden = cut ? count(node) : 0;
    lines.push(
      `${'  '.repeat(indent)}${node.id} ${node.kind}${shape}${
        detail ? ` ${detail}` : ''
      }${hidden ? ` [+${hidden} below]` : ''}`
    );
    if (!cut) renderChildren(node, level + 1, indent + 1);
  };
  renderChildren(view.nf.root, 0, 0);
  const text = lines.join('\n');
  return {
    ok: true,
    outlineHash: hash64(text),
    depth: below ? deepest : resolved,
    lines: text
  };
}
