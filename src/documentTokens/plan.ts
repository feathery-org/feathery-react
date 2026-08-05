/**
 * The recalculation plan.
 *
 * Built once when the editor opens and reused for every value edit. A plan
 * holds the parsed ASTs, a topological evaluation order, and a reverse
 * dependency map, so editing one token evaluates only its descendants instead
 * of the whole document.
 *
 * Rebuilt only on STRUCTURAL change — a formula edited, a token inserted or
 * removed, or wildcard membership shifting. Value edits never rebuild it.
 */

import { dependencies, evaluate, FormulaError, Node, parse } from './grammar';

export type TokenFormat = {
  kind: 'currency' | 'number' | 'percent' | 'text';
  decimals?: number;
};

export type TokenValidation = {
  min?: number;
  max?: number;
  required?: boolean;
};

export type TokenSpec = {
  /** The name the template author wrote — a field key when one matches. */
  id: string;
  /** Row of a repeated field; absent for a scalar. */
  index?: number | null;
  /** Field key when the token is field-backed; absent for in-memory. */
  source?: string | null;
  /** Expression string for computed tokens; absent for inputs. */
  formula?: string | null;
  /**
   * How an editable field is SHOWN, when a display transform was piped onto it.
   * The field still holds what the reader types; this only decides the
   * rendering, the same way a currency format does.
   */
  display?: string | null;
  /**
   * Field keys a formula reads. Those fields may have no token of their own
   * anywhere in the document, and the value still has to move when they change.
   */
  reads?: string[] | null;
  /** Address of THIS appearance. A token may appear many times. */
  instance?: string;
  format?: TokenFormat;
  validate?: TokenValidation;
};

/** Identifies a VALUE: one per token per row, shared by every appearance. */
export const valueKey = (spec: TokenSpec): string =>
  spec.index === undefined || spec.index === null
    ? spec.id
    : `${spec.id}__${spec.index}`;

/** Identifies a CONTROL: unique per appearance in the document. */
export const instanceKey = (spec: TokenSpec): string =>
  spec.instance ?? valueKey(spec);

export type Plan = {
  specs: Map<string, TokenSpec>;
  asts: Map<string, Node>;
  /** Evaluation order. Tokens in a cycle are excluded. */
  order: string[];
  /** id → tokens whose formulas depend on it, directly. */
  dependents: Map<string, string[]>;
  /** id → why this token cannot be evaluated (bad formula, cycle). */
  errors: Map<string, string>;
};

const isComputed = (spec: TokenSpec): boolean =>
  typeof spec.formula === 'string' && spec.formula.trim().length > 0;

/**
 * Resolve a formula's bare names to value keys, from the row it sits in.
 *
 * `qty * unit_cost` in row 2 depends on `qty__2` and `unit_cost__2`; the same
 * formula on a scalar token depends on the scalar values. A scalar token
 * referencing a repeated one depends on EVERY row of it, which is what makes
 * SUM(item_total) evaluate after the last row.
 */
const edgesFor = (
  ast: Node,
  index: number | null | undefined,
  rowsById: Map<string, Set<string>>
): Set<string> => {
  const deps = new Set<string>();
  for (const name of dependencies(ast)) {
    const rows = rowsById.get(name);
    if (!rows) continue;
    const own =
      index === undefined || index === null ? name : `${name}__${index}`;
    if (rows.has(own)) deps.add(own);
    else rows.forEach((key) => deps.add(key));
  }
  return deps;
};

export const buildPlan = (specs: TokenSpec[]): Plan => {
  // One entry per VALUE, not per appearance: a token used three times is one
  // node in the graph with three controls pointing at it.
  const specMap = new Map<string, TokenSpec>();
  for (const spec of specs) specMap.set(valueKey(spec), spec);

  // A formula may read a field that has no token in the document. Seed an input
  // node for it so the graph can resolve the name and the value still moves
  // when that field changes. Nothing writes these: they have no appearance.
  for (const spec of specs) {
    for (const name of spec.reads ?? []) {
      const key =
        spec.index === undefined || spec.index === null
          ? name
          : `${name}__${spec.index}`;
      if (specMap.has(key)) continue;
      specMap.set(key, {
        id: name,
        source: name,
        index: spec.index,
        format: { kind: 'number' }
      });
    }
  }

  // Which value keys exist for each bare name, so a row can bind its own.
  const rowsById = new Map<string, Set<string>>();
  for (const spec of specs) {
    const rows = rowsById.get(spec.id) ?? new Set<string>();
    rows.add(valueKey(spec));
    rowsById.set(spec.id, rows);
  }

  const asts = new Map<string, Node>();
  const errors = new Map<string, string>();

  for (const [key, spec] of specMap) {
    if (!isComputed(spec)) continue;
    try {
      asts.set(key, parse(spec.formula as string));
    } catch (err) {
      errors.set(key, (err as Error).message);
    }
  }

  // Forward edges (token → what it needs) and the reverse map used at recalc.
  const needs = new Map<string, Set<string>>();
  const dependents = new Map<string, string[]>();
  for (const [id, ast] of asts) {
    const deps = edgesFor(ast, specMap.get(id)?.index, rowsById);
    needs.set(id, deps);
    for (const dep of deps) {
      const list = dependents.get(dep);
      if (list) list.push(id);
      else dependents.set(dep, [id]);
    }
  }

  // Depth-first topological sort with a three-colour marker. A token reached
  // while still being visited is in a cycle: it gets an error and every other
  // token still resolves.
  const order: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();

  const visit = (id: string, trail: string[]): void => {
    const mark = state.get(id);
    if (mark === 'done') return;
    if (mark === 'visiting') {
      const cycle = [...trail.slice(trail.indexOf(id)), id].join(' → ');
      errors.set(id, `circular reference: ${cycle}`);
      return;
    }
    if (errors.has(id)) return;

    state.set(id, 'visiting');
    for (const dep of needs.get(id) ?? []) {
      if (asts.has(dep)) visit(dep, [...trail, id]);
    }
    state.set(id, 'done');
    if (!errors.has(id)) order.push(id);
  };

  for (const id of asts.keys()) visit(id, []);

  // A token depending on one that failed cannot resolve either.
  let settled = false;
  while (!settled) {
    settled = true;
    for (const id of [...order]) {
      const broken = [...(needs.get(id) ?? [])].find((dep) => errors.has(dep));
      if (broken) {
        errors.set(id, `depends on ${broken}, which cannot be evaluated`);
        order.splice(order.indexOf(id), 1);
        settled = false;
      }
    }
  }

  return { specs: specMap, asts, order, dependents, errors };
};

/**
 * Every token that must be re-evaluated when `id` changes, in evaluation
 * order. Excludes `id` itself — it is the input, not a result.
 */
export const affected = (plan: Plan, id: string): string[] => {
  const reached = new Set<string>();
  const queue = [id];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const dependent of plan.dependents.get(current) ?? []) {
      if (!reached.has(dependent)) {
        reached.add(dependent);
        queue.push(dependent);
      }
    }
  }

  return plan.order.filter((each) => reached.has(each));
};

export type RecalcResult = {
  /** Only the tokens whose value actually changed. */
  changed: Map<string, number>;
  /** Tokens that could not be evaluated this pass, by id. */
  errors: Map<string, string>;
};

/**
 * Evaluate the tokens downstream of `changedId`, or the whole document when
 * no id is given (used once on open). `values` is updated in place with the
 * new results; the returned map holds only what moved.
 */
/**
 * The values one token can see: bare names bound to its own row, and — for a
 * scalar token — every row of a repeated name as a list, so SUM(item_total)
 * aggregates the column.
 */
const viewFor = (
  plan: Plan,
  values: Map<string, number>,
  spec: TokenSpec
): Map<string, number | number[]> => {
  const scalar = spec.index === undefined || spec.index === null;
  const view = new Map<string, number | number[]>();

  for (const [key, other] of plan.specs) {
    const value = values.get(key);
    if (value === undefined) continue;
    const otherScalar = other.index === undefined || other.index === null;

    if (otherScalar) {
      view.set(other.id, value);
    } else if (!scalar && other.index === spec.index) {
      view.set(other.id, value);
    } else if (scalar) {
      const existing = view.get(other.id);
      if (Array.isArray(existing)) existing.push(value);
      else view.set(other.id, [value]);
    }
  }

  return view;
};

export const recalc = (
  plan: Plan,
  values: Map<string, number>,
  changedId?: string
): RecalcResult => {
  const targets = changedId ? affected(plan, changedId) : plan.order;
  const changed = new Map<string, number>();
  const errors = new Map<string, string>(plan.errors);

  for (const id of targets) {
    const ast = plan.asts.get(id);
    const spec = plan.specs.get(id);
    if (!ast || !spec) continue;
    try {
      const next = evaluate(ast, viewFor(plan, values, spec));
      if (values.get(id) !== next) {
        values.set(id, next);
        changed.set(id, next);
      }
      errors.delete(id);
    } catch (err) {
      errors.set(
        id,
        err instanceof FormulaError
          ? err.message
          : String((err as Error).message)
      );
    }
  }

  return { changed, errors };
};

/** Validation failures for the current values, by token id. */
export const validationErrors = (
  plan: Plan,
  values: Map<string, number>
): Map<string, string> => {
  const failures = new Map<string, string>();

  for (const [id, spec] of plan.specs) {
    const rule = spec.validate;
    if (!rule) continue;
    const value = values.get(id);

    if (value === undefined) {
      if (rule.required) failures.set(id, 'required');
      continue;
    }
    if (rule.min !== undefined && value < rule.min) {
      failures.set(id, `must be at least ${rule.min}`);
    } else if (rule.max !== undefined && value > rule.max) {
      failures.set(id, `must be at most ${rule.max}`);
    }
  }

  return failures;
};
