/**
 * Automatic updates: edit one token, every dependent follows.
 *
 * The single write path. A change arriving from the document, a side panel, or
 * the assistant all land on `setTokenValue`, so "the total moved because the
 * quantity did" is not a feature anyone implements — it is the only thing that
 * can happen. Writing a control directly would be the one way to desynchronise
 * the document from its own graph.
 *
 *      document edit ──┐
 *      panel edit ─────┼──→ setTokenValue(id, raw)
 *      assistant op ───┘             │
 *                                    ▼
 *                        plan.recalc(descendants only)
 *                                    │
 *                                    ▼
 *                    write changed controls, one undo step
 *
 * Distinct from `assistant/tools/cellFormula.ts`, which recomputes a column
 * when the assistant asks it to. This watches the document and reacts.
 */

import { EditorLike, readTokens, tokenAtCaret, writeValues } from './controls';
import { parseValue, renderValue } from './format';
import { buildPlan, Plan, recalc, TokenSpec, validationErrors } from './plan';

/** Recalculating on every keystroke would rewrite the document mid-word. */
const READ_BACK_DELAY_MS = 400;

export type TokenState = {
  specs: TokenSpec[];
  values: Map<string, number>;
  /** Formula and cycle failures, by token id. */
  errors: Map<string, string>;
  /** Validation failures, by token id. */
  invalid: Map<string, string>;
  /** The token the caret is inside, or null in ordinary prose. */
  focused: string | null;
};

export type TokenCycle = {
  /** Apply a new raw value for one token and propagate. */
  setTokenValue: (id: string, raw: string | number) => TokenState;
  /** Re-read the document and rebuild the plan, after a structural edit. */
  refresh: () => TokenState;
  /** Current state without touching the editor. */
  getState: () => TokenState;
  subscribe: (listener: (state: TokenState) => void) => () => void;
  detach: () => void;
};

type CycleEditor = EditorLike & {
  addEventListener?: (event: string, handler: () => void) => void;
  removeEventListener?: (event: string, handler: () => void) => void;
};

const numericValues = (
  entries: Array<{ spec: TokenSpec; value: string }>
): Map<string, number> => {
  const values = new Map<string, number>();
  for (const { spec, value } of entries) {
    const parsed = parseValue(value);
    if (parsed !== null) values.set(spec.id, parsed);
  }
  return values;
};

export const attachTokenCycle = (
  editor: CycleEditor,
  options: { readBackDelayMs?: number } = {}
): TokenCycle => {
  const delay = options.readBackDelayMs ?? READ_BACK_DELAY_MS;

  let plan: Plan = buildPlan([]);
  let values = new Map<string, number>();
  let editingId: string | null = null;
  let applying = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(state: TokenState) => void>();

  const snapshot = (): TokenState => ({
    specs: [...plan.specs.values()],
    values: new Map(values),
    errors: new Map(plan.errors),
    invalid: validationErrors(plan, values),
    focused: editingId
  });

  const publish = (): TokenState => {
    const state = snapshot();
    listeners.forEach((listener) => listener(state));
    return state;
  };

  /** Write the tokens whose values moved, skipping the one being typed in. */
  const flush = (changed: Map<string, number>, skipId?: string): void => {
    if (changed.size === 0) return;
    const updates = [...changed.entries()].map(([id, value]) => ({
      id,
      text: renderValue(value, plan.specs.get(id)?.format)
    }));

    applying = true;
    try {
      writeValues(editor, updates, { skipId });
    } finally {
      applying = false;
    }
  };

  const refresh = (): TokenState => {
    const entries = readTokens(editor);
    plan = buildPlan(entries.map(({ spec }) => spec));
    values = numericValues(entries);
    // One full pass on open, so a document is consistent before anyone
    // touches it — a template change could have left it stale.
    flush(recalc(plan, values).changed);
    return publish();
  };

  const setTokenValue = (id: string, raw: string | number): TokenState => {
    const parsed = typeof raw === 'number' ? raw : parseValue(raw);
    if (parsed === null || values.get(id) === parsed) return publish();

    values.set(id, parsed);
    const { changed, errors } = recalc(plan, values, id);
    plan = { ...plan, errors };

    // The edited token is rewritten too — reformatting what the user typed —
    // unless they are still inside it.
    const updates = new Map(changed);
    if (editingId !== id) updates.set(id, parsed);
    flush(updates, editingId ?? undefined);

    return publish();
  };

  /**
   * Read an edit made in the document back into the graph.
   *
   * Ignores our own writes: `applying` is raised around every programmatic
   * edit, so the write-back never reads itself as a user edit.
   */
  const onContentChange = (): void => {
    if (applying) return;

    const focused = tokenAtCaret(editor);
    editingId = focused?.id ?? null;
    if (!focused) return;

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const current = readTokens(editor).find((t) => t.spec.id === focused.id);
      if (!current) return;

      const parsed = parseValue(current.value);
      // Typing has stopped, so the token is no longer being edited and
      // downstream writes may touch it again.
      editingId = null;
      if (parsed === null || values.get(focused.id) === parsed) {
        publish();
        return;
      }
      setTokenValue(focused.id, parsed);
    }, delay);
  };

  editor.addEventListener?.('contentChange', onContentChange);
  refresh();

  return {
    setTokenValue,
    refresh,
    getState: snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    detach: () => {
      if (timer) clearTimeout(timer);
      editor.removeEventListener?.('contentChange', onContentChange);
      listeners.clear();
    }
  };
};
