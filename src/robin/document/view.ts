/**
 * The read side of one version of the normal form: lookups by id, the pack's annotations
 * (computed once per version and only when asked for), nodes as the engine emits them, and the
 * `find` query matcher shared by the `find` verb and bulk `set` targets.
 */
import type { EmittedNode, FindHit, FindInput } from './envelope';
import { FIND_SNIPPET_MAX, FIND_WITHIN_MAX, ROOT_ID } from './envelope';
import { formatRefsIn } from './ids';
import type { Annotation, DocumentView, Pack } from './pack';
import {
  NfNode,
  NormalForm,
  Placement,
  ancestorsOf,
  baseOf,
  clone,
  indexTree,
  isPlainObject
} from './tree';

export function makeView(nf: NormalForm, pack: Pack): DocumentView {
  const index = indexTree(nf.root, pack.tree);
  let annotations: Map<string, Annotation> | null = null;
  let order: NfNode[] | null = null;
  const view: DocumentView = {
    nf,
    get: (id: string) => index.get(id)?.node,
    placement: (id: string): Placement | undefined => index.get(id),
    annotation: (id: string) => {
      if (!annotations) annotations = pack.annotate(view);
      return annotations.get(id);
    },
    nodes: () => {
      if (!order) order = [...index.values()].map((p) => p.node);
      return order;
    }
  };
  return view;
}

/**
 * A node as `read` returns it (contract 2.3): `id`, `base` and `kind` first on it and every nested
 * node, `usedBy` and `derived` where the pack derives them, `properties` when asked for. With
 * `stubChildren`, child lists hold only `{id, base, kind}` (how the root is read).
 */
export function emitNode(
  view: DocumentView,
  pack: Pack,
  node: NfNode,
  {
    properties = false,
    stubChildren = false
  }: { properties?: boolean; stubChildren?: boolean } = {}
): EmittedNode {
  const emit = (n: NfNode, stub: boolean): EmittedNode => {
    const lists = new Set(pack.tree.childLists(n));
    const out: Record<string, unknown> = {
      id: n.id,
      base: baseOf(n),
      kind: n.kind
    };
    if (stub) return out as EmittedNode;
    for (const [key, value] of Object.entries(n)) {
      if (key === 'id' || key === 'kind') continue;
      if (lists.has(key) && Array.isArray(value)) {
        out[key] = value.map((child) =>
          isPlainObject(child)
            ? emit(child as NfNode, stubChildren)
            : clone(child)
        );
      } else out[key] = clone(value);
    }
    const a = view.annotation(n.id);
    if (a?.usedBy?.length) out.usedBy = [...a.usedBy];
    if (a?.derived) out.derived = clone(a.derived);
    if (properties && pack.properties.schema(n.kind))
      out.properties = pack.properties.effective(n, view);
    return out as EmittedNode;
  };
  return emit(node, false);
}

/** Format ids referenced by a node's own content and every node below it. */
export function referencedFormats(pack: Pack, node: unknown): Set<string> {
  return formatRefsIn(node, pack.formatRefKeys);
}

/** A node's own fields without its child lists. */
function ownFields(pack: Pack, node: NfNode): Record<string, unknown> {
  const lists = new Set(pack.tree.childLists(node));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) if (!lists.has(k)) out[k] = v;
  return out;
}

const clip = (text: string, start: number, end: number): string => {
  if (text.length <= FIND_SNIPPET_MAX) return text;
  const room = FIND_SNIPPET_MAX - (end - start);
  const from = Math.max(
    0,
    Math.min(start - Math.floor(room / 2), text.length - FIND_SNIPPET_MAX)
  );
  return text.slice(from, from + FIND_SNIPPET_MAX);
};

/** Every node matching a `find` query, in document order, with its hit as `find` reports it. */
export function matchQuery(
  view: DocumentView,
  pack: Pack,
  query: Pick<FindInput, 'text' | 'kind' | 'feature' | 'format' | 'within'>
): FindHit[] {
  const needle = query.text?.toLowerCase();
  const hits: FindHit[] = [];
  for (const node of view.nodes()) {
    if (node.id === ROOT_ID) continue;
    if (query.kind !== undefined && node.kind !== query.kind) continue;
    const ancestors = ancestorsOf(node.id, { get: view.placement }).filter(
      (a) => a !== ROOT_ID
    );
    if (query.within !== undefined && !ancestors.includes(query.within))
      continue;
    if (
      query.feature !== undefined &&
      !pack
        .features(node, view)
        .some(
          (f) =>
            f.name === query.feature?.name &&
            (query.feature.value === undefined ||
              f.value === query.feature.value)
        )
    )
      continue;
    if (
      query.format !== undefined &&
      !referencedFormats(pack, ownFields(pack, node)).has(query.format)
    )
      continue;
    const text = pack.text(node);
    let span: { start: number; end: number } | undefined;
    if (needle !== undefined) {
      const at = text === null ? -1 : text.toLowerCase().indexOf(needle);
      if (at < 0) continue;
      span = { start: at, end: at + needle.length };
    }
    const own = text ?? '';
    hits.push({
      id: node.id,
      kind: node.kind,
      within: ancestors.slice(0, FIND_WITHIN_MAX),
      snippet: clip(own, span?.start ?? 0, span?.end ?? 0),
      ...(span ? { span } : {})
    });
  }
  return hits;
}
