/**
 * Engine-minted ids (contract section 2.1, architecture 4.2).
 *
 * Ids are per-session tokens: `n<k>` for nodes, `f<k>` for format entries, `root` for the root.
 * They are never authored by the model and never stored in the document. After every native change
 * the live document is read back through the pack adapter, which knows nothing of these ids, and
 * the id table re-anchors: each node of the fresh tree takes the id of the node it continues, found
 * in order by
 *
 *   1. the identity the pack tracks on a node (a bound name, say), within the same parent;
 *   2. equal content, in document order (sequence);
 *   3. the same kind in the same gap between nodes already matched (shape);
 *
 * and anything left is new and gets a fresh id. Format entries keep their id while their content is
 * unchanged. Residue moves with the ids.
 */
import { isTempId, isNodeId, ROOT_ID } from './envelope';
import type { PackTree, Residue } from './pack';
import {
  FormatEntry,
  NfNode,
  NormalForm,
  canonicalJson,
  clone,
  contentKey,
  isPlainObject,
  walk
} from './tree';

export class IdTable {
  private nextNode = 1;

  private nextFormat = 1;

  mintNode(): string {
    const id = `n${this.nextNode}`;
    this.nextNode += 1;
    return id;
  }

  mintFormat(): string {
    const id = `f${this.nextFormat}`;
    this.nextFormat += 1;
    return id;
  }

  /**
   * Give a tree fresh from the adapter engine ids, continuing the ids of `previous` trees (the
   * intended document of a commit first, then the document before it). The input is not modified.
   */
  adopt(
    fresh: { nf: NormalForm; residue: Residue },
    shape: PackTree,
    formatRefKeys: readonly string[],
    previous: NormalForm[] = []
  ): { nf: NormalForm; residue: Residue } {
    const nf = clone(fresh.nf);
    const formats = this.adoptFormats(nf, formatRefKeys, previous);
    const renamed = new Map<string, string>();
    const used = new Set<string>([ROOT_ID]);
    renamed.set(nf.root.id, ROOT_ID);
    const previousRoots = previous.map((p) => p.root);
    this.alignChildren(nf.root, previousRoots, shape, used, renamed);
    walk(nf.root, shape, ({ node }) => {
      node.id = renamed.get(node.id) ?? node.id;
    });
    const residue: Residue = {};
    for (const [key, value] of Object.entries(fresh.residue))
      residue[renamed.get(key) ?? key] = value;
    return { nf: { root: nf.root, formats }, residue };
  }

  private adoptFormats(
    nf: NormalForm,
    formatRefKeys: readonly string[],
    previous: NormalForm[]
  ): Record<string, FormatEntry> {
    const known = new Map<string, string>();
    for (const p of previous)
      for (const [id, entry] of Object.entries(p.formats)) {
        const key = canonicalJson(entry);
        if (!known.has(key)) known.set(key, id);
      }
    const rename = new Map<string, string>();
    const out: Record<string, FormatEntry> = {};
    for (const [key, entry] of Object.entries(nf.formats)) {
      const content = canonicalJson(entry);
      let id = known.get(content);
      if (!id || id in out) {
        id = this.mintFormat();
        known.set(content, id);
      }
      rename.set(key, id);
      out[id] = entry;
    }
    renameFormatRefs(nf.root, formatRefKeys, rename);
    return out;
  }

  private alignChildren(
    node: NfNode,
    previous: NfNode[],
    shape: PackTree,
    used: Set<string>,
    renamed: Map<string, string>
  ): void {
    for (const key of shape.childLists(node)) {
      const list = node[key];
      if (!Array.isArray(list)) continue;
      const kids = list.filter(isPlainObject) as NfNode[];
      const candidates: NfNode[] = [];
      const seen = new Set<string>();
      for (const p of previous) {
        const plist = p[key];
        if (!Array.isArray(plist)) continue;
        for (const c of plist as NfNode[])
          if (isPlainObject(c) && !seen.has(c.id)) {
            seen.add(c.id);
            candidates.push(c);
          }
      }
      const match = alignList(kids, candidates, shape, used);
      kids.forEach((kid, i) => {
        const prev = match[i];
        const id = prev ? prev.id : this.mintNode();
        used.add(id);
        renamed.set(kid.id, id);
        const continued = prev
          ? previous
              .map((p) => findChild(p, shape, prev.id))
              .filter((c): c is NfNode => !!c)
          : [];
        this.alignChildren(kid, continued, shape, used, renamed);
      });
    }
  }
}

function findChild(
  parent: NfNode,
  shape: PackTree,
  id: string
): NfNode | undefined {
  for (const key of shape.childLists(parent)) {
    const list = parent[key];
    if (!Array.isArray(list)) continue;
    const hit = (list as NfNode[]).find((c) => isPlainObject(c) && c.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * For each fresh child, the candidate it continues or undefined. Candidates whose ids are already
 * used elsewhere are skipped, so an id is never given twice.
 */
function alignList(
  kids: NfNode[],
  candidates: NfNode[],
  shape: PackTree,
  used: Set<string>
): Array<NfNode | undefined> {
  const out: Array<NfNode | undefined> = kids.map(() => undefined);
  const taken = new Set<number>();
  const available = (j: number) => !taken.has(j) && !used.has(candidates[j].id);
  const take = (i: number, j: number) => {
    out[i] = candidates[j];
    taken.add(j);
  };

  // 1. pack-tracked identity
  if (shape.identity) {
    const byIdentity = new Map<string, number[]>();
    candidates.forEach((c, j) => {
      const identity = shape.identity?.(c);
      if (identity)
        byIdentity.set(identity, [...(byIdentity.get(identity) ?? []), j]);
    });
    kids.forEach((kid, i) => {
      const identity = shape.identity?.(kid);
      const j = identity
        ? (byIdentity.get(identity) ?? []).find(available)
        : undefined;
      if (j !== undefined) take(i, j);
    });
  }

  // 2. equal content, in sequence: the next unused equal candidate after the last match
  const keys = candidates.map((c) => contentKey(c));
  let cursor = -1;
  kids.forEach((kid, i) => {
    if (out[i]) {
      cursor = candidates.indexOf(out[i] as NfNode);
      return;
    }
    const key = contentKey(kid);
    let j = keys.findIndex(
      (k, idx) => idx > cursor && k === key && available(idx)
    );
    if (j < 0) j = keys.findIndex((k, idx) => k === key && available(idx));
    if (j >= 0) {
      take(i, j);
      cursor = j;
    }
  });

  // 3. same kind inside the gap between neighbouring matches
  kids.forEach((kid, i) => {
    if (out[i]) return;
    let lo = -1;
    for (let k = i - 1; k >= 0; k -= 1)
      if (out[k]) {
        lo = candidates.indexOf(out[k] as NfNode);
        break;
      }
    let hi = candidates.length;
    for (let k = i + 1; k < kids.length; k += 1)
      if (out[k]) {
        hi = candidates.indexOf(out[k] as NfNode);
        break;
      }
    for (let j = lo + 1; j < hi; j += 1)
      if (available(j) && candidates[j].kind === kid.kind) {
        take(i, j);
        break;
      }
  });
  return out;
}

/** Rewrite format references (string values under the pack's reference keys) by `rename`. */
export function renameFormatRefs(
  value: unknown,
  formatRefKeys: readonly string[],
  rename: Map<string, string>
): void {
  if (Array.isArray(value)) {
    value.forEach((v) => renameFormatRefs(v, formatRefKeys, rename));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (
      formatRefKeys.includes(key) &&
      typeof child === 'string' &&
      rename.has(child)
    )
      value[key] = rename.get(child);
    else renameFormatRefs(child, formatRefKeys, rename);
  }
}

/** Every format id referenced anywhere in a value. */
export function formatRefsIn(
  value: unknown,
  formatRefKeys: readonly string[],
  out: Set<string> = new Set()
): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((v) => formatRefsIn(v, formatRefKeys, out));
    return out;
  }
  if (!isPlainObject(value)) return out;
  for (const [key, child] of Object.entries(value)) {
    if (formatRefKeys.includes(key) && typeof child === 'string')
      out.add(child);
    else formatRefsIn(child, formatRefKeys, out);
  }
  return out;
}

export interface MintResult {
  /** Every temporary id to the engine id it was given (contract 6.5 `mapping`). */
  mapping: Record<string, string>;
  /** Ids minted for new nodes, temporary or id-less. */
  created: string[];
  /** Copies of existing nodes: the new id to the id it was copied from. */
  copies: Record<string, string>;
}

/**
 * Give every node of a written working tree an engine id: temporary ids and id-less nodes get
 * fresh ids; an engine id appearing more than once is one node kept and the rest copies.
 *
 * Which occurrence is kept: everything inside a copy is a copy; among the rest, an occurrence the
 * write left in place (not part of any written node) keeps the id, then one under the node's
 * original parent, then the first in document order. A copy gets a fresh id and is reported, so
 * its residue can follow. Mutates the tree.
 */
export function mintWritten(
  root: NfNode,
  shape: PackTree,
  table: IdTable,
  originalParent: (id: string) => string | null | undefined,
  written: (node: NfNode) => boolean = () => false
): MintResult {
  interface Occurrence {
    node: NfNode;
    parentId: string | null;
    ancestors: Occurrence[];
  }
  const all: Occurrence[] = [];
  const byId = new Map<string, Occurrence[]>();
  const stack: Occurrence[] = [];
  walk(root, shape, ({ node, depth }) => {
    stack.length = Math.max(0, depth - 1);
    const occ: Occurrence = {
      node,
      parentId: stack.length ? stack[stack.length - 1].node.id : null,
      ancestors: [...stack]
    };
    if (node === root) return;
    all.push(occ);
    if (isNodeId(node.id))
      byId.set(node.id, [...(byId.get(node.id) ?? []), occ]);
    stack[depth - 1] = occ;
  });
  // parentId above is the parent's written id; the root's children have the root as parent
  for (const occ of all) if (!occ.ancestors.length) occ.parentId = root.id;

  const copy = new Map<Occurrence, boolean>();
  const isCopy = (occ: Occurrence): boolean => {
    const known = copy.get(occ);
    if (known !== undefined) return known;
    let result = occ.ancestors.some((a) => isNodeId(a.node.id) && isCopy(a));
    if (!result && isNodeId(occ.node.id)) {
      const list = byId.get(occ.node.id) ?? [occ];
      if (list.length > 1) {
        const free = list.filter(
          (o) => !o.ancestors.some((a) => isNodeId(a.node.id) && isCopy(a))
        );
        const pool = free.length ? free : list;
        const home = originalParent(occ.node.id);
        const untouched = pool.filter(
          (o) => !written(o.node) && !o.ancestors.some((a) => written(a.node))
        );
        const keeper =
          untouched[0] ?? pool.find((o) => o.parentId === home) ?? pool[0];
        result = keeper !== occ;
      }
    }
    copy.set(occ, result);
    return result;
  };
  const decisions = all.map((occ) => isCopy(occ));

  const result: MintResult = { mapping: {}, created: [], copies: {} };
  all.forEach((occ, i) => {
    const { node } = occ;
    if (isTempId(node.id)) {
      const id = table.mintNode();
      result.mapping[node.id] = id;
      result.created.push(id);
      node.id = id;
    } else if (!isNodeId(node.id)) {
      node.id = table.mintNode();
      result.created.push(node.id);
    } else if (decisions[i]) {
      const id = table.mintNode();
      result.copies[id] = node.id;
      result.created.push(id);
      node.id = id;
    }
  });
  return result;
}
