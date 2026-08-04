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

import {
  dependencies,
  evaluate,
  FormulaError,
  Node,
  parse,
  wildcardPrefixes
} from './grammar';

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
  id: string;
  /** Field key for inputs; null for computed tokens. */
  source?: string | null;
  /** Expression string for computed tokens; null for inputs. */
  formula?: string | null;
  format?: TokenFormat;
  validate?: TokenValidation;
};

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
 * Every id a token depends on: direct references plus, for wildcards, every
 * id currently matching the prefix. The wildcard edges are what make
 * SUM(item_total_*) evaluate after the last item total, not before it.
 */
const edgesFor = (ast: Node, allIds: string[]): Set<string> => {
  const deps = dependencies(ast);
  for (const prefix of wildcardPrefixes(ast)) {
    for (const id of allIds) {
      if (id.startsWith(prefix)) deps.add(id);
    }
  }
  return deps;
};

export const buildPlan = (specs: TokenSpec[]): Plan => {
  const specMap = new Map(specs.map((s) => [s.id, s]));
  const asts = new Map<string, Node>();
  const errors = new Map<string, string>();
  const ids = specs.map((s) => s.id);

  for (const spec of specs) {
    if (!isComputed(spec)) continue;
    try {
      asts.set(spec.id, parse(spec.formula as string));
    } catch (err) {
      errors.set(spec.id, (err as Error).message);
    }
  }

  // Forward edges (token → what it needs) and the reverse map used at recalc.
  const needs = new Map<string, Set<string>>();
  const dependents = new Map<string, string[]>();
  for (const [id, ast] of asts) {
    const deps = edgesFor(ast, ids);
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
    if (!ast) continue;
    try {
      const next = evaluate(ast, values);
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
