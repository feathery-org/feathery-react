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

import {
  EditorLike,
  readTokens,
  selectTokenValue,
  tokenAtCaret,
  writeValues
} from './controls';
import { parseValue, renderValue } from './format';
import {
  buildPlan,
  Plan,
  recalc,
  TokenSpec,
  validationErrors,
  valueKey
} from './plan';

/**
 * SyncFusion's placeholder for an emptied content control. Undo can leave a
 * token showing this instead of a value, so it is treated as "no text".
 */
const PLACEHOLDER = 'Click here or tap to insert text';

/**
 * A token commits when the caret LEAVES it, not on a timer.
 *
 * Rewriting while someone is still typing moves the caret under their hands
 * and turns one edit into several undo steps. Blur is also the moment the
 * value is actually finished — a timer only guesses at it.
 */

export type TokenState = {
  specs: TokenSpec[];
  values: Map<string, number>;
  /** Text tokens, which never enter the numeric graph. */
  texts: Map<string, string>;
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
  /**
   * Re-evaluate every computed token against the current values, without
   * rebuilding the graph. Values arriving from outside the document (a form
   * field changing) go through `setTokenValue`, which returns early when the
   * token itself did not move — this makes sure dependents still follow.
   */
  recompute: () => TokenState;
  /** Current state without touching the editor. */
  getState: () => TokenState;
  subscribe: (listener: (state: TokenState) => void) => () => void;
  detach: () => void;
};

type CycleEditor = EditorLike & {
  addEventListener?: (event: string, handler: (args?: any) => void) => void;
  removeEventListener?: (event: string, handler: (args?: any) => void) => void;
};

const numericValues = (
  entries: Array<{ spec: TokenSpec; value: string }>
): Map<string, number> => {
  const values = new Map<string, number>();
  for (const { spec, value } of entries) {
    if ((spec.format?.kind ?? 'text') === 'text') continue;
    const parsed = parseValue(value);
    if (parsed !== null) values.set(valueKey(spec), parsed);
  }
  return values;
};

export const attachTokenCycle = (
  editor: CycleEditor,
  options: {
    /** Called with every token whose value moved, so the host can mirror
     *  them into form fields. Fires for computed tokens too — a total is as
     *  worth submitting as the quantity that drove it. */
    onValuesChanged?: (changed: Map<string, number>) => void;
  } = {}
): TokenCycle => {
  let plan: Plan = buildPlan([]);
  let values = new Map<string, number>();
  let texts = new Map<string, string>();
  let editingId: string | null = null;
  let applying = false;
  const listeners = new Set<(state: TokenState) => void>();

  const snapshot = (): TokenState => ({
    specs: [...plan.specs.values()],
    values: new Map(values),
    texts: new Map(texts),
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
    options.onValuesChanged?.(new Map(changed));
  };

  const refresh = (): TokenState => {
    const entries = readTokens(editor);
    plan = buildPlan(entries.map(({ spec }) => spec));
    values = numericValues(entries);
    texts = new Map(
      entries
        .filter(({ spec }) => (spec.format?.kind ?? 'text') === 'text')
        .map(({ spec, value }) => [
          valueKey(spec),
          value === PLACEHOLDER ? '' : value
        ])
    );
    // One full pass on open, so a document is consistent before anyone
    // touches it — a template change could have left it stale.
    flush(recalc(plan, values).changed);
    return publish();
  };

  const setTokenValue = (id: string, raw: string | number): TokenState => {
    // A text token holds whatever it was given; nothing derives from it.
    if ((plan.specs.get(id)?.format?.kind ?? 'text') === 'text') {
      const text = String(raw);
      if (texts.get(id) === text) return publish();
      texts.set(id, text);
      applying = true;
      try {
        writeValues(editor, [{ id, text }], { skipId: editingId ?? undefined });
      } finally {
        applying = false;
      }
      return publish();
    }

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
   * Enter commits the token under the caret; Escape puts back the last
   * committed value. Without these the only way to finish an edit is to
   * click elsewhere, and there is no way to abandon one at all.
   */
  const onKeyDown = (args: any): void => {
    const key = args?.event?.key ?? args?.key;
    const focusedSpec = tokenAtCaret(editor);
    if (!focusedSpec) return;
    const focused = { id: valueKey(focusedSpec) };

    // A number token refuses characters it could never hold. Cheaper than
    // repairing the text afterwards, and the user sees the rule immediately.
    if (
      key &&
      key.length === 1 &&
      !args?.event?.metaKey &&
      !args?.event?.ctrlKey
    ) {
      const kind = plan.specs.get(focused.id)?.format?.kind ?? 'text';
      if (kind !== 'text' && !/[0-9.,\-$%]/.test(key)) {
        args?.event?.preventDefault?.();
        if (args) args.isHandled = true;
        return;
      }
    }

    if (key !== 'Enter' && key !== 'Escape') return;

    args?.event?.preventDefault?.();
    if (args) args.isHandled = true;

    const id = focused.id;
    if (key === 'Enter') {
      const entry = readTokens(editor).find((t) => valueKey(t.spec) === id);
      const parsed = entry ? parseValue(entry.value) : null;
      editingId = null;
      if (parsed !== null && values.get(id) !== parsed)
        setTokenValue(id, parsed);
      else if (entry) reformat(id, entry.value);
      publish();
      return;
    }

    // Escape: the graph never took the edit, so rewriting from `values`
    // restores exactly what was last committed.
    editingId = null;
    const restored = values.get(id);
    if (restored !== undefined) {
      applying = true;
      try {
        writeValues(editor, [
          { id, text: renderValue(restored, plan.specs.get(id)?.format) }
        ]);
      } finally {
        applying = false;
      }
    }
    publish();
  };

  /**
   * Rewrite a token's text if it no longer matches its declared format.
   *
   * A number token can never keep non-numeric text: whatever survives
   * parsing wins, else the last committed value, else zero. Letters typed
   * into a currency field disappear when the caret leaves it.
   */
  const reformat = (id: string, currentText: string): void => {
    const format = plan.specs.get(id)?.format;
    if ((format?.kind ?? 'text') === 'text') return;

    const value = values.get(id) ?? parseValue(currentText) ?? 0;
    const canonical = renderValue(value, format);
    if (canonical === currentText) return;
    values.set(id, value);

    applying = true;
    try {
      writeValues(editor, [{ id, text: canonical }]);
    } finally {
      applying = false;
    }
  };

  /**
   * Commit the token the caret just left.
   *
   * Fires on selection movement rather than on a timer, so the document is
   * only rewritten once the user has moved on. Our own writes are ignored:
   * `applying` is raised around every programmatic edit.
   */
  const onSelectionChange = (): void => {
    if (applying) return;

    const caretSpec = tokenAtCaret(editor);
    const current = caretSpec ? valueKey(caretSpec) : null;
    if (current === editingId) return;

    const left = editingId;
    editingId = current;

    if (left === null) {
      publish();
      return;
    }

    const entry = readTokens(editor).find((t) => valueKey(t.spec) === left);
    if (!entry) {
      publish();
      return;
    }

    if (entry.value === PLACEHOLDER) {
      // Undo emptied the control; put its value back rather than reading the
      // placeholder in as text.
      recompute();
      return;
    }

    if ((plan.specs.get(left)?.format?.kind ?? 'text') === 'text') {
      if (texts.get(left) !== entry.value) {
        texts.set(left, entry.value);
        options.onValuesChanged?.(new Map());
      }
      publish();
      return;
    }

    const parsed = parseValue(entry.value);
    if (parsed !== null && values.get(left) !== parsed) {
      setTokenValue(left, parsed);
      return;
    }

    // The number did not move, but the text may still have lost its
    // formatting — retyping `$175.00` as `175` parses to the same value.
    // Blur is where a token gets its shape back.
    reformat(left, entry.value);
    publish();
  };

  /**
   * A different document is now open. The editor is often ready before its
   * .docx has loaded, so attaching alone would find no tokens — this is what
   * actually picks them up, and it rebuilds the graph from scratch because
   * every id, formula, and wildcard family has just changed.
   */
  const onDocumentChange = (): void => {
    editingId = null;
    refresh();
  };

  /**
   * Double-clicking inside a token selects the CONTROL, which is locked
   * against deletion, so the selection cannot be typed over — the gesture
   * looks broken. Reselect the value itself, excluding the markers, which is
   * what "select the word I clicked" should mean here.
   */
  const onDoubleClick = (): void => {
    const spec = tokenAtCaret(editor);
    if (!spec) return;
    selectTokenValue(editor, spec);
  };

  editor.addEventListener?.('selectionChange', onSelectionChange);
  editor.addEventListener?.('keyDown', onKeyDown);
  editor.addEventListener?.('doubleClick', onDoubleClick);
  editor.addEventListener?.('documentChange', onDocumentChange);
  refresh();

  /**
   * The text a token should be showing right now.
   *
   * A token always matches its value: a number falls back to 0 and text to
   * the empty string unless the field or declaration says otherwise. That is
   * what makes the placeholder undo can leave behind self-correcting.
   */
  const expectedText = (id: string): string => {
    const spec = plan.specs.get(id);
    const kind = spec?.format?.kind ?? 'text';
    if (kind === 'text') return texts.get(id) ?? '';
    return renderValue(values.get(id) ?? 0, spec?.format);
  };

  const recompute = (): TokenState => {
    recalc(plan, values);
    // Offer EVERY token, not just the ones the model moved: the write
    // compares against the document, so this repairs any control whose text
    // drifted from its value — including a placeholder left behind by undo.
    const updates: Array<{ id: string; text: string }> = [];
    for (const id of plan.specs.keys()) {
      if (id === editingId) continue;
      updates.push({ id, text: expectedText(id) });
    }

    applying = true;
    try {
      writeValues(editor, updates, { skipId: editingId ?? undefined });
    } finally {
      applying = false;
    }
    return publish();
  };

  return {
    setTokenValue,
    refresh,
    recompute,
    getState: snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    detach: () => {
      editor.removeEventListener?.('selectionChange', onSelectionChange);
      editor.removeEventListener?.('keyDown', onKeyDown);
      editor.removeEventListener?.('doubleClick', onDoubleClick);
      editor.removeEventListener?.('documentChange', onDocumentChange);
      listeners.clear();
    }
  };
};
