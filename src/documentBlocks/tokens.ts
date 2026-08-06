/**
 * Token resolution and write-back over block data.
 *
 * The block data holds `TokenSpec`s inline with the prose; this module
 * collects them, runs the shipped grammar/plan over the current field values
 * to get display text, and routes an edited value back to whichever store
 * owns it — a field, or `data.values` for a token with neither `source` nor
 * `formula`.
 *
 * Mirrors tokenCycle.ts's seeding semantics (see derive()/inputValues()
 * there): numbers and text stay apart, only numbers enter the formula graph,
 * and a value the owner holds nothing for (undefined/null/'') is skipped
 * rather than seeded as zero.
 */
import { allInlines, DocumentData } from './types';
import { buildPlan, recalc, TokenSpec, valueKey } from '../documentTokens/plan';
import { parseValue, renderValue } from '../documentTokens/format';
import { FieldAccess } from '../documentTokens/cycleTypes';

const isText = (spec: TokenSpec): boolean =>
  (spec.format?.kind ?? 'text') === 'text';

const isComputed = (spec: TokenSpec): boolean => Boolean(spec.formula);

/** Every token spec in the document, one per value key. */
export const collectSpecs = (data: DocumentData): TokenSpec[] => {
  const specs = new Map<string, TokenSpec>();
  for (const section of data.sections) {
    for (const block of section.blocks) {
      for (const inline of allInlines(block)) {
        if (inline.kind === 'token')
          specs.set(valueKey(inline.spec), inline.spec);
      }
    }
  }
  return [...specs.values()];
};

/** The raw input value for a non-computed spec, from its owner. */
const rawValueOf = (
  data: DocumentData,
  fields: FieldAccess | null,
  spec: TokenSpec
): string | number | undefined =>
  fields?.read(spec) ?? data.values?.[valueKey(spec)];

export type ResolvedTokens = {
  rendered: Map<string, string>;
  errors: Map<string, string>;
};

/**
 * Seed inputs from the form (FieldAccess) and data.values, run the existing
 * recalc over the existing plan, render everything through the spec's format.
 */
export const resolveTokens = (
  data: DocumentData,
  fields: FieldAccess | null
): ResolvedTokens => {
  const specs = collectSpecs(data);
  const plan = buildPlan(specs);

  const values = new Map<string, number>();
  for (const [key, spec] of plan.specs) {
    if (isComputed(spec) || isText(spec)) continue;
    const raw = rawValueOf(data, fields, spec);
    if (raw === undefined || raw === null || raw === '') continue;
    const parsed = typeof raw === 'number' ? raw : parseValue(raw);
    if (parsed !== null) values.set(key, parsed);
  }

  const { errors: recalcErrors } = recalc(plan, values);

  const rendered = new Map<string, string>();
  const errors = new Map<string, string>();

  for (const spec of specs) {
    const key = valueKey(spec);
    const error = recalcErrors.get(key);
    if (error) {
      // An errored/unresolvable computed token still needs a rendered
      // entry: leaving the key unset makes callers' `rendered.get(key)`
      // read back `undefined`, which string-interpolates into the document
      // (and into sync logs) as the literal text "undefined".
      rendered.set(key, '');
      errors.set(key, error);
      continue;
    }
    if (isText(spec) && !isComputed(spec)) {
      const raw = rawValueOf(data, fields, spec);
      rendered.set(key, raw === undefined || raw === null ? '' : String(raw));
      continue;
    }
    rendered.set(key, renderValue(values.get(key), spec.format));
  }

  return { rendered, errors };
};

/**
 * Route one edited token value to its owner: field-backed → FieldAccess.write;
 * in-memory input → a data mutation (for store.apply). Computed tokens are not
 * writable — returns null and the caller regenerates to restore the value.
 */
export const routeTokenEdit = (
  data: DocumentData,
  fields: FieldAccess | null,
  key: string,
  text: string
): ((d: DocumentData) => DocumentData) | null => {
  const spec = collectSpecs(data).find((s) => valueKey(s) === key);
  if (!spec || isComputed(spec)) return null;

  const value: string | number | null = isText(spec) ? text : parseValue(text);
  if (value === null) return null;

  if (spec.source) {
    fields?.write([{ spec, value }]);
    return null;
  }

  return (d: DocumentData): DocumentData => ({
    ...d,
    values: { ...d.values, [key]: value }
  });
};
