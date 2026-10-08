/**
 * The binding feature in the normal form (architecture 4.2): a content control whose tag is a
 * binding in the editor's tag DSL is shown as `binding: {name, type, expr, row, global, delete,
 * ...}` instead of its raw `tag` and `title`. The DSL's own spelling of every value is kept, so the
 * model reads what the document says. `parseTag` decides what is a binding; nothing here guesses.
 */
import {
  decodeValue,
  encodeValue,
  parseTag
} from '../../../../../elements/components/DocxEditor/bindings/core/tagDsl';

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
