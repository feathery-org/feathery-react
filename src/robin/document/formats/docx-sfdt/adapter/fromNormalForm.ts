/**
 * The normal form plus its residue back to native document JSON, byte-exact for every node the
 * write did not change (`fromNormalForm(toNormalForm(x))` is `x`).
 *
 * A node with a residue record is rebuilt in its original key order with its hidden keys put back
 * at their original positions; a node the model created has none and is built in the order the
 * editor itself serializes that kind. Table geometry (`grid`, `columnCount`, each cell's
 * `columnIndex` and `cellWidth`) is kept byte for byte while a table's cell geometry is unchanged,
 * and derived from the cells when it is not.
 */
import type { NfNode, NormalForm } from '../../../tree';
import { formatBinding, TITLE_CAP } from '../features/binding';
import { materialize } from './formats';
import {
  columnIndices,
  derivedColumnCount,
  derivedGrid,
  geometrySignature
} from './geometry';
import {
  HIDDEN_IN_OBJECT,
  HIDDEN_NODE_KEYS,
  HOIST,
  KIND,
  toNativeKey,
  toNfKey
} from './keys';
import type { DocxResidue, HiddenSub, NodeRecord } from './residue';
import { NativeRevision, RevisionMinter, revisionsIn } from './revisions';
import { arr } from '../util';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = <T>(v: T): T =>
  v === undefined ? v : JSON.parse(JSON.stringify(v));

/** Key order the editor itself serializes, for nodes the model created. */
const CANONICAL_KEYS: Record<string, string[]> = {
  [KIND.section]: ['sectionFormat', 'blocks', 'headersFooters'],
  [KIND.paragraph]: ['paragraphFormat', 'characterFormat', 'inlines'],
  [KIND.table]: [
    'rows',
    'grid',
    'tableFormat',
    'description',
    'title',
    'columnCount'
  ],
  [KIND.row]: ['cells', 'rowFormat'],
  [KIND.cell]: ['blocks', 'cellFormat', 'columnIndex'],
  [KIND.control]: ['inlines', 'contentControlProperties'],
  [KIND.run]: ['characterFormat', 'text'],
  [KIND.bookmark]: ['characterFormat', 'bookmarkType', 'name'],
  [KIND.field]: ['characterFormat', 'fieldType', 'hasFieldEnd']
};

/** Content-control properties for a control the model created without copying a sibling's. */
const DEFAULT_CONTROL_PROPERTIES = (): Obj => ({
  lockContentControl: false,
  lockContents: false,
  type: 'RichText',
  hasPlaceHolderText: false,
  multiline: false,
  isTemporary: false,
  characterFormat: {},
  contentControlListItems: []
});
const DEFAULT_COLOUR = '#00000000';

/** The native format key a node's `style` publishes when no residue says. */
function structuralFormat(kind: string): string {
  switch (kind) {
    case KIND.section:
      return 'sectionFormat';
    case KIND.table:
      return 'tableFormat';
    case KIND.row:
      return 'rowFormat';
    case KIND.cell:
      return 'cellFormat';
    case KIND.paragraph:
    case KIND.block:
      return 'paragraphFormat';
    default:
      return 'characterFormat';
  }
}

const isNode = (v: unknown): v is NfNode =>
  isObject(v) && typeof v.id === 'string' && typeof v.kind === 'string';

export function fromNormalForm(nf: NormalForm, residue: DocxResidue): string {
  const formatOf = (ref: unknown): Obj => {
    if (typeof ref !== 'string') return {};
    const entry = nf.formats[ref];
    if (!entry) throw new Error(`format ${ref} is not in the format table`);
    return clone(entry);
  };
  const cellRecords = new WeakMap<Obj, NodeRecord | undefined>();

  const value = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(value);
    if (isNode(v)) return node(v);
    if (!isObject(v)) return v;
    const out: Obj = {};
    for (const [key, child] of Object.entries(v)) {
      const nativeKey = toNativeKey(key);
      out[nativeKey] =
        HOIST.has(nativeKey) && typeof child === 'string'
          ? formatOf(child)
          : value(child);
    }
    return out;
  };

  const controlProperties = (
    n: NfNode,
    record: NodeRecord | undefined
  ): Obj => {
    const present = n.contentControlProperties;
    const visible = value(
      present ?? (record ? {} : DEFAULT_CONTROL_PROPERTIES())
    ) as Obj;
    let hidden: HiddenSub[] = record?.hiddenIn.contentControlProperties ?? [
      { at: 0, k: 'color', v: DEFAULT_COLOUR }
    ];
    const original = record?.binding ?? null;
    const has = Object.prototype.hasOwnProperty.call(n, 'binding');
    const same =
      original &&
      isObject(n.binding) &&
      JSON.stringify(n.binding) === JSON.stringify(original.view);
    if (has && !same) {
      hidden = hidden.filter((h) => h.k !== 'tag' && h.k !== 'title');
      delete visible.tag;
      delete visible.title;
      if (isObject(n.binding)) {
        const tag = formatBinding(n.binding, original?.order ?? []);
        const title = tag.slice(0, TITLE_CAP);
        if (original) {
          hidden = [...(record?.hiddenIn.contentControlProperties ?? [])].map(
            (h) =>
              h.k === 'tag'
                ? { ...h, v: tag }
                : h.k === 'title'
                ? { ...h, v: title }
                : h
          );
        } else {
          // a new control: tag, colour, title in the order the editor's own controls use
          const locks = Object.keys(visible).filter(
            (k) => k === 'lockContentControl' || k === 'lockContents'
          ).length;
          const colour =
            hidden.find((h) => h.k === 'color')?.v ?? DEFAULT_COLOUR;
          hidden = [
            { at: locks, k: 'tag', v: tag },
            { at: locks + 1, k: 'color', v: colour },
            { at: locks + 2, k: 'title', v: title },
            ...hidden.filter((h) => h.k !== 'color')
          ];
        }
      }
    }
    return materialize(visible, hidden);
  };

  const rootRecord = residue[nf.root.id] as NodeRecord | undefined;
  const minter = new RevisionMinter(
    arr<NativeRevision>(rootRecord?.hidden.revisions),
    new Date().toISOString()
  );
  /** Revision ids for a node whose `pending` the engine (re)authored: its own and its mark's. */
  const revisionAnchors = (n: NfNode) => {
    const p = isObject(n.pending) ? n.pending : undefined;
    const record = residue[n.id] as NodeRecord | undefined;
    const priorNode = arr<unknown>(record?.hidden.revisionIds);
    const priorMark = arr<unknown>(
      (record?.hiddenIn.characterFormat ?? []).find(
        (h) => h.k === 'revisionIds'
      )?.v
    );
    return {
      node: revisionsIn(p).map((r) => minter.idFor(r, priorNode)),
      mark: revisionsIn(p?.mark).map((r) => minter.idFor(r, priorMark))
    };
  };

  function node(n: NfNode): Obj {
    const record = residue[n.id] as NodeRecord | undefined;
    const { kind } = n;
    // which normal-form key publishes which native format key on this node
    const fmt: Record<string, string> = {};
    if ('style' in n || !record) fmt.style = structuralFormat(kind);
    if ('markStyle' in n) fmt.markStyle = 'characterFormat';
    if ('listStyle' in n) fmt.listStyle = 'listFormat';
    Object.assign(fmt, record?.fmt ?? {});
    const published: Record<string, string> = {};
    for (const [nfKey, nativeKey] of Object.entries(fmt))
      published[nativeKey] = nfKey;

    const canonical =
      kind === KIND.control && Array.isArray(n.blocks)
        ? ['blocks', 'contentControlProperties']
        : CANONICAL_KEYS[kind] ?? [];
    const order = record ? record.keys : canonical;
    const wantsControl = isObject(n.binding) && kind === KIND.control;
    const out: Obj = {};

    // Revision anchors: kept from the residue while `pending` is as read; re-authored otherwise.
    const pendingChanged =
      JSON.stringify(n.pending ?? null) !== (record?.pending ?? 'null');
    const anchors = pendingChanged ? revisionAnchors(n) : null;
    /** Hidden sub-keys of a format with its revision ids replaced by the re-authored ones. */
    const withRevisionIds = (
      key: string,
      ids: string[] | undefined
    ): HiddenSub[] | undefined => {
      const hidden = record?.hiddenIn[key];
      if (!anchors) return hidden;
      const kept = (hidden ?? []).filter((h) => h.k !== 'revisionIds');
      if (!ids?.length) return kept;
      const at =
        (hidden ?? []).find((h) => h.k === 'revisionIds')?.at ??
        Number.MAX_SAFE_INTEGER;
      return [...kept, { at, k: 'revisionIds', v: ids }];
    };

    const emit = (key: string) => {
      if (key in out) return;
      if (key === 'revisionIds' && anchors) {
        if (anchors.node.length) out.revisionIds = anchors.node;
        return;
      }
      if (record && key in record.hidden) {
        out[key] = clone(record.hidden[key]);
        return;
      }
      if ((HIDDEN_NODE_KEYS[kind] ?? []).includes(key)) {
        out[key] = key === 'grid' ? [] : 0; // filled in by the table's geometry pass
        return;
      }
      if (HOIST.has(key)) {
        const nfKey = published[key];
        const ref = nfKey ? n[nfKey] : undefined;
        // a created node carries every format its kind has, as the editor writes them
        if (ref === undefined && !record && !canonical.includes(key)) return;
        const hidden =
          key === 'characterFormat' && kind === KIND.paragraph
            ? withRevisionIds(key, anchors?.mark)
            : key === 'rowFormat' && kind === KIND.row
            ? withRevisionIds(key, anchors?.node)
            : record?.hiddenIn[key];
        out[key] = materialize(
          typeof ref === 'string' ? formatOf(ref) : {},
          hidden
        );
        return;
      }
      if (HIDDEN_IN_OBJECT[key]) {
        if (
          n[toNfKey(key)] === undefined &&
          !record?.hiddenIn[key] &&
          !wantsControl
        )
          return;
        out[key] =
          key === 'contentControlProperties'
            ? controlProperties(n, record)
            : materialize(value(n[toNfKey(key)]) as Obj, record?.hiddenIn[key]);
        return;
      }
      const v = n[toNfKey(key)];
      if (v !== undefined) out[key] = value(v);
    };

    for (const key of order) emit(key);
    // keys the model added that the native node did not have
    for (const nfKey of Object.keys(n)) {
      if (
        [
          'id',
          'kind',
          'pending',
          'binding',
          'style',
          'markStyle',
          'listStyle'
        ].includes(nfKey)
      )
        continue;
      emit(toNativeKey(nfKey));
    }
    if (wantsControl) emit('contentControlProperties');
    // an inline the engine marked as a tracked change carries its own anchor
    if (
      anchors?.node.length &&
      kind !== KIND.row &&
      kind !== KIND.paragraph &&
      !('revisionIds' in out)
    )
      out.revisionIds = anchors.node;

    if (kind === KIND.cell) cellRecords.set(out, record);
    if (kind === KIND.table) tableGeometry(out, record);
    return out;
  }

  /** Keep a table's geometry while its cells' geometry is unchanged; derive it otherwise. */
  function tableGeometry(table: Obj, record: NodeRecord | undefined) {
    if (
      record?.geometry !== undefined &&
      record.geometry === geometrySignature(table)
    )
      return;
    table.grid = derivedGrid(table);
    table.columnCount = derivedColumnCount(table);
    for (const row of arr<Obj>(table.rows)) {
      const indices = columnIndices(row);
      arr<Obj>(row.cells).forEach((cell, i) => {
        cell.columnIndex = indices[i];
        const cf = cell.cellFormat as Obj | undefined;
        const rec = cellRecords.get(cell);
        if (!isObject(cf) || typeof cf.preferredWidth !== 'number') return;
        const keep =
          rec && rec.preferredWidth === cf.preferredWidth && 'cellWidth' in cf;
        if (!keep) cf.cellWidth = cf.preferredWidth;
      });
    }
  }

  const root = nf.root;
  const record = rootRecord;
  const rootValue = (key: string, v: unknown) =>
    HOIST.has(key) && typeof v === 'string' ? formatOf(v) : value(v);
  const out: Obj = {};
  for (const key of arr<string>(record?.keys)) {
    if (record && key in record.hidden) out[key] = clone(record.hidden[key]);
    else if (root[toNfKey(key)] !== undefined)
      out[key] = rootValue(key, root[toNfKey(key)]);
  }
  for (const nfKey of Object.keys(root)) {
    const key = toNativeKey(nfKey);
    if (nfKey !== 'id' && nfKey !== 'kind' && !(key in out))
      out[key] = rootValue(key, root[nfKey]);
  }
  if (minter.minted.length)
    out.revisions = [...arr<NativeRevision>(out.revisions), ...minter.minted];
  return JSON.stringify(out);
}
