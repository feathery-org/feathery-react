/**
 * The binding feature in the normal form (architecture 4.2): a content control whose tag is a
 * binding in the editor's tag DSL is shown as `binding: {name, type, expr, row, global, delete,
 * ...}` instead of its raw `tag` and `title`. The DSL's own spelling of every value is kept, so the
 * model reads what the document says. `parseTag` decides what is a binding; nothing here guesses.
 */
import {
  ApplyRulesResult,
  applyRules
} from '../../../../../elements/components/DocxEditor/bindings/core/engine';
import {
  collectRefs,
  parseExpression
} from '../../../../../elements/components/DocxEditor/bindings/core/formula';
import { Occurrence } from '../../../../../elements/components/DocxEditor/bindings/core/sfdtAdapter';
import { SfdtDocument } from '../../../../../elements/components/DocxEditor/bindings/core/sfdtTypes';
import {
  decodeValue,
  encodeValue,
  parseTag
} from '../../../../../elements/components/DocxEditor/bindings/core/tagDsl';
import type { Annotation } from '../../../pack';
import type { NfNode, NormalForm } from '../../../tree';
import { fromNormalForm } from '../adapter/fromNormalForm';
import { toNfKey } from '../adapter/keys';

/** A content control's title is its tag cut to this many characters (all 84 flagship controls). */
export const TITLE_CAP = 60;

const VIEW_ORDER = [
  'table',
  'name',
  'type',
  'expr',
  'row',
  'global',
  'delete',
  'value',
  'default',
  'label',
  'copyOf',
  'v'
];
const DSL_KEY: Record<string, string> = { delete: 'del' };
const dslKey = (viewKey: string) => DSL_KEY[viewKey] ?? viewKey;
const ENCODED = new Set(['expr', 'value', 'default', 'label', 'row', 'copyOf']);

export type BindingView = Record<string, unknown>;

/** `{view, order}` for a binding tag, or null when the tag is foreign or malformed. */
export function bindingView(
  tag: unknown
): { view: BindingView; order: string[] } | null {
  if (typeof tag !== 'string') return null;
  let def: ReturnType<typeof parseTag> = null;
  try {
    def = parseTag(tag);
  } catch {
    return null;
  }
  if (!def || def.version !== 2) return null;
  const order: string[] = [];
  const pairs: Record<string, string> = {};
  for (const part of tag.slice(2, -2).split('|')) {
    const eq = part.indexOf('=');
    const k = part.slice(0, eq);
    order.push(k);
    pairs[k] = part.slice(eq + 1);
  }
  const view: BindingView = {};
  for (const vk of VIEW_ORDER) {
    const dk = dslKey(vk);
    if (!(dk in pairs)) continue;
    let v: unknown = pairs[dk];
    if (ENCODED.has(dk)) {
      try {
        v = decodeValue(String(v));
      } catch {
        return null;
      }
    }
    if (dk === 'global') v = v === 'true';
    view[vk] = v;
  }
  return { view, order };
}

/** The tag for a binding view; keys the original tag had keep their order. */
export function formatBinding(
  view: BindingView,
  order: readonly string[] = []
): string {
  const pairs: Record<string, string> = {};
  for (const [vk, raw] of Object.entries(view)) {
    if (raw === undefined || raw === null) continue;
    const dk = dslKey(vk);
    if (dk === 'global') {
      if (raw === true || raw === 'true') pairs.global = 'true';
      continue;
    }
    pairs[dk] = ENCODED.has(dk) ? encodeValue(String(raw)) : String(raw);
  }
  if ('table' in pairs) return `[[table=${pairs.table}]]`;
  const canonical = VIEW_ORDER.map(dslKey);
  const keys = [
    ...order.filter((k) => k in pairs),
    ...canonical.filter((k) => k in pairs && !order.includes(k)),
    ...Object.keys(pairs).filter(
      (k) => !order.includes(k) && !canonical.includes(k)
    )
  ];
  return `[[${keys.map((k) => `${k}=${pairs[k]}`).join('|')}]]`;
}

// ---------------------------------------------------------------------------------------------
// The binding engine over the normal form
// ---------------------------------------------------------------------------------------------

/**
 * The product's binding engine (`applyRules`, `scanBindings`) is the authority on what a binding
 * means; it reads native document JSON. The normal form mirrors the native tree node for node, so
 * an engine path (`['sections', 0, 'blocks', 4, 'inlines', 2]`) names the same position in the
 * normal form, and the node there is the one the path means.
 */
export interface BindingState {
  native: SfdtDocument;
  result: ApplyRulesResult;
  /** The normal-form node an engine path points into (the deepest node along it). */
  nodeAt(path: ReadonlyArray<string | number>): NfNode | null;
}

const states = new WeakMap<NormalForm, BindingState>();

/**
 * The binding engine's view of a normal form, computed once per document version. A document
 * that is still being changed (a finalizer's working copy) must use `computeBindingState`.
 */
export function bindingState(nf: NormalForm): BindingState {
  const cached = states.get(nf);
  if (cached) return cached;
  const state = computeBindingState(nf);
  states.set(nf, state);
  return state;
}

/** The binding engine's view of a normal form as it is now, not cached. */
export function computeBindingState(
  nf: NormalForm,
  prevValues: Map<string, string> | null = null
): BindingState {
  // the residue is not needed: tags are formatted from the binding views, geometry derived
  const native = JSON.parse(fromNormalForm(nf, {})) as SfdtDocument;
  const result = applyRules(JSON.parse(JSON.stringify(native)), {
    adoptRows: false,
    prevValues
  });
  const nodeAt = (path: ReadonlyArray<string | number>): NfNode | null => {
    let cur: unknown = nf.root;
    let found: NfNode | null = null;
    for (const token of path) {
      if (cur === null || typeof cur !== 'object') break;
      cur = Array.isArray(cur)
        ? cur[Number(token)]
        : (cur as Record<string, unknown>)[toNfKey(String(token))];
      if (
        cur &&
        typeof cur === 'object' &&
        !Array.isArray(cur) &&
        typeof (cur as NfNode).id === 'string' &&
        typeof (cur as NfNode).kind === 'string'
      )
        found = cur as NfNode;
    }
    return found;
  };
  return { native, result, nodeAt };
}

/**
 * `usedBy` and `derived` from the binding engine (contract 2.3): every bound node lists the
 * formula nodes that read it, directly, through a row reference, or through a `<table>.<column>`
 * aggregate (a bound table's control lists the formulas that aggregate over it); every formula
 * control carries its computed value.
 */
export function bindingAnnotations(nf: NormalForm): Map<string, Annotation> {
  const { result, nodeAt } = bindingState(nf);
  const { index, values } = result;
  const out = new Map<string, Annotation>();
  const add = (target: NfNode | null, reader: NfNode | null) => {
    if (!target || !reader || target.id === reader.id) return;
    const a = out.get(target.id) ?? {};
    if (!(a.usedBy ?? []).includes(reader.id))
      a.usedBy = [...(a.usedBy ?? []), reader.id];
    out.set(target.id, a);
  };
  const documentLevel = new Map<string, Occurrence[]>();
  for (const o of index.occurrences)
    if (!o.tableId)
      documentLevel.set(o.name, [...(documentLevel.get(o.name) ?? []), o]);
  for (const f of index.occurrences) {
    if (f.def.kind !== 'formula') continue;
    const reader = nodeAt(f.path);
    if (reader) {
      const a = out.get(reader.id) ?? {};
      a.derived = { ...(a.derived ?? {}), value: values.get(f.key) ?? null };
      out.set(reader.id, a);
    }
    let refs: string[] = [];
    try {
      refs = collectRefs(parseExpression(f.def.expression));
    } catch {
      continue;
    }
    for (const ref of refs) {
      if (f.tableId) {
        const row = index.tables
          .get(f.tableId)
          ?.rows.find((r) => r.rowId === f.rowId);
        const cell = row?.bindings.get(ref);
        if (cell) {
          add(nodeAt(cell.path), reader);
          continue;
        }
      }
      const docs = documentLevel.get(ref);
      if (docs) {
        for (const o of docs) add(nodeAt(o.path), reader);
        continue;
      }
      const dot = ref.lastIndexOf('.');
      const table = dot > 0 ? index.tables.get(ref.slice(0, dot)) : undefined;
      if (!table) continue;
      add(nodeAt(table.markerPath), reader);
      for (const row of table.rows) {
        const cell = row.bindings.get(ref.slice(dot + 1));
        if (cell) add(nodeAt(cell.path), reader);
      }
    }
  }
  return out;
}
