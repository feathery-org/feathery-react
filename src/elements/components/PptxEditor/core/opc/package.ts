// OPCPackage — a view over the unzipped parts.
// Parses XML parts on demand (cached), resolves relationships, and knows how to
// list slides from presentation.xml. Untouched parts stay as their original text/bytes.

import { unzipPptx, zipPptx, type ZipParts } from './zip';
import {
  parseXml,
  buildXml,
  root,
  child,
  children,
  childrenOf,
  getAttr,
  el,
  tagOf,
  type OTree,
  type ONode
} from './xml';

export interface RelEntry {
  id: string;
  type: string;
  target: string; // resolved absolute part path (or external)
  external: boolean;
}

/** Resolve a relationship Target against the source part's directory. */
function resolvePath(sourcePart: string, target: string): string {
  // OPC relationship targets beginning with `/` are package-root-relative.
  // Resolving them against the source directory produces invalid paths such as
  // `ppt/slides/ppt/charts/chart1.xml`.
  if (target.startsWith('/')) return target.replace(/^\/+/, '');
  const baseDir = sourcePart.split('/').slice(0, -1);
  const segments = target.split('/');
  const stack = [...baseDir];
  for (const seg of segments) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') stack.pop();
    else stack.push(seg);
  }
  return stack.join('/');
}

function relsPathFor(part: string): string {
  const idx = part.lastIndexOf('/');
  const dir = part.slice(0, idx);
  const name = part.slice(idx + 1);
  return `${dir}/_rels/${name}.rels`;
}

export class OPCPackage {
  private parts: ZipParts;
  private trees = new Map<string, OTree>(); // parsed & possibly-mutated XML trees
  private dirty = new Set<string>();
  private mutationSeqs = new Map<string, number>();

  constructor(parts: ZipParts) {
    this.parts = parts;
  }

  static open(bytes: Uint8Array): OPCPackage {
    return new OPCPackage(unzipPptx(bytes));
  }

  hasPart(path: string): boolean {
    return this.parts.text.has(path) || this.parts.binary.has(path);
  }

  binary(path: string): Uint8Array | undefined {
    return this.parts.binary.get(path);
  }

  /** Parsed (order-preserving) tree for an XML part; cached and mutable in place. */
  tree(path: string): OTree {
    let t = this.trees.get(path);
    if (!t) {
      const txt = this.parts.text.get(path);
      if (txt === undefined) throw new Error(`No XML part: ${path}`);
      t = parseXml(txt);
      this.trees.set(path, t);
    }
    return t;
  }

  /** Mark a parsed tree as edited so export re-serializes it. */
  markDirty(path: string): void {
    this.dirty.add(path);
    this.mutationSeqs.set(path, (this.mutationSeqs.get(path) ?? 0) + 1);
  }

  /**
   * Monotonic per-part edit counter (bumped by markDirty). History snapshots
   * use it to reuse untouched slides' clones instead of re-cloning the deck.
   */
  mutationSeq(path: string): number {
    return this.mutationSeqs.get(path) ?? 0;
  }

  /** Relationships declared by a part (from its sibling _rels file). */
  rels(sourcePart: string): RelEntry[] {
    const relsPath = relsPathFor(sourcePart);
    if (!this.parts.text.has(relsPath)) return [];
    const r = root(this.tree(relsPath));
    return children(r, 'Relationship').map((rel) => {
      const id = getAttr(rel, 'Id') || '';
      const type = getAttr(rel, 'Type') || '';
      const target = getAttr(rel, 'Target') || '';
      const mode = getAttr(rel, 'TargetMode');
      const external = mode === 'External';
      return {
        id,
        type,
        target: external ? target : resolvePath(sourcePart, target),
        external
      };
    });
  }

  relTarget(sourcePart: string, id: string): string | undefined {
    return this.rels(sourcePart).find((r) => r.id === id)?.target;
  }

  /** First related part whose relationship type ends with the given suffix. */
  relTargetByType(sourcePart: string, typeSuffix: string): string | undefined {
    return this.rels(sourcePart).find((r) => r.type.endsWith(typeSuffix))
      ?.target;
  }

  layoutFor(slidePath: string): string | undefined {
    return this.relTargetByType(slidePath, 'slideLayout');
  }

  masterFor(layoutPath: string): string | undefined {
    return this.relTargetByType(layoutPath, 'slideMaster');
  }

  /** Slide size in EMU from presentation.xml. */
  slideSize(): { cx: number; cy: number } {
    const pres = root(this.tree('ppt/presentation.xml'));
    const sz = child(pres, 'p:sldSz');
    return {
      cx: Number(sz && getAttr(sz, 'cx')) || 9144000,
      cy: Number(sz && getAttr(sz, 'cy')) || 6858000
    };
  }

  /** Ordered slide part paths from presentation.xml's sldIdLst. */
  slidePaths(): string[] {
    const pres = root(this.tree('ppt/presentation.xml'));
    const lst = child(pres, 'p:sldIdLst');
    if (!lst) return [];
    const out: string[] = [];
    for (const sld of children(lst, 'p:sldId')) {
      const rid = getAttr(sld, 'r:id');
      if (!rid) continue;
      const target = this.relTarget('ppt/presentation.xml', rid);
      if (target) out.push(target);
    }
    return out;
  }

  // ---- mutation helpers (used when inserting images) ----

  /** Add or replace a binary part (e.g. an image). */
  setBinaryPart(path: string, bytes: Uint8Array): void {
    if (!this.parts.binary.has(path) && !this.parts.text.has(path))
      this.parts.order.push(path);
    this.parts.binary.set(path, bytes);
  }

  /** A free media part path for the given extension (ppt/media/imageN.ext). */
  nextMediaPath(ext: string): string {
    let max = 0;
    for (const p of [...this.parts.binary.keys(), ...this.parts.text.keys()]) {
      const m = /ppt\/media\/image(\d+)\./.exec(p);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `ppt/media/image${max + 1}.${ext}`;
  }

  /** Append a relationship to a part's rels file (creating the rels part if needed); returns the new rId. */
  addRelationship(
    sourcePart: string,
    type: string,
    target: string,
    external = false
  ): string {
    const relsPath = relsPathFor(sourcePart);
    let relsRoot: ONode;
    if (this.parts.text.has(relsPath)) {
      relsRoot = root(this.tree(relsPath));
    } else {
      relsRoot = el('Relationships', {
        xmlns: 'http://schemas.openxmlformats.org/package/2006/relationships'
      });
      this.trees.set(relsPath, [relsRoot]);
      this.parts.text.set(relsPath, '');
      this.parts.order.push(relsPath);
    }
    let max = 0;
    for (const rel of children(relsRoot, 'Relationship')) {
      const m = /rId(\d+)/.exec(getAttr(rel, 'Id') || '');
      if (m) max = Math.max(max, Number(m[1]));
    }
    const id = `rId${max + 1}`;
    const attrs: Record<string, string> = {
      Id: id,
      Type: type,
      Target: target
    };
    if (external) attrs.TargetMode = 'External';
    childrenOf(relsRoot).push(el('Relationship', attrs));
    this.markDirty(relsPath);
    return id;
  }

  /** The rels part path for a given part (…/_rels/<name>.rels). */
  relsPath(part: string): string {
    return relsPathFor(part);
  }

  /** All XML (text) part paths currently in the package. */
  xmlPartPaths(): string[] {
    return [...this.parts.text.keys()];
  }

  /**
   * Add a new XML part, or replace an existing part's contents in place.
   * In-place replacement keeps any live reference (e.g. a Slide's `raw`)
   * valid. Marks the part dirty so export re-serializes it.
   */
  setXmlPart(path: string, tree: OTree): void {
    const existing = this.trees.get(path);
    if (existing) existing.splice(0, existing.length, ...tree);
    else this.trees.set(path, tree);
    if (!this.parts.text.has(path)) this.parts.order.push(path);
    this.parts.text.set(path, '');
    this.markDirty(path);
  }

  /** Remove a part entirely (text/binary/tree/order/dirty). */
  removePart(path: string): void {
    this.parts.text.delete(path);
    this.parts.binary.delete(path);
    this.trees.delete(path);
    this.dirty.delete(path);
    const i = this.parts.order.indexOf(path);
    if (i >= 0) this.parts.order.splice(i, 1);
    this.mutationSeqs.set(path, (this.mutationSeqs.get(path) ?? 0) + 1);
  }

  /** A free slide part path (ppt/slides/slideN.xml). */
  nextSlidePath(): string {
    let max = 0;
    for (const p of this.parts.text.keys()) {
      const m = /ppt\/slides\/slide(\d+)\.xml$/.exec(p);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `ppt/slides/slide${max + 1}.xml`;
  }

  /** Remove a relationship (by rId) from a part's rels file. */
  removeRelationship(sourcePart: string, id: string): void {
    const relsPath = relsPathFor(sourcePart);
    if (!this.parts.text.has(relsPath)) return;
    const relsRoot = root(this.tree(relsPath));
    const kids = childrenOf(relsRoot);
    const keep = kids.filter(
      (rel) => !(tagOf(rel) === 'Relationship' && getAttr(rel, 'Id') === id)
    );
    kids.splice(0, kids.length, ...keep);
    this.markDirty(relsPath);
  }

  /** Ensure [Content_Types].xml has an Override entry for a full part name. */
  ensureOverride(partName: string, contentType: string): void {
    const path = '[Content_Types].xml';
    const types = root(this.tree(path));
    const has = children(types, 'Override').some(
      (o) => getAttr(o, 'PartName') === partName
    );
    if (!has) {
      childrenOf(types).push(
        el('Override', { PartName: partName, ContentType: contentType })
      );
      this.markDirty(path);
    }
  }

  /** Remove the Override entry for a full part name, if present. */
  removeOverride(partName: string): void {
    const path = '[Content_Types].xml';
    const types = root(this.tree(path));
    const kids = childrenOf(types);
    const keep = kids.filter(
      (o) => !(tagOf(o) === 'Override' && getAttr(o, 'PartName') === partName)
    );
    if (keep.length !== kids.length) {
      kids.splice(0, kids.length, ...keep);
      this.markDirty(path);
    }
  }

  /** Ensure [Content_Types].xml has a Default entry for a file extension. */
  ensureDefaultContentType(ext: string, contentType: string): void {
    const path = '[Content_Types].xml';
    const types = root(this.tree(path));
    const has = children(types, 'Default').some(
      (d) => (getAttr(d, 'Extension') || '').toLowerCase() === ext.toLowerCase()
    );
    if (!has) {
      childrenOf(types).unshift(
        el('Default', { Extension: ext, ContentType: contentType })
      );
      this.markDirty(path);
    }
  }

  /** Rebuild the archive, re-serializing only the trees that were edited. */
  toBytes(): Uint8Array {
    for (const path of this.dirty) {
      const t = this.trees.get(path);
      if (t) this.parts.text.set(path, buildXml(t));
    }
    return zipPptx(this.parts);
  }
}

export type { ONode, OTree };
