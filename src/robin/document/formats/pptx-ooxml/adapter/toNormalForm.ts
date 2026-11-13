import type { Residue } from '../../../pack';
import {
  canonicalJson,
  clone,
  type NfNode,
  type NormalForm
} from '../../../tree';
import {
  child,
  childrenOf,
  parseXml,
  root,
  type ONode,
  type OTree
} from '../../../../../elements/components/PptxEditor/core/opc/xml';
import {
  readNative,
  type InheritedFormat,
  type PendingSuggestion
} from '../native';
import {
  SLOT,
  isShapeNode,
  readShape,
  shapeIdOf,
  type ReadNodes
} from './nodes';

export const DECK_ID = 'deck';

export type Mark = 'insertion' | 'deletion';
export type Pending = Partial<Record<Mark, string>>;

export function spTreeOf(tree: OTree): ONode | undefined {
  const cSld = child(root(tree), 'p:cSld');
  return cSld && child(cSld, 'p:spTree');
}

function readSlide(
  path: string,
  tree: OTree,
  id: string,
  read: ReadNodes,
  inherited?: InheritedFormat
): NfNode {
  const spTree = spTreeOf(tree);
  read.inherited = inherited;
  const shapes = spTree
    ? childrenOf(spTree)
        .filter(isShapeNode)
        .map((node) => readShape(node, `${id}#${shapeIdOf(node)}`, read, true))
    : [];
  read.inherited = undefined;
  const residue = clone(tree);
  const slotted = spTreeOf(residue);
  if (slotted)
    slotted['p:spTree'] = childrenOf(slotted).map((kid) =>
      isShapeNode(kid) ? SLOT : kid
    );
  read.residue[id] = (inherited
    ? { slide: residue, inherited }
    : { slide: residue }) as unknown as ONode;
  return { id, kind: 'slide', path, shapes };
}

function mark(node: NfNode, kind: Mark, by: string): void {
  node.pending = {
    ...((node.pending as Pending | undefined) ?? {}),
    [kind]: by
  };
}

function insertAfter(list: NfNode[], anchor: NfNode | undefined, node: NfNode) {
  list.splice(anchor ? list.indexOf(anchor) + 1 : 0, 0, node);
}

function unmoved(afterOrder: string[], beforeOrder: string[]): Set<string> {
  const common = afterOrder.filter((path) => beforeOrder.includes(path));
  const rank = common.map((path) => beforeOrder.indexOf(path));
  const longest: number[][] = rank.map(() => []);
  rank.forEach((value, i) => {
    let best: number[] = [];
    for (let j = 0; j < i; j++)
      if (rank[j] < value && longest[j].length > best.length) best = longest[j];
    longest[i] = [...best, i];
  });
  const kept = longest.reduce((a, b) => (b.length > a.length ? b : a), []);
  return new Set(kept.map((i) => common[i]));
}

interface SlideState {
  path: string;
  node: NfNode;
  shapes: NfNode[];
}

/** Each pending suggestion as tracked changes: what it changed marked inserted, what it replaced kept beside it marked deleted */
function markPending(
  slides: NfNode[],
  pending: PendingSuggestion[],
  read: ReadNodes
): void {
  let state: SlideState[] = slides.map((slide) => ({
    path: String(slide.path),
    node: slide,
    shapes: [...(slide.shapes as NfNode[])]
  }));
  for (let i = pending.length - 1; i >= 0; i--) {
    const { by, beforeSlides, beforeOrder } = pending[i];
    const earlier = new Map<string, SlideState>();
    const stays = beforeOrder
      ? unmoved(
          state.map((slide) => slide.path),
          beforeOrder
        )
      : null;

    for (const [path, xml] of Object.entries(beforeSlides)) {
      const tree = parseXml(xml);
      const after = state.find((slide) => slide.path === path);
      if (!after || (stays && !stays.has(path))) {
        if (after) mark(after.node, 'insertion', by);
        const twin = readSlide(path, tree, `${path}~${i}`, read);
        mark(twin, 'deletion', by);
        earlier.set(path, {
          path,
          node: twin,
          shapes: [...(twin.shapes as NfNode[])]
        });
        continue;
      }
      const list = after.node.shapes as NfNode[];
      const shapesBefore: NfNode[] = [];
      const matched = new Set<NfNode>();
      for (const node of childrenOf(spTreeOf(tree) ?? {}).filter(isShapeNode)) {
        const shapeId = shapeIdOf(node);
        const current = after.shapes.find((shape) => shape.shapeId === shapeId);
        if (current) matched.add(current);
        if (
          current &&
          canonicalJson(read.sources.get(current)) === canonicalJson(node)
        ) {
          shapesBefore.push(current);
          continue;
        }
        const twin = readShape(node, `${after.node.id}#${shapeId}~${i}`, read);
        mark(twin, 'deletion', by);
        if (current) {
          mark(current, 'insertion', by);
          list.splice(list.indexOf(current), 0, twin);
        } else insertAfter(list, shapesBefore[shapesBefore.length - 1], twin);
        shapesBefore.push(twin);
      }
      for (const shape of after.shapes)
        if (!matched.has(shape)) mark(shape, 'insertion', by);
      earlier.set(path, { path, node: after.node, shapes: shapesBefore });
    }

    if (!beforeOrder) {
      state = state.map((slide) => earlier.get(slide.path) ?? slide);
      continue;
    }
    for (const slide of state)
      if (!beforeOrder.includes(slide.path)) mark(slide.node, 'insertion', by);
    const next = beforeOrder.map(
      (path) =>
        earlier.get(path) ??
        (state.find((slide) => slide.path === path) as SlideState)
    );
    next.forEach((slide, at) => {
      if (slides.includes(slide.node)) return;
      insertAfter(slides, next[at - 1]?.node, slide.node);
    });
    state = next;
  }
}

export function toNormalForm(native: string): {
  nf: NormalForm;
  residue: Residue;
} {
  const deck = readNative(native);
  const read: ReadNodes = { residue: {}, sources: new Map() };
  const slides = deck.slides.map(({ path, xml, inherited }) =>
    readSlide(path, parseXml(xml), path, read, inherited)
  );
  markPending(slides, deck.pending, read);
  const residue: Residue = {
    ...read.residue,
    [DECK_ID]: { pending: deck.pending }
  };
  return {
    nf: { root: { id: DECK_ID, kind: 'deck', slides }, formats: {} },
    residue
  };
}
