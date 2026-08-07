/**
 * The token cycle's public surface: the value types a host exchanges with it,
 * and the two pure helpers a host calls between cycles. Everything stateful
 * lives in tokenCycle.ts; nothing here touches an editor.
 */

import { TokenSpec } from './plan';

/** A token's value as the form engine holds it. */
export type TokenValue = number | string;

/**
 * How the cycle reaches the form's field values.
 *
 * Injected rather than imported, so the cycle stays free of SDK internals
 * and testable without a form. The host supplies the same read and write paths
 * the rendered inputs use, which is what makes a token and its field
 * indistinguishable to the rest of the form.
 */
export type FieldAccess = {
  /** The field value behind a token, or undefined when it has none. */
  read: (spec: TokenSpec) => TokenValue | undefined;
  /** Write field values, batched so one update covers every token that moved. */
  write: (updates: Array<{ spec: TokenSpec; value: TokenValue }>) => void;
  /**
   * How many rows a repeated field holds, so the document can match it.
   * Absent means the host cannot say, and rows are left as the document has them.
   */
  rowCount?: (source: string) => number | undefined;
  /**
   * Drop row `index` from these fields, shifting later rows down.
   *
   * A splice, not a blank: deleting the middle of three line items has to leave
   * two, or the row comes straight back on the next sync.
   */
  removeRow?: (sources: string[], index: number) => void;
};

export type TokenState = {
  specs: TokenSpec[];
  /** Numeric values by value key — inputs and computed alike. */
  values: Map<string, number>;
  /** Text values by value key. */
  texts: Map<string, string>;
  /** Formula and cycle failures by value key. */
  errors: Map<string, string>;
  /** Validation failures by value key. */
  invalid: Map<string, string>;
  /** The token the caret is inside, or null in ordinary prose. */
  focused: string | null;
};

export type TokenCycle = {
  /** Apply a value for one token and bring the document back in step. */
  setTokenValue: (id: string, raw: TokenValue) => TokenState;
  /** Re-read the document and rebuild the graph, after a structural change. */
  refresh: () => TokenState;
  /** Bring the document in step with the current values. */
  reconcile: () => TokenState;
  getState: () => TokenState;
  subscribe: (listener: (state: TokenState) => void) => () => void;
  detach: () => void;
};

/**
 * The problems that must stop a save, or null when there are none.
 *
 * Validation failures and formula errors both mean a number in the document
 * is wrong — a token whose formula cannot evaluate renders its 0 fallback,
 * and these documents are financial or legal, so a bad number saved silently
 * is worse than an unsaved edit.
 */
export const saveBlockers = (state: TokenState): string | null => {
  const problems = [...state.invalid.entries(), ...state.errors.entries()];
  if (problems.length === 0) return null;
  const summary = problems.map(([id, reason]) => `${id}: ${reason}`).join(', ');
  return `Cannot save — ${problems.length} token(s) invalid. ${summary}`;
};

/**
 * A cheap change signature over every field the plan reads.
 *
 * The container reconciles on render; comparing this string is what lets it
 * skip the O(document) control walk when no relevant field has moved.
 */
export const tokenFieldSignature = (
  specs: TokenSpec[],
  read: (key: string) => unknown
): string => {
  const keys = new Set<string>();
  for (const spec of specs) {
    if (spec.source) keys.add(spec.source);
    for (const name of spec.reads ?? []) keys.add(name);
  }
  return [...keys]
    .sort()
    .map((key) => `${key}=${JSON.stringify(read(key)) ?? ''}`)
    .join('|');
};
