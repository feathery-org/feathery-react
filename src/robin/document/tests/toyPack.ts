/**
 * A toy format and its pack: the fake pack every core test runs against.
 *
 * Native bytes are JSON text: `{"body":[block...]}` where a block is a paragraph
 * `{"t":"p","text":...,"bold"?,"size"?,"align"?,"x"?,"rev"?}` or a box
 * `{"t":"box","name"?,"items":[paragraph...],"rev"?}`; `rev` is `ins` or `del` (a tracked change),
 * `x` is native-only data the normal form leaves to the residue.
 *
 * Normal form: root `doc` with list `blocks`; `para` {text, style, align?, formula?}; `box`
 * {name?, items}. `bold` and `size` are hoisted into format entries referenced by `style`.
 * A paragraph with `formula: "count(<box>)"` reads that box; its text is derived by the `formulas`
 * finalizer as `Items: <n>`.
 *
 * The host is an in-memory editor with an undo stack, three seams (`text` tracked and native,
 * `format` immediate and native, `splice` replacing the document) and fault injection.
 */
import type {
  Annotation,
  CommitPlan,
  DocumentView,
  EditorHost,
  EffectiveProperty,
  FormatTable,
  Pack,
  PlanContext,
  PropertySpec,
  Residue
} from '../pack';
import type { RefusalProblem } from '../envelope';
import {
  NfNode,
  NormalForm,
  clone,
  canonicalJson,
  indexTree,
  isPlainObject
} from '../tree';

export const TOY_FORMAT = 'toy-format';

type Rev = 'ins' | 'del';
interface NativePara {
  t: 'p';
  text: string;
  bold?: boolean;
  size?: number;
  align?: string;
  formula?: string;
  x?: string;
  rev?: Rev;
  /** The change set that authored `rev`: a turn id, or another author's mark. */
  by?: string;
}
interface NativeBox {
  t: 'box';
  name?: string;
  items: NativePara[];
  rev?: Rev;
  by?: string;
}
type NativeBlock = NativePara | NativeBox;
interface NativeDoc {
  body: NativeBlock[];
}

// ------------------------------------------------------------------ native text, canonical order

const PARA_KEYS = ['t', 'text', 'bold', 'size', 'align', 'formula', 'x', 'rev', 'by'];
const BOX_KEYS = ['t', 'name', 'items', 'rev', 'by'];

function writeBlock(b: NativeBlock): Record<string, unknown> {
  const keys = b.t === 'p' ? PARA_KEYS : BOX_KEYS;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = (b as unknown as Record<string, unknown>)[k];
    if (v === undefined) continue;
    out[k] =
      k === 'items' ? (v as NativePara[]).map((p) => writeBlock(p)) : v;
  }
  return out;
}

export function writeNative(doc: NativeDoc): string {
  return JSON.stringify({ body: doc.body.map(writeBlock) });
}

export const para = (
  text: string,
  extra: Partial<NativePara> = {}
): NativePara => ({ t: 'p', text, ...extra });
export const box = (
  items: NativePara[],
  extra: Partial<NativeBox> = {}
): NativeBox => ({ t: 'box', items, ...extra });
export const toyNative = (...body: NativeBlock[]): string =>
  writeNative({ body });

// ------------------------------------------------------------------ adapter

const PENDING: Record<Rev, string> = { ins: 'insertion', del: 'deletion' };
const REV: Record<string, Rev> = { insertion: 'ins', deletion: 'del' };

function toNormalForm(native: string): { nf: NormalForm; residue: Residue } {
  const doc = JSON.parse(native) as NativeDoc;
  const formats: NormalForm['formats'] = {};
  const keyOf = new Map<string, string>();
  const residue: Residue = {};
  let next = 0;
  const intern = (entry: Record<string, unknown>) => {
    const c = canonicalJson(entry);
    let key = keyOf.get(c);
    if (!key) {
      key = `s${keyOf.size}`;
      keyOf.set(c, key);
      formats[key] = entry;
    }
    return key;
  };
  const toPara = (p: NativePara): NfNode => {
    const id = `t${next++}`;
    const entry: Record<string, unknown> = {};
    if (p.bold !== undefined) entry.bold = p.bold;
    if (p.size !== undefined) entry.size = p.size;
    const node: NfNode = { id, kind: 'para', text: p.text, style: intern(entry) };
    if (p.align !== undefined) node.align = p.align;
    if (p.formula !== undefined) node.formula = p.formula;
    if (p.rev) node.pending = { kind: PENDING[p.rev], ...(p.by ? { by: p.by } : {}) };
    if (p.x !== undefined) residue[id] = { x: p.x };
    return node;
  };
  const toBlock = (b: NativeBlock): NfNode => {
    if (b.t === 'p') return toPara(b);
    const node: NfNode = { id: `t${next++}`, kind: 'box' };
    if (b.name !== undefined) node.name = b.name;
    node.items = b.items.map(toPara);
    if (b.rev) node.pending = { kind: PENDING[b.rev], ...(b.by ? { by: b.by } : {}) };
    return node;
  };
  const root: NfNode = { id: 'r', kind: 'doc', blocks: doc.body.map(toBlock) };
  return { nf: { root, formats }, residue };
}

function fromNormalForm(nf: NormalForm, residue: Residue): string {
  const revOf = (n: NfNode): Rev | undefined =>
    isPlainObject(n.pending) ? REV[String(n.pending.kind)] : undefined;
  const byOf = (n: NfNode): string | undefined =>
    isPlainObject(n.pending) && typeof n.pending.by === 'string' ? n.pending.by : undefined;
  const toPara = (n: NfNode): NativePara => {
    const entry = nf.formats[String(n.style)] ?? {};
    const r = residue[n.id] as { x?: string } | undefined;
    return {
      t: 'p',
      text: String(n.text),
      bold: entry.bold as boolean | undefined,
      size: entry.size as number | undefined,
      align: n.align as string | undefined,
      formula: n.formula as string | undefined,
      x: r?.x,
      rev: revOf(n),
      by: byOf(n)
    };
  };
  const toBlock = (n: NfNode): NativeBlock =>
    n.kind === 'para'
      ? toPara(n)
      : {
          t: 'box',
          name: n.name as string | undefined,
          items: (n.items as NfNode[]).map(toPara),
          rev: revOf(n),
          by: byOf(n)
        };
  return writeNative({ body: (nf.root.blocks as NfNode[]).map(toBlock) });
}

// ------------------------------------------------------------------ derived values

const FORMULA = /^count\(([a-z0-9_]+)\)$/;

function boxesByName(view: DocumentView): Map<string, NfNode> {
  const out = new Map<string, NfNode>();
  for (const n of view.nodes())
    if (n.kind === 'box' && typeof n.name === 'string') out.set(n.name, n);
  return out;
}

function annotate(view: DocumentView): Map<string, Annotation> {
  const out = new Map<string, Annotation>();
  const boxes = boxesByName(view);
  for (const n of view.nodes()) {
    const m = typeof n.formula === 'string' ? FORMULA.exec(n.formula) : null;
    if (!m) continue;
    const target = boxes.get(m[1]);
    out.set(n.id, {
      derived: {
        value: target ? (target.items as unknown[]).length : null
      }
    });
    if (target) {
      const a = out.get(target.id) ?? {};
      a.usedBy = [...(a.usedBy ?? []), n.id];
      out.set(target.id, a);
    }
  }
  return out;
}

// ------------------------------------------------------------------ properties

const spec = (
  name: string,
  type: string,
  validate: (v: unknown) => string | null,
  cls: 'property' | 'derived' = 'property'
): PropertySpec => ({ name, type, validate, class: cls });
const boolean = spec('bold', 'boolean', (v) =>
  typeof v === 'boolean' ? null : 'must be true or false'
);
const size = spec('size', 'integer 6 to 72', (v) =>
  Number.isInteger(v) && (v as number) >= 6 && (v as number) <= 72
    ? null
    : 'must be an integer from 6 to 72'
);
const align = spec('align', 'left, center or right', (v) =>
  ['left', 'center', 'right'].includes(String(v))
    ? null
    : 'must be left, center or right'
);
const length = spec('length', 'integer', () => 'derived', 'derived');
const border = spec('border', 'boolean', (v) =>
  typeof v === 'boolean' ? null : 'must be true or false'
);

const PARA_SCHEMA = [boolean, size, align, length];
const BOX_SCHEMA = [border];

function setOverride(
  node: NfNode,
  name: string,
  value: unknown,
  formats: FormatTable
): void {
  if (name === 'bold' || name === 'size') {
    const entry = { ...(formats.get(String(node.style)) ?? {}) };
    if (value === null) delete entry[name];
    else entry[name] = value;
    node.style = formats.intern(entry);
    return;
  }
  if (value === null) delete node[name];
  else node[name] = value;
}

// ------------------------------------------------------------------ projections

function project(nf: NormalForm, drop: string): NormalForm {
  const out = clone(nf);
  const rec = (n: NfNode) => {
    delete n.pending;
    for (const key of ['blocks', 'items']) {
      if (!Array.isArray(n[key])) continue;
      n[key] = (n[key] as NfNode[]).filter(
        (c) => !(isPlainObject(c.pending) && c.pending.kind === drop)
      );
      (n[key] as NfNode[]).forEach(rec);
    }
  };
  rec(out.root);
  return out;
}

const trimText = (nf: NormalForm): NormalForm => {
  const out = clone(nf);
  const rec = (n: NfNode) => {
    if (typeof n.text === 'string') n.text = n.text.replace(/\s+$/, '');
    for (const key of ['blocks', 'items'])
      if (Array.isArray(n[key])) (n[key] as NfNode[]).forEach(rec);
  };
  rec(out.root);
  return out;
};

// ------------------------------------------------------------------ reconcile

/** Index paths of a node in the native body (parent chain of list indices). */
function pathOf(view: DocumentView, id: string): number[] {
  const out: number[] = [];
  let p = view.placement(id);
  while (p && p.parent) {
    out.unshift(p.index);
    p = view.placement(p.parent.id);
  }
  return out;
}

const listIds = (n: NfNode | undefined) =>
  ['blocks', 'items']
    .flatMap((k) => (Array.isArray(n?.[k]) ? (n?.[k] as NfNode[]) : []))
    .map((c) => c.id);

/** Compose the tracked document: deleted nodes kept as deletions, new and changed as insertions. */
function composeTracked(before: DocumentView, intended: DocumentView, turnId: string): NormalForm {
  const out = clone(intended.nf);
  const formatOnly = (a: NfNode, b: NfNode) =>
    a.text === b.text && a.formula === b.formula && a.kind === b.kind;
  const rec = (node: NfNode, original: NfNode | undefined) => {
    for (const key of ['blocks', 'items']) {
      if (!Array.isArray(node[key])) continue;
      const kids = node[key] as NfNode[];
      const result: NfNode[] = [];
      const keep = new Set(kids.map((k) => k.id));
      const before_ = (Array.isArray(original?.[key]) ? original?.[key] : []) as NfNode[];
      let bi = 0;
      for (const kid of kids) {
        // removed originals that preceded this kid stay in place as deletions
        while (bi < before_.length && !keep.has(before_[bi].id)) {
          result.push({ ...clone(before_[bi]), pending: { kind: 'deletion', by: turnId } });
          bi += 1;
        }
        const old = before.get(kid.id);
        if (!old) {
          result.push({ ...kid, pending: { kind: 'insertion', by: turnId } });
          continue;
        }
        if (before_[bi]?.id === kid.id) bi += 1;
        if (kid.kind === 'para' && !formatOnly(old, kid) && !kid.pending) {
          // both halves keep the id, so both find the node's residue on the way back
          result.push({ ...clone(old), pending: { kind: 'deletion', by: turnId } });
          result.push({ ...kid, pending: { kind: 'insertion', by: turnId } });
          continue;
        }
        rec(kid, old);
        result.push(kid);
      }
      while (bi < before_.length) {
        if (!keep.has(before_[bi].id))
          result.push({ ...clone(before_[bi]), pending: { kind: 'deletion', by: turnId } });
        bi += 1;
      }
      node[key] = result;
    }
  };
  rec(out.root, before.nf.root);
  return out;
}

function plan(ctx: PlanContext): CommitPlan {
  const { before, intended } = ctx;
  const sameStructure =
    before.nodes().length === intended.nodes().length &&
    before.nodes().every((n) => {
      const m = intended.get(n.id);
      return (
        m && canonicalJson(listIds(n)) === canonicalJson(listIds(m)) && !n.pending
      );
    });
  const textEdits: Array<{ path: number[]; text: string }> = [];
  const formatEdits: Array<{ path: number[]; set: Record<string, unknown> }> = [];
  if (sameStructure) {
    for (const n of intended.nodes()) {
      if (n.kind !== 'para') continue;
      const old = before.get(n.id) as NfNode;
      if (old.text !== n.text || old.formula !== n.formula)
        textEdits.push({ path: pathOf(before, n.id), text: String(n.text) });
      const a = intended.nf.formats[String(n.style)] ?? {};
      const b = before.nf.formats[String(old.style)] ?? {};
      const set: Record<string, unknown> = {};
      for (const k of ['bold', 'size'])
        if (a[k] !== b[k]) set[k] = a[k] ?? null;
      if (old.align !== n.align) set.align = n.align ?? null;
      if (Object.keys(set).length)
        formatEdits.push({ path: pathOf(before, n.id), set });
    }
  }
  const boxChanged = intended
    .nodes()
    .some((n) => n.kind === 'box' && (before.get(n.id)?.border !== n.border || before.get(n.id)?.name !== n.name));
  if (sameStructure && !boxChanged && textEdits.length && !formatEdits.length)
    return { steps: [{ seam: 'text', payload: textEdits }], landed: 'card', history: 'editor' };
  if (sameStructure && !boxChanged && formatEdits.length && !textEdits.length)
    return {
      steps: [{ seam: 'format', payload: formatEdits }],
      landed: 'immediate',
      history: 'editor',
      warnings: [
        {
          code: 'immediate-not-tracked',
          message: 'Formatting applied immediately; undo reverts it.'
        }
      ]
    };
  const tracked = composeTracked(before, intended, ctx.turnId);
  return {
    steps: [
      {
        seam: 'splice',
        payload: fromNormalForm(tracked, { ...ctx.beforeResidue, ...ctx.intendedResidue })
      }
    ],
    landed: 'card',
    history: 'engine',
    warnings: [
      {
        code: 'undo-history-cleared',
        message:
          "The editor's undo history before this change is no longer available; the card is the way back."
      }
    ]
  };
}

function expectedRejection(before: NormalForm, intended: NormalForm): NormalForm {
  // formatting lands untracked, so rejecting restores text and structure but keeps the look
  const out = clone(before);
  const shape = { childLists: (n: NfNode) => ['blocks', 'items'].filter((k) => Array.isArray(n[k])) };
  const later = indexTree(intended.root, shape);
  const formatsByContent = new Map(
    Object.entries(out.formats).map(([k, v]) => [canonicalJson(v), k])
  );
  let fresh = 0;
  const internFormat = (entry: Record<string, unknown>) => {
    const c = canonicalJson(entry);
    let key = formatsByContent.get(c);
    if (!key) {
      key = `x${fresh++}`;
      formatsByContent.set(c, key);
      out.formats[key] = entry;
    }
    return key;
  };
  const rec = (n: NfNode) => {
    const m = later.get(n.id)?.node;
    if (m && n.kind === 'para') {
      n.style = internFormat(intended.formats[String(m.style)] ?? {});
      if (m.align === undefined) delete n.align;
      else n.align = m.align;
    }
    for (const key of ['blocks', 'items'])
      if (Array.isArray(n[key])) (n[key] as NfNode[]).forEach(rec);
  };
  rec(out.root);
  return out;
}

// ------------------------------------------------------------------ the host

export class ToyHost implements EditorHost {
  native: string;
  undoStack: string[] = [];
  redoStack: string[] = [];
  locked = false;
  /** Fault injection: the next seam throws after applying part of its work. */
  failNextSeam: string | null = null;
  /** Fault injection: the next seam lands something other than what it was asked. */
  corruptNextSeam = false;
  /**
   * Fault injection on the next seam: drop native-only data, re-author other changes under this
   * turn, or leave this turn's change out of its group.
   */
  seamFault: 'drop-residue' | 'reauthor-foreign' | 'omit-group' | null = null;
  /**
   * Fault injection: the next seam's undo step restores the document with a trailing space on the
   * first paragraph, equivalent under normalization T1 but not byte-exact.
   */
  undoDrift = false;
  opens = 0;

  constructor(native: string) {
    this.native = native;
  }
  serialize(): string {
    return this.native;
  }
  open(native: string): void {
    this.native = native;
    this.undoStack = [];
    this.redoStack = [];
    this.opens += 1;
  }
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  undo(): void {
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.redoStack.push(this.native);
    this.native = prev;
  }
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(this.native);
    this.native = next;
  }
  readOnly(): boolean {
    return this.locked;
  }
  /** A user edit: one undo step. */
  userEdit(mutate: (doc: NativeDoc) => void): void {
    const doc = JSON.parse(this.native) as NativeDoc;
    mutate(doc);
    this.undoStack.push(this.native);
    this.redoStack = [];
    this.native = writeNative(doc);
  }
  /** A seam edit: one grouped undo step, with the injected faults. */
  seamEdit(name: string, mutate: (doc: NativeDoc) => void, turnId = ''): void {
    const doc = JSON.parse(this.native) as NativeDoc;
    const before = this.native;
    mutate(doc);
    let undoTo = before;
    if (this.undoDrift) {
      this.undoDrift = false;
      const drifted = JSON.parse(before) as NativeDoc;
      const first = drifted.body[0];
      if (first?.t === 'p') first.text = `${first.text} `;
      undoTo = writeNative(drifted);
    }
    this.undoStack.push(undoTo);
    this.redoStack = [];
    this.native = writeNative(doc);
    if (this.failNextSeam === name) {
      this.failNextSeam = null;
      throw new Error(`${name}: placement failed`);
    }
    this.applyFaults(turnId);
  }

  /** The injected faults, applied after a seam did its work. */
  applyFaults(turnId: string): void {
    if (this.corruptNextSeam) {
      this.corruptNextSeam = false;
      const d = JSON.parse(this.native) as NativeDoc;
      d.body.push({ t: 'p', text: 'stray' });
      this.native = writeNative(d);
    }
    const fault = this.seamFault;
    if (!fault) return;
    this.seamFault = null;
    const d = JSON.parse(this.native) as NativeDoc;
    const blocks = d.body.flatMap((b): Array<NativePara | NativeBox> => (b.t === 'box' ? [b, ...b.items] : [b]));
    for (const b of blocks) {
      if (fault === 'drop-residue' && b.t === 'p') delete b.x;
      if (fault === 'reauthor-foreign' && b.rev && b.by !== turnId) b.by = turnId;
      if (fault === 'omit-group' && b.by === turnId) delete b.by;
    }
    this.native = writeNative(d);
  }
}

const at = (doc: NativeDoc, path: number[]) =>
  path.length === 1
    ? { list: doc.body, i: path[0] }
    : { list: (doc.body[path[0]] as NativeBox).items, i: path[1] };

// ------------------------------------------------------------------ invariants

function orphanedDependents(ctx: {
  after: DocumentView;
}): RefusalProblem[] {
  const boxes = boxesByName(ctx.after);
  const orphans = ctx.after
    .nodes()
    .filter((n) => {
      const m =
        typeof n.formula === 'string' ? FORMULA.exec(n.formula) : null;
      return m && !boxes.has(m[1]) && !n.pending;
    });
  if (!orphans.length) return [];
  return [
    {
      invariant: 'orphaned-dependents',
      destroyed: `${orphans.length} formula(s) would read a box this change removes: ${orphans
        .map((n) => `${n.id} = ${n.formula}`)
        .join('; ')}`,
      detail: orphans.map((n) => ({ ids: [n.id], expr: n.formula })),
      retry: 'modified_input',
      read: ['formula'],
      hint: 'Keep the box, or rewrite or remove each listed formula in the same write.'
    }
  ];
}

function uniqueBoxNames(ctx: { after: DocumentView }): RefusalProblem[] {
  const seen = new Map<string, string[]>();
  for (const n of ctx.after.nodes())
    if (n.kind === 'box' && typeof n.name === 'string')
      seen.set(n.name, [...(seen.get(n.name) ?? []), n.id]);
  const dup = [...seen].filter(([, ids]) => ids.length > 1);
  return dup.length
    ? [
        {
          invariant: 'box-name-unique',
          destroyed: `box names would collide: ${dup
            .map(([name, ids]) => `${name} on ${ids.join(', ')}`)
            .join('; ')}`,
          detail: dup.map(([name, ids]) => ({ name, ids })),
          retry: 'modified_input',
          read: ['box']
        }
      ]
    : [];
}

// ------------------------------------------------------------------ the pack

export function makeToyPack(overrides: Partial<Pack> = {}): Pack {
  return {
    format: TOY_FORMAT,
    vocabulary: ['toy-format'],
    tree: {
      childLists: (node) =>
        node.kind === 'doc' ? ['blocks'] : node.kind === 'box' ? ['items'] : [],
      inferKind: (node) =>
        typeof node.text === 'string'
          ? 'para'
          : Array.isArray(node.items)
          ? 'box'
          : null,
      accepts: (parentKind, key, kind) =>
        (parentKind === 'doc' && key === 'blocks' && (kind === 'para' || kind === 'box')) ||
        (parentKind === 'box' && key === 'items' && kind === 'para'),
      identity: (node) =>
        node.kind === 'box' && typeof node.name === 'string' ? `box:${node.name}` : null
    },
    formatRefKeys: ['style'],
    adapter: { toNormalForm, fromNormalForm },
    outline: {
      defaultDepth: 2,
      detail: (node, view) => {
        const marks: string[] = [];
        if (node.kind === 'para') marks.push(JSON.stringify(node.text));
        if (node.kind === 'box')
          marks.push(`${(node.items as unknown[]).length} items${node.name ? ` [name=${node.name}]` : ''}`);
        if (typeof node.formula === 'string') marks.push(`{formula=${node.formula}}`);
        const used = view.annotation(node.id)?.usedBy;
        if (used?.length) marks.push(`usedBy[${used.join(',')}]`);
        if (isPlainObject(node.pending)) marks.push(`[pending ${node.pending.kind}]`);
        return marks.join(' ');
      }
    },
    text: (node) => (node.kind === 'para' ? String(node.text) : null),
    features: (node) => [
      ...(node.kind === 'box' && typeof node.name === 'string'
        ? [{ name: 'named', value: node.name }]
        : []),
      ...(typeof node.formula === 'string' ? [{ name: 'formula', value: node.formula }] : [])
    ],
    annotate,
    properties: {
      schema: (kind) => (kind === 'para' ? PARA_SCHEMA : kind === 'box' ? BOX_SCHEMA : null),
      formatSchema: [boolean, size],
      effective: (node, view): Record<string, EffectiveProperty> => {
        if (node.kind === 'box')
          return {
            border: { value: node.border ?? false, source: node.border === undefined ? 'default' : 'override' }
          };
        const entry = view.nf.formats[String(node.style)] ?? {};
        const parent = view.placement(node.id)?.parent;
        return {
          bold: { value: entry.bold ?? false, source: entry.bold === undefined ? 'default' : 'format' },
          size: { value: entry.size ?? 11, source: entry.size === undefined ? 'default' : 'format' },
          align:
            node.align !== undefined
              ? { value: node.align, source: 'override' }
              : parent?.kind === 'box' && parent.align !== undefined
              ? { value: parent.align, source: 'container' }
              : { value: 'left', source: 'default' }
        };
      },
      setOverride,
      setOnSpan: (node, span, text, props, formats) => {
        if (span.start !== 0 || span.end !== String(node.text).length)
          return 'this format formats whole paragraphs only; use the ids target';
        for (const [k, v] of Object.entries(props)) setOverride(node, k, v, formats);
        return null;
      },
      setOnFormat: (entry, name, value) => {
        if (value === null) delete entry[name];
        else entry[name] = value;
      }
    },
    invariants: [
      { name: 'orphaned-dependents', check: orphanedDependents },
      { name: 'box-name-unique', check: uniqueBoxNames }
    ],
    finalizers: [
      {
        name: 'formulas',
        run: (after) => {
          const shape = { childLists: (n: NfNode) => ['blocks', 'items'].filter((k) => Array.isArray(n[k])) };
          const index = indexTree(after.root, shape);
          const boxes = new Map<string, NfNode>();
          for (const { node } of index.values())
            if (node.kind === 'box' && typeof node.name === 'string') boxes.set(node.name, node);
          const ids: string[] = [];
          for (const { node } of index.values()) {
            const m = typeof node.formula === 'string' ? FORMULA.exec(node.formula) : null;
            const target = m ? boxes.get(m[1]) : undefined;
            if (!target) continue;
            const text = `Items: ${(target.items as unknown[]).length}`;
            if (node.text !== text) {
              node.text = text;
              ids.push(node.id);
            }
          }
          return {
            ids,
            facts: ids.length
              ? [{ kind: 'finalizer', name: 'formulas', ids, summary: `${ids.length} formula(s) recomputed` }]
              : []
          };
        }
      }
    ],
    projections: {
      accept: (nf) => project(nf, 'deletion'),
      reject: (nf) => project(nf, 'insertion'),
      normalizations: [{ name: 'T1', apply: trimText }],
      expectedRejection,
      authoredBy: (pending, turnId) => isPlainObject(pending) && pending.by === turnId
    },
    reconcile: { plan },
    seams: {
      text: {
        apply: (host, payload, ctx) =>
          (host as ToyHost).seamEdit(
            'text',
            (doc) => {
              const edits = payload as Array<{ path: number[]; text: string }>;
              for (const e of [...edits].reverse()) {
                const { list, i } = at(doc, e.path);
                const old = list[i] as NativePara;
                // the toy editor drops trailing whitespace from typed text (normalization T1)
                list.splice(
                  i,
                  1,
                  { ...old, rev: 'del', by: ctx.turnId },
                  { ...old, text: e.text.replace(/\s+$/, ''), rev: 'ins', by: ctx.turnId }
                );
              }
            },
            ctx.turnId
          )
      },
      format: {
        apply: (host, payload, ctx) =>
          (host as ToyHost).seamEdit('format', (doc) => {
            for (const e of payload as Array<{ path: number[]; set: Record<string, unknown> }>) {
              const { list, i } = at(doc, e.path);
              const p = list[i] as unknown as Record<string, unknown>;
              for (const [k, v] of Object.entries(e.set)) {
                if (v === null) delete p[k];
                else p[k] = v;
              }
            }
          }, ctx.turnId)
      },
      splice: {
        apply: (host, payload, ctx) => {
          const toy = host as ToyHost;
          if (toy.failNextSeam === 'splice') {
            toy.failNextSeam = null;
            throw new Error('splice: open failed');
          }
          host.open(String(payload));
          toy.applyFaults(ctx.turnId);
        }
      }
    },
    ...overrides
  };
}
