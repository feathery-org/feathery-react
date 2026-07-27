// Client handler for the `getFormFields` tool.
//
// ai-services declares this tool client-forwarded with no server execute, and
// until now the browser had no handler for it - on this branch or on master. The
// consequence was not a degraded answer but a dead conversation: with no
// `addToolOutput`, `lastAssistantMessageIsCompleteWithToolCalls` never becomes
// true, so the auto-continuation never fires and the turn hangs forever with no
// error. Two of the captain's three "hangs" on 2026-07-27 were exactly this
// (thread A turn A4 "increment it by one", and the 10:51 endorsements ask).
//
// The contract implemented here is ai-services' tool description verbatim
// (`src/modules/assistant/tools/assistant/getFormFields.ts`), because that text
// is what the model plans against:
//
//   * two modes - `keys` (exact fetch, takes precedence) and scan (filtered);
//   * `keys` results always include empty values, so the model can tell an empty
//     field from a nonexistent one, and unknown keys come back { found: false };
//   * scans skip empty values unless `includeEmpty`, cap at `limit` (default 50,
//     max 200), and rank exact-key match, then key-prefix, then alphabetical;
//   * scans report `total` and `omitted` plus `offset` pagination;
//   * `search` matches key and label case-insensitively, and values too when
//     `matchValues`;
//   * `scope` selects visible form fields, hidden fields, or both;
//   * entries carry label/type/stepKey ONLY for visible form fields;
//   * values are clamped, with `valueTruncated: true` when clamping happened,
//     and the `keys` mode clamp is higher than the scan clamp - which is what
//     makes the description's "re-fetch that single key via `keys`" true.
//
// Unlike the per-turn live-state block, this reads every step's fields rather
// than only the current one, and applies no cap to the hidden-field set. That is
// the whole reason the tool exists: large forms carry thousands of computed
// hidden fields, so the live-state block's `hiddenFieldValues` map is capped and
// the model needs an uncapped way to look a value up before writing it into a
// document verbatim.
import internalState from '../../utils/internalState';

// Two clamps, so the description's escape hatch is real: a scan stays small
// enough to list many fields, and a targeted `keys` fetch returns much more of
// the value.
const SCAN_VALUE_CHARS = 500;
const KEYS_VALUE_CHARS = 5000;

const DEFAULT_SCAN_LIMIT = 50;
const MAX_SCAN_LIMIT = 200;
const MAX_KEYS = 100;

export type FormFieldEntry = {
  key: string;
  found: boolean;
  hidden: boolean;
  value: unknown;
  valueTruncated?: boolean;
  type?: string;
  label?: string;
  stepKey?: string;
};

export type GetFormFieldsResult =
  | {
      ok: true;
      mode: 'keys' | 'scan';
      fields: FormFieldEntry[];
      total: number;
      omitted: number;
      offset?: number;
    }
  | { ok: false; error: string; message: string };

type ServarMeta = { type?: string; label?: string; stepKey?: string };

/**
 * Every servar (visible form field) across EVERY step, with its label, type and
 * step key. The live-state block only ever describes the current step; the model
 * asks this tool precisely when it needs a field it cannot see from there.
 */
function collectServarMeta(state: any): Map<string, ServarMeta> {
  const meta = new Map<string, ServarMeta>();
  const steps = state?.steps ?? {};
  for (const stepKey of Object.keys(steps)) {
    for (const field of steps[stepKey]?.servar_fields ?? []) {
      const servar = field?.servar;
      const key = servar?.key;
      if (typeof key !== 'string' || !key || meta.has(key)) continue;
      meta.set(key, {
        ...(servar.type ? { type: String(servar.type) } : {}),
        // `servar.name` is the user-facing label (the same value the renderer
        // shows and `Form/logic.ts` reports as a field's label).
        ...(typeof servar.name === 'string' && servar.name
          ? { label: servar.name }
          : {}),
        stepKey
      });
    }
  }
  return meta;
}

const isEmptyValue = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === 'string' && value === '') ||
  (Array.isArray(value) && value.length === 0);

/**
 * Clamp a value for transport, reporting whether anything was cut.
 *
 * Only strings are clamped by length; a large array/object is serialised and
 * clamped as text, because an unbounded structure would defeat the point of the
 * cap. Scalars pass through untouched so numbers and booleans stay typed.
 */
function clampValue(
  value: unknown,
  maxChars: number
): { value: unknown; truncated: boolean } {
  if (value === null || value === undefined)
    return { value: null, truncated: false };
  if (typeof value === 'number' || typeof value === 'boolean')
    return { value, truncated: false };
  if (typeof value === 'string') {
    return value.length > maxChars
      ? { value: value.slice(0, maxChars), truncated: true }
      : { value, truncated: false };
  }
  let serialised: string;
  try {
    serialised = JSON.stringify(value) ?? String(value);
  } catch {
    serialised = String(value);
  }
  return serialised.length > maxChars
    ? { value: `${serialised.slice(0, maxChars)}…`, truncated: true }
    : { value, truncated: false };
}

function buildEntry(
  key: string,
  rawValue: unknown,
  meta: ServarMeta | undefined,
  maxChars: number,
  found: boolean
): FormFieldEntry {
  const { value, truncated } = clampValue(rawValue, maxChars);
  return {
    key,
    found,
    hidden: !meta,
    value,
    ...(truncated ? { valueTruncated: true } : {}),
    // label/type/stepKey describe a servar; a hidden field has none of them.
    ...(meta?.type ? { type: meta.type } : {}),
    ...(meta?.label ? { label: meta.label } : {}),
    ...(meta?.stepKey ? { stepKey: meta.stepKey } : {})
  };
}

/**
 * Deterministic ranking: exact key match, then key-prefix match, then
 * alphabetical. Deterministic ordering is what makes `offset` pagination
 * meaningful across calls.
 */
function rankKeys(keys: string[], search: string): string[] {
  const needle = search.toLowerCase();
  const rank = (key: string): number => {
    const lower = key.toLowerCase();
    if (needle && lower === needle) return 0;
    if (needle && lower.startsWith(needle)) return 1;
    return 2;
  };
  return [...keys].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    return byRank !== 0 ? byRank : a.localeCompare(b);
  });
}

export function dispatchGetFormFields(
  instanceId: string | undefined,
  input: any
): GetFormFieldsResult {
  const state = internalState[instanceId ?? ''];
  if (!state) {
    return {
      ok: false,
      error: 'no_form_state',
      message: 'No live form is connected, so field values cannot be read.'
    };
  }

  const fieldsMap: Record<string, any> = state.fields ?? {};
  const servarMeta = collectServarMeta(state);
  const rawValueOf = (key: string): unknown => fieldsMap[key]?.value ?? null;

  // Mode 1: explicit keys. Takes precedence over search/scope, and always
  // includes empty values so "empty" and "nonexistent" stay distinguishable.
  const requestedKeys = Array.isArray(input?.keys)
    ? input.keys.filter(
        (k: unknown): k is string => typeof k === 'string' && !!k
      )
    : [];
  if (requestedKeys.length > 0) {
    const capped = requestedKeys.slice(0, MAX_KEYS);
    const fields = capped.map((key: string) =>
      buildEntry(
        key,
        rawValueOf(key),
        servarMeta.get(key),
        KEYS_VALUE_CHARS,
        key in fieldsMap || servarMeta.has(key)
      )
    );
    return {
      ok: true,
      mode: 'keys',
      fields,
      total: requestedKeys.length,
      omitted: requestedKeys.length - capped.length
    };
  }

  // Mode 2: scan.
  const scope =
    input?.scope === 'fields' || input?.scope === 'hidden'
      ? input.scope
      : 'all';
  const search = typeof input?.search === 'string' ? input.search : '';
  const matchValues = !!input?.matchValues;
  const includeEmpty = !!input?.includeEmpty;
  const limit = Math.min(
    MAX_SCAN_LIMIT,
    Math.max(
      1,
      Number.isFinite(input?.limit) && Number(input.limit) > 0
        ? Math.floor(Number(input.limit))
        : DEFAULT_SCAN_LIMIT
    )
  );
  const offset =
    Number.isFinite(input?.offset) && Number(input.offset) > 0
      ? Math.floor(Number(input.offset))
      : 0;

  // A servar with no entry in `fields` still exists and is still worth
  // reporting (unset, on another step), so the candidate set is the union.
  const candidateKeys = new Set<string>([
    ...Object.keys(fieldsMap),
    ...servarMeta.keys()
  ]);
  const needle = search.toLowerCase();

  const matching: string[] = [];
  for (const key of candidateKeys) {
    const meta = servarMeta.get(key);
    const hidden = !meta;
    if (scope === 'fields' && hidden) continue;
    if (scope === 'hidden' && !hidden) continue;

    const rawValue = rawValueOf(key);
    if (!includeEmpty && isEmptyValue(rawValue)) continue;

    if (needle) {
      const inKey = key.toLowerCase().includes(needle);
      const inLabel =
        !!meta?.label && meta.label.toLowerCase().includes(needle);
      let inValue = false;
      if (matchValues && !inKey && !inLabel) {
        const asText =
          typeof rawValue === 'string'
            ? rawValue
            : rawValue === null || rawValue === undefined
            ? ''
            : JSON.stringify(rawValue) ?? '';
        inValue = asText.toLowerCase().includes(needle);
      }
      if (!inKey && !inLabel && !inValue) continue;
    }
    matching.push(key);
  }

  const ranked = rankKeys(matching, search);
  const page = ranked.slice(offset, offset + limit);

  return {
    ok: true,
    mode: 'scan',
    fields: page.map((key) =>
      buildEntry(
        key,
        rawValueOf(key),
        servarMeta.get(key),
        SCAN_VALUE_CHARS,
        true
      )
    ),
    total: ranked.length,
    omitted: Math.max(0, ranked.length - offset - page.length),
    offset
  };
}
