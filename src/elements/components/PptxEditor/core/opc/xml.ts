// Order-preserving XML parse/serialize for OOXML round-trip.
// We parse with preserveOrder so the JSON tree keeps element order, attributes,
// and text whitespace. That parsed tree IS our "_raw" — we mutate nodes in place
// and rebuild, so parts we never touch come back byte-similar.
//
// preserveOrder node shapes (fast-xml-parser v5):
//   element:   { "<tag>": [ ...children... ], ":@": { "@_attr": "val" } }
//   text:      { "#text": "value" }
// A document is an array of such nodes.

import { XMLParser, XMLBuilder } from 'fast-xml-parser';

export type ONode = Record<string, any>;
export type OTree = ONode[];

const ATTR_PREFIX = '@_';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR_PREFIX,
  preserveOrder: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true,
  ignoreDeclaration: true, // we add a canonical <?xml?> ourselves on build
  ignorePiTags: true
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR_PREFIX,
  preserveOrder: true,
  suppressEmptyNode: true,
  format: false,
  processEntities: true
});

// Pretty builder — for human-readable EXPORT only (adds indentation whitespace,
// so never feed its output back through the round trip).
const prettyBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR_PREFIX,
  preserveOrder: true,
  suppressEmptyNode: true,
  format: true,
  indentBy: '  ',
  processEntities: true
});

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

/** Parse XML text into an order-preserving tree. */
export function parseXml(text: string): OTree {
  return parser.parse(text) as OTree;
}

/** Serialize an order-preserving tree back to XML text (adds the standard decl). */
export function buildXml(tree: OTree): string {
  const body = builder.build(tree);
  // preserveOrder drops the <?xml?> declaration; PowerPoint wants one.
  return XML_DECL + body;
}

/** Indented serialization for human-readable export (NOT round-trip safe). */
export function buildXmlPretty(tree: OTree): string {
  return XML_DECL + prettyBuilder.build(tree);
}

// ---- Navigation helpers over the preserveOrder shape ----

/** The element tag name of a node, or null for a text node. */
export function tagOf(node: ONode): string | null {
  for (const k in node) {
    if (k === ':@' || k === '#text') continue;
    return k;
  }
  return null;
}

/** The children array of an element node (empty array if none/text). */
export function childrenOf(node: ONode): OTree {
  const t = tagOf(node);
  return t ? (node[t] as OTree) : [];
}

export function isText(node: ONode): boolean {
  return Object.prototype.hasOwnProperty.call(node, '#text');
}

export function textOf(node: ONode): string {
  return isText(node) ? String(node['#text']) : '';
}

function attrs(node: ONode): Record<string, string> {
  return (node[':@'] as Record<string, string>) || {};
}

export function getAttr(node: ONode, name: string): string | undefined {
  return attrs(node)[ATTR_PREFIX + name];
}

export function setAttr(node: ONode, name: string, value: string): void {
  if (!node[':@']) node[':@'] = {};
  node[':@'][ATTR_PREFIX + name] = value;
}

export function removeAttr(node: ONode, name: string): void {
  if (node[':@']) delete node[':@'][ATTR_PREFIX + name];
}

/** First direct child with the given tag. */
export function child(node: ONode, tag: string): ONode | undefined {
  return childrenOf(node).find((c) => tagOf(c) === tag);
}

/** All direct children with the given tag. */
export function children(node: ONode, tag: string): OTree {
  return childrenOf(node).filter((c) => tagOf(c) === tag);
}

/** First descendant (depth-first) with the given tag. */
export function descendant(node: ONode, tag: string): ONode | undefined {
  for (const c of childrenOf(node)) {
    if (tagOf(c) === tag) return c;
    const deep = descendant(c, tag);
    if (deep) return deep;
  }
  return undefined;
}

/** All descendants (depth-first) with the given tag. */
export function descendants(node: ONode, tag: string, out: OTree = []): OTree {
  for (const c of childrenOf(node)) {
    if (tagOf(c) === tag) out.push(c);
    descendants(c, tag, out);
  }
  return out;
}

/** Build an empty element node with optional attributes. */
export function el(
  tag: string,
  attributes?: Record<string, string>,
  kids: OTree = []
): ONode {
  const node: ONode = { [tag]: kids };
  if (attributes) {
    node[':@'] = {};
    for (const [k, v] of Object.entries(attributes))
      node[':@'][ATTR_PREFIX + k] = v;
  }
  return node;
}

/** Build a text node. */
export function text(value: string): ONode {
  return { '#text': value };
}

/** Find the top-level element node in a parsed document (skips <?xml?>). */
export function root(tree: OTree): ONode {
  return (
    tree.find((n) => tagOf(n) && !tagOf(n)!.startsWith('?')) ??
    tree[tree.length - 1]
  );
}
