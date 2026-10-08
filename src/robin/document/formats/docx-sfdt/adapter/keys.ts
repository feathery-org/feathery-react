/**
 * What the normal form shows, hides and renames, and the node kinds it is built from.
 *
 * Ported from the lab's measured normal form (`lib/nf.mjs`), which was itself ported from the
 * compact projection in `sfdt-study/projections.py`; the hoist set and the stop-at-the-first-
 * format-key rule are measured choices, not reinventions.
 */

/**
 * Format objects hoisted into the format table. The walk stops at the first matching key: a
 * `listFormat` nested inside a `paragraphFormat` travels with it, so one paragraph format is one
 * entry.
 */
export const HOIST = new Set([
  'characterFormat',
  'paragraphFormat',
  'cellFormat',
  'rowFormat',
  'tableFormat',
  'sectionFormat',
  'listFormat'
]);

/** Formats that describe the node itself; a node that has one shows its character format as `markStyle`. */
export const STRUCTURAL_FORMATS = new Set([
  'paragraphFormat',
  'sectionFormat',
  'tableFormat',
  'rowFormat',
  'cellFormat'
]);

/** The normal-form key each format key is published under on a node. */
export const NF_FORMAT_KEY: Record<string, string> = {
  paragraphFormat: 'style',
  sectionFormat: 'style',
  tableFormat: 'style',
  rowFormat: 'style',
  cellFormat: 'style',
  characterFormat: 'style',
  listFormat: 'listStyle'
};

/** Every key whose string value references a format entry. */
export const FORMAT_REF_KEYS = ['style', 'markStyle', 'listStyle', ...HOIST];

/** Sub-keys taken out of a format object before it is hoisted; engine-owned. */
export const HIDDEN_IN_FORMAT: Record<string, string[]> = {
  cellFormat: ['cellWidth'],
  characterFormat: ['revisionIds'],
  rowFormat: ['revisionIds']
};

/** Sub-keys taken out of a plain object on a node; engine-owned. */
export const HIDDEN_IN_OBJECT: Record<string, string[]> = {
  contentControlProperties: ['color']
};

/** Node-level keys derived by the engine, by node kind. */
export const HIDDEN_NODE_KEYS: Record<string, string[]> = {
  cell: ['columnIndex'],
  table: ['grid', 'columnCount']
};

/** Root keys the model never sees: the dialect flag, image payloads, the revision table. */
export const HIDDEN_ROOT_KEYS = ['optimizeSfdt', 'images', 'revisions'];

/**
 * Native keys that collide with the keys the engine owns on a node (contract 2.3) are shown
 * renamed and restored on the way back.
 */
const ENGINE_KEYS = [
  'id',
  'base',
  'kind',
  'pending',
  'usedBy',
  'derived',
  'properties',
  'style',
  'markStyle',
  'listStyle',
  'binding'
];
const RENAMED = new Map(
  ENGINE_KEYS.map((k) => [k, `native${k[0].toUpperCase()}${k.slice(1)}`])
);
const RESTORED = new Map([...RENAMED].map(([a, b]) => [b, a]));
export const toNfKey = (key: string): string => RENAMED.get(key) ?? key;
export const toNativeKey = (key: string): string => RESTORED.get(key) ?? key;

export const HEADER_FOOTER = 'headersFooters';
export const TEXT_FRAME = 'textFrame';

/** Node kinds. Each equals the knowledge card that teaches it. */
export const KIND = {
  document: 'document',
  section: 'section',
  paragraph: 'paragraph',
  table: 'table',
  row: 'row',
  cell: 'cell',
  blockControl: 'blockControl',
  block: 'block',
  run: 'run',
  control: 'control',
  bookmark: 'bookmark',
  field: 'field',
  image: 'image',
  shape: 'shape',
  inline: 'inline'
} as const;

export const BLOCK_KINDS = new Set<string>([
  KIND.paragraph,
  KIND.table,
  KIND.blockControl,
  KIND.block
]);
export const INLINE_KINDS = new Set<string>([
  KIND.run,
  KIND.control,
  KIND.bookmark,
  KIND.field,
  KIND.image,
  KIND.shape,
  KIND.inline
]);

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** The kind of a native block, from its shape. */
export function blockKind(b: Record<string, unknown>): string {
  if (Array.isArray(b.rows)) return KIND.table;
  if (isObject(b.contentControlProperties) && Array.isArray(b.blocks))
    return KIND.blockControl;
  if (
    Array.isArray(b.inlines) ||
    'paragraphFormat' in b ||
    'characterFormat' in b
  )
    return KIND.paragraph;
  return KIND.block;
}

/** The kind of a native inline, from its shape. */
export function inlineKind(i: Record<string, unknown>): string {
  if (isObject(i.contentControlProperties) && Array.isArray(i.inlines))
    return KIND.control;
  if (typeof i.text === 'string') return KIND.run;
  if (typeof i.bookmarkType === 'number') return KIND.bookmark;
  if (typeof i.fieldType === 'number') return KIND.field;
  if (i.imageString !== undefined) return KIND.image;
  if (isObject(i.textFrame)) return KIND.shape;
  return KIND.inline;
}
