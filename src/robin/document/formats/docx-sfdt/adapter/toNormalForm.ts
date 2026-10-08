/**
 * Native document JSON (the verbose dialect) to the normal form.
 *
 * Every section, block, row, cell and inline becomes a node with a provisional id (the engine
 * replaces it) and a `kind`; formats are hoisted into the format table and referenced as `style`,
 * `markStyle` or `listStyle`; engine-owned values go to the residue keyed by id; revisions show as
 * `pending`; binding tags show as `binding`. Nothing is dropped: `fromNormalForm` puts every byte
 * back.
 */
import type { NfNode, NormalForm } from '../../../tree';
import { bindingView, TITLE_CAP } from '../features/binding';
import { FormatInterner, split } from './formats';
import { geometrySignature } from './geometry';
import {
  HEADER_FOOTER,
  HIDDEN_IN_FORMAT,
  HIDDEN_IN_OBJECT,
  HIDDEN_NODE_KEYS,
  HIDDEN_ROOT_KEYS,
  HOIST,
  KIND,
  NF_FORMAT_KEY,
  STRUCTURAL_FORMATS,
  TEXT_FRAME,
  blockKind,
  inlineKind,
  toNfKey
} from './keys';
import type { DocxResidue, NodeRecord } from './residue';
import { NativeRevision, pendingOf } from './revisions';
import { arr } from '../util';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

export function toNormalForm(native: string): {
  nf: NormalForm;
  residue: DocxResidue;
} {
  const doc = JSON.parse(native) as Obj;
  const formats = new FormatInterner();
  const residue: DocxResidue = {};
  const revisions = new Map<string, NativeRevision>();
  for (const r of arr<NativeRevision>(doc.revisions))
    if (r?.revisionId) revisions.set(r.revisionId, r);
  let counter = 0;

  /** A value that is not a node: formats hoisted in place, engine-key names renamed. */
  const plain = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(plain);
    if (!isObject(value)) return value;
    const out: Obj = {};
    for (const key of Object.keys(value)) {
      const v = value[key];
      if (HOIST.has(key) && isObject(v)) {
        out[key] = Object.keys(v).length ? formats.intern(v) : {};
        continue;
      }
      out[toNfKey(key)] = plain(v);
    }
    return out;
  };

  type Child = (key: string, value: unknown) => unknown;

  const node = (raw: Obj, kind: string, child: Child): NfNode => {
    const id = `p${counter}`;
    counter += 1;
    const record: NodeRecord = {
      keys: Object.keys(raw),
      fmt: {},
      hidden: {},
      hiddenIn: {}
    };
    residue[id] = record;
    const out: NfNode = { id, kind };
    let pending: Obj | null = null;
    let markPending: Obj | null = null;
    const structural = Object.keys(raw).some(
      (k) => STRUCTURAL_FORMATS.has(k) && isObject(raw[k])
    );

    for (const key of record.keys) {
      const value = raw[key];
      if ((HIDDEN_NODE_KEYS[kind] ?? []).includes(key)) {
        record.hidden[key] = value;
        continue;
      }
      if (key === 'revisionIds') {
        record.hidden[key] = value;
        pending = pendingOf(value, revisions) ?? pending;
        continue;
      }
      if (HOIST.has(key) && isObject(value)) {
        const { visible, hidden } = split(value, HIDDEN_IN_FORMAT[key] ?? []);
        if (hidden.length) record.hiddenIn[key] = hidden;
        if (key === 'characterFormat')
          markPending = pendingOf(value.revisionIds, revisions);
        if (key === 'rowFormat')
          pending = pendingOf(value.revisionIds, revisions) ?? pending;
        if (!Object.keys(visible).length) continue; // `keys` remembers it was there
        // a paragraph's own character format is its mark's: always `markStyle`, so `style` on a
        // paragraph always means its paragraph format
        const nfKey =
          key === 'characterFormat' && (structural || kind === KIND.paragraph)
            ? 'markStyle'
            : NF_FORMAT_KEY[key];
        record.fmt[nfKey] = key;
        out[nfKey] = formats.intern(visible);
        continue;
      }
      if (isObject(value) && HIDDEN_IN_OBJECT[key]) {
        let hiddenKeys = HIDDEN_IN_OBJECT[key];
        if (key === 'contentControlProperties') {
          const parsed = bindingView(value.tag);
          const title = value.title;
          if (
            parsed &&
            (title === undefined ||
              title === String(value.tag).slice(0, TITLE_CAP))
          ) {
            hiddenKeys = [
              ...hiddenKeys,
              'tag',
              ...(title === undefined ? [] : ['title'])
            ];
            record.binding = { ...parsed, tag: String(value.tag), title };
          }
        }
        const { visible, hidden } = split(value, hiddenKeys);
        if (hidden.length) record.hiddenIn[key] = hidden;
        out[toNfKey(key)] = plain(visible);
        if (record.binding) out.binding = record.binding.view;
        continue;
      }
      const projected = child(key, value);
      if (projected !== undefined) out[toNfKey(key)] = projected;
    }
    if (kind === KIND.table) record.geometry = geometrySignature(raw);
    if (kind === KIND.cell)
      record.preferredWidth = (
        raw.cellFormat as Obj | undefined
      )?.preferredWidth;
    if (pending || markPending) {
      out.pending = {
        ...(pending ?? {}),
        ...(markPending ? { mark: markPending } : {})
      };
      record.pending = JSON.stringify(out.pending);
    }
    return out;
  };

  const blocks = (value: unknown) =>
    Array.isArray(value) ? value.map((b) => block(b as Obj)) : plain(value);
  const inlines = (value: unknown) =>
    Array.isArray(value) ? value.map((i) => inline(i as Obj)) : plain(value);
  /** A plain object holding a `blocks` list: the list becomes nodes, the rest stays plain. */
  const story = (value: unknown) => {
    if (!isObject(value) || !Array.isArray(value.blocks)) return plain(value);
    const out: Obj = {};
    for (const k of Object.keys(value))
      out[toNfKey(k)] = k === 'blocks' ? blocks(value.blocks) : plain(value[k]);
    return out;
  };

  const inline = (raw: Obj): NfNode =>
    node(raw, inlineKind(raw), (key, value) => {
      if (key === 'inlines') return inlines(value);
      if (key === TEXT_FRAME) return story(value);
      return plain(value);
    });

  const cell = (raw: Obj): NfNode =>
    node(raw, KIND.cell, (key, value) =>
      key === 'blocks' ? blocks(value) : plain(value)
    );

  const row = (raw: Obj): NfNode =>
    node(raw, KIND.row, (key, value) =>
      key === 'cells' && Array.isArray(value)
        ? value.map((c) => cell(c as Obj))
        : plain(value)
    );

  function block(raw: Obj): NfNode {
    const kind = blockKind(raw);
    return node(raw, kind, (key, value) => {
      if (kind === KIND.table && key === 'rows' && Array.isArray(value))
        return value.map((r) => row(r as Obj));
      if (key === 'inlines') return inlines(value);
      if (key === 'blocks') return blocks(value);
      return plain(value);
    });
  }

  const section = (raw: Obj): NfNode =>
    node(raw, KIND.section, (key, value) => {
      if (key === 'blocks') return blocks(value);
      if (key === HEADER_FOOTER && isObject(value)) {
        const out: Obj = {};
        for (const name of Object.keys(value))
          out[toNfKey(name)] = story(value[name]);
        return out;
      }
      return plain(value);
    });

  // the root: a node like any other, whose hidden keys are the dialect flag, images and revisions
  const rootId = `p${counter}`;
  counter += 1;
  const rootRecord: NodeRecord = {
    keys: Object.keys(doc),
    fmt: {},
    hidden: {},
    hiddenIn: {}
  };
  residue[rootId] = rootRecord;
  const root: NfNode = { id: rootId, kind: KIND.document };
  for (const key of rootRecord.keys) {
    const value = doc[key];
    if (HIDDEN_ROOT_KEYS.includes(key)) rootRecord.hidden[key] = value;
    else if (key === 'sections' && Array.isArray(value))
      root.sections = value.map((s) => section(s as Obj));
    else root[toNfKey(key)] = (plain({ [key]: value }) as Obj)[toNfKey(key)];
  }
  return { nf: { root, formats: formats.entries }, residue };
}
