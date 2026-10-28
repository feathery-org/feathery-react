/**
 * The format table: every distinct format object interned once. The key keeps the object's key
 * ORDER, which costs a little deduplication (306 entries against 259 sorted, measured on the
 * HILB fixture) and buys byte-exact expansion with no per-node key-order bookkeeping.
 */
import type { HiddenSub } from './residue';

export class FormatInterner {
  readonly entries: Record<string, Record<string, unknown>> = {};

  private readonly byText = new Map<string, string>();

  intern(entry: Record<string, unknown>): string {
    const text = JSON.stringify(entry);
    const hit = this.byText.get(text);
    if (hit) return hit;
    const key = `s${this.byText.size}`;
    this.byText.set(text, key);
    this.entries[key] = entry;
    return key;
  }
}

/** An object rebuilt from its visible entries plus the hidden sub-keys at their positions. */
export function materialize(
  visible: Record<string, unknown> | null | undefined,
  hidden: HiddenSub[] | undefined
): Record<string, unknown> {
  const entries: Array<[string, unknown]> = visible
    ? Object.entries(visible)
    : [];
  for (const rec of [...(hidden ?? [])].sort((a, b) => a.at - b.at)) {
    if (entries.some(([k]) => k === rec.k)) continue;
    entries.splice(Math.min(Math.max(rec.at, 0), entries.length), 0, [
      rec.k,
      rec.v
    ]);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) out[k] = v;
  return out;
}

/** Split an object into its visible part and the listed hidden sub-keys with their positions. */
export function split(
  value: Record<string, unknown>,
  hiddenKeys: readonly string[]
): { visible: Record<string, unknown>; hidden: HiddenSub[] } {
  const visible: Record<string, unknown> = {};
  const hidden: HiddenSub[] = [];
  Object.keys(value).forEach((k, at) => {
    if (hiddenKeys.includes(k)) hidden.push({ at, k, v: value[k] });
    else visible[k] = value[k];
  });
  return { visible, hidden };
}
