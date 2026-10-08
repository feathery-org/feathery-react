/**
 * The normal form as the core sees it: a tree of plain JSON nodes, each carrying `id` and `kind`,
 * plus a table of hoisted format entries. Everything else on a node is the pack's.
 *
 * This module holds the format-blind tree mechanics every other core module shares: walking by the
 * pack's child lists, indexing by id, canonical JSON, the content hash behind `base`, and the
 * content key the id table re-anchors with.
 */
import { READ_ONLY_NODE_KEYS } from './envelope';

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

/** One node of the normal form. Every key besides `id` and `kind` is pack-defined. */
export interface NfNode {
  id: string;
  kind: string;
  [key: string]: unknown;
}

/** A hoisted format entry: a pack format object, referenced from nodes by format id. */
export type FormatEntry = Record<string, unknown>;

export interface NormalForm {
  root: NfNode;
  formats: Record<string, FormatEntry>;
}

/** How the core finds children without knowing a format: the pack names a node's child lists. */
export interface TreeShape {
  childLists(node: NfNode): readonly string[];
}

export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** A deep copy of JSON data. */
export function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/** JSON with object keys sorted at every depth, so equal content has equal text. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`;
}

/**
 * A 64-bit non-cryptographic hash as 16 hex digits (two independent 32-bit lanes). It guards
 * read-before-write against a user's concurrent edit, not against an adversary.
 */
export function hash64(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return `${hex(h2)}${hex(h1)}`;
}

const READ_ONLY = new Set<string>(READ_ONLY_NODE_KEYS);

/**
 * A node's content without engine bookkeeping: `id`, `base` and the read-only annotations removed
 * at every depth. With `keepPending`, `pending` stays (it is content of the live document).
 */
export function contentOf(
  value: unknown,
  { keepPending = false }: { keepPending?: boolean } = {}
): unknown {
  if (Array.isArray(value))
    return value.map((v) => contentOf(v, { keepPending }));
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'id' || key === 'base') continue;
    if (READ_ONLY.has(key) && !(keepPending && key === 'pending')) continue;
    out[key] = contentOf(child, { keepPending });
  }
  return out;
}

/** Contract section 2.2: the `base` of a node or format entry. Pending changes are content. */
export function baseOf(value: unknown): string {
  return hash64(canonicalJson(contentOf(value, { keepPending: true })));
}

/** The re-anchoring key: content with pending annotations ignored too. */
export function contentKey(value: unknown): string {
  return hash64(canonicalJson(contentOf(value)));
}

export interface Placement {
  node: NfNode;
  parent: NfNode | null;
  /** The parent's list key holding this node; null for the root. */
  key: string | null;
  index: number;
  depth: number;
}

/** Visit every node in document order. Return false from `visit` to skip a node's subtree. */
export function walk(
  root: NfNode,
  shape: TreeShape,
  visit: (placement: Placement) => boolean | void
): void {
  const rec = (placement: Placement) => {
    if (visit(placement) === false) return;
    const { node, depth } = placement;
    for (const key of shape.childLists(node)) {
      const list = node[key];
      if (!Array.isArray(list)) continue;
      list.forEach((child, index) => {
        if (isPlainObject(child))
          rec({
            node: child as NfNode,
            parent: node,
            key,
            index,
            depth: depth + 1
          });
      });
    }
  };
  rec({ node: root, parent: null, key: null, index: 0, depth: 0 });
}

/** id -> placement over a whole tree. */
export function indexTree(
  root: NfNode,
  shape: TreeShape
): Map<string, Placement> {
  const out = new Map<string, Placement>();
  walk(root, shape, (p) => {
    out.set(p.node.id, p);
  });
  return out;
}

/** Ancestor ids of a placement, nearest first. */
export function ancestorsOf(
  id: string,
  index: { get(id: string): Placement | undefined }
): string[] {
  const out: string[] = [];
  let cur = index.get(id)?.parent ?? null;
  while (cur) {
    out.push(cur.id);
    cur = index.get(cur.id)?.parent ?? null;
  }
  return out;
}

/** The child-id sequence of each child list: a node's list membership, as content of the node. */
export function childIdLists(
  node: NfNode,
  shape: TreeShape
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const key of shape.childLists(node)) {
    const list = node[key];
    if (Array.isArray(list))
      out[key] = list.filter(isPlainObject).map((c) => String(c.id));
  }
  return out;
}

/**
 * A node's own content: everything except its child lists (which are reduced to child ids).
 * Two versions of a node with equal own content differ only below their children.
 */
export function ownContentKey(node: NfNode, shape: TreeShape): string {
  const lists = new Set(shape.childLists(node));
  const own: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (lists.has(key) && Array.isArray(value)) {
      own[key] = value.filter(isPlainObject).map((c) => String(c.id));
    } else own[key] = value;
  }
  return hash64(canonicalJson(contentOf(own, { keepPending: true })));
}
