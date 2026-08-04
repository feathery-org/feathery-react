/**
 * Keeps a document's tokens in step with the form's field values.
 *
 * There is ONE owner per token. A field-backed token's value lives in the form
 * engine's field store — read through the injected accessor, written through
 * the same update path the rendered inputs use — so the document is a view of
 * the submission rather than a second copy of it. Only in-memory tokens (a
 * line total, a subtotal) are owned here, because nothing else owns them.
 *
 * That single-owner rule is the whole design. Every propagation bug this
 * replaced came from two stores disagreeing: a value updated in one place and
 * not the other, an appearance left stale, an early return skipping a write.
 * With one owner there is nothing to reconcile but the document:
 *
 *      field change ──┐
 *      document edit ─┼──→ reconcile() ──→ recalc computed values
 *      panel edit ────┤                    write every token whose
 *      assistant op ──┘                    document text is stale
 *
 * `reconcile()` is idempotent — it derives everything from the current inputs
 * and writes only what the document does not already show — so calling it more
 * often than strictly necessary is free and can never lose an edit.
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
  instanceKey,
  Plan,
  recalc,
  TokenSpec,
  validationErrors,
  valueKey
} from './plan';

/**
 * SyncFusion's placeholder for an emptied content control. Undo can leave a
 * token showing this, so it reads as "no value" rather than as content.
 */
const PLACEHOLDER = 'Click here or tap to insert text';

/** A token's value as the form engine holds it. */
export type TokenValue = number | string;

/**
 * How the cycle reaches the form's field values.
 *
 * Injected rather than imported, so this module stays free of SDK internals
 * and testable without a form. The host supplies the same read and write paths
 * the rendered inputs use, which is what makes a token and its field
 * indistinguishable to the rest of the form.
 */
export type FieldAccess = {
  /** The field value behind a token, or undefined when it has none. */
  read: (spec: TokenSpec) => TokenValue | undefined;
  /** Write field values, batched so one update covers every token that moved. */
  write: (updates: Array<{ spec: TokenSpec; value: TokenValue }>) => void;
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

type CycleEditor = EditorLike & {
  addEventListener?: (event: string, handler: (args?: any) => void) => void;
  removeEventListener?: (event: string, handler: (args?: any) => void) => void;
};

const isText = (spec?: TokenSpec): boolean =>
  (spec?.format?.kind ?? 'text') === 'text';

const isComputed = (spec?: TokenSpec): boolean => Boolean(spec?.formula);

/** Holds values for tokens no field owns. */
const memoryStore = (): FieldAccess => {
  const held = new Map<string, TokenValue>();
  return {
    read: (spec) => held.get(valueKey(spec)),
    write: (updates) =>
      updates.forEach(({ spec, value }) => held.set(valueKey(spec), value))
  };
};

export const attachTokenCycle = (
  editor: CycleEditor,
  options: { fields?: FieldAccess } = {}
): TokenCycle => {
  // Without a host the cycle still works, holding field values in memory —
  // used by tests and by a document opened outside a form.
  const fields = options.fields ?? memoryStore();
  const memory = memoryStore();

  let plan: Plan = buildPlan([]);
  // The APPEARANCE being edited, not the value: two controls can carry the
  // same token, and moving between them must still commit the first.
  let editingInstance: string | null = null;
  let editingId: string | null = null;
  let applying = false;
  const listeners = new Set<(state: TokenState) => void>();

  let snapshot: TokenState = {
    specs: [],
    values: new Map(),
    texts: new Map(),
    errors: new Map(),
    invalid: new Map(),
    focused: null
  };

  /** Where a token's value lives: its field, or here. */
  const ownerOf = (spec: TokenSpec): FieldAccess =>
    spec.source ? fields : memory;

  /** The current input values, each from whichever store owns it. */
  const inputValues = (): Map<string, TokenValue> => {
    const values = new Map<string, TokenValue>();
    for (const [key, spec] of plan.specs) {
      if (isComputed(spec)) continue;
      const value = ownerOf(spec).read(spec);
      if (value === undefined || value === null || value === '') continue;
      values.set(key, value);
    }
    return values;
  };

  /**
   * Derive every token's value from the current inputs.
   *
   * Numbers and text stay apart: only numbers enter the formula graph, so a
   * text token can never be coerced into one and blanked.
   */
  const derive = () => {
    const texts = new Map<string, string>();
    const numbers = new Map<string, number>();

    for (const [key, value] of inputValues()) {
      if (isText(plan.specs.get(key))) {
        texts.set(key, String(value));
        continue;
      }
      const parsed = typeof value === 'number' ? value : parseValue(value);
      if (parsed !== null) numbers.set(key, parsed);
    }

    const { errors } = recalc(plan, numbers);
    return { texts, numbers, errors };
  };

  /** The text a token should show. Numbers default to 0, text to ''. */
  const expectedText = (
    key: string,
    texts: Map<string, string>,
    numbers: Map<string, number>
  ): string => {
    const spec = plan.specs.get(key);
    if (isText(spec)) return texts.get(key) ?? '';
    return renderValue(numbers.get(key) ?? 0, spec?.format);
  };

  const publish = (state: TokenState): TokenState => {
    snapshot = state;
    listeners.forEach((listener) => listener(state));
    return state;
  };

  /**
   * Bring the document in step with the current values.
   *
   * Offers every token to the write, which compares each appearance against
   * the document — so this settles derived values, restores formatting, and
   * repairs a control left showing its placeholder, all in one pass.
   */
  const reconcile = (): TokenState => {
    const { texts, numbers, errors } = derive();

    // A token mid-edit has no verdict yet: deleting a value on the way to
    // typing a new one must not flash as invalid.
    const invalid = editingId
      ? new Map(
          [...validationErrors(plan, numbers)].filter(
            ([key]) => key !== editingId
          )
        )
      : validationErrors(plan, numbers);

    const updates = [...plan.specs.keys()]
      .filter((key) => key !== editingId)
      .map((key) => ({ id: key, text: expectedText(key, texts, numbers) }));

    if (updates.length > 0) {
      applying = true;
      try {
        writeValues(editor, updates, { skipId: editingId ?? undefined });
      } finally {
        applying = false;
      }
    }

    return publish({
      specs: [...plan.specs.values()],
      values: new Map(numbers),
      texts: new Map(texts),
      errors,
      invalid,
      focused: editingId
    });
  };

  /** Re-read the document and rebuild the graph. */
  const refresh = (): TokenState => {
    const entries = readTokens(editor);
    plan = buildPlan(entries.map(({ spec }) => spec));

    // A freshly opened envelope carries the values the server rendered into
    // it. Whichever store owns a token ADOPTS its document value when it has
    // none of its own — so opening a document never blanks it, and ownership
    // still ends up in one place rather than being split.
    const adopt = new Map<
      FieldAccess,
      Array<{ spec: TokenSpec; value: TokenValue }>
    >();
    for (const { spec, value } of entries) {
      if (isComputed(spec) || value === PLACEHOLDER) continue;

      const owner = ownerOf(spec);
      if (owner.read(spec) !== undefined) continue;

      const parsed = isText(spec) ? value : parseValue(value);
      if (parsed === null || parsed === undefined || parsed === '') continue;

      const pending = adopt.get(owner) ?? [];
      pending.push({ spec, value: parsed });
      adopt.set(owner, pending);
    }
    for (const [owner, updates] of adopt) owner.write(updates);

    return reconcile();
  };

  /**
   * Apply a value for one token.
   *
   * A field-backed token is written through the form's own update path, so the
   * submission and every other consumer of that field see it too.
   */
  const setTokenValue = (id: string, raw: TokenValue): TokenState => {
    const spec = plan.specs.get(id);
    if (!spec || isComputed(spec)) return snapshot;

    if (isText(spec)) {
      ownerOf(spec).write([{ spec, value: String(raw) }]);
      return reconcile();
    }

    // An unparseable edit is not the same as having no value: keep what the
    // owner holds rather than destroying it. A token with genuinely no value
    // still renders as 0 — see expectedText.
    const parsed = typeof raw === 'number' ? raw : parseValue(raw);
    if (parsed === null) return reconcile();

    ownerOf(spec).write([{ spec, value: parsed }]);
    return reconcile();
  };

  /**
   * Read a token the caret has left back into its owner.
   *
   * Committing on blur rather than on a timer means the document is never
   * rewritten under someone mid-word, and blur is when a value is finished.
   */
  const onSelectionChange = (): void => {
    if (applying) return;

    const caretSpec = tokenAtCaret(editor);
    const current = caretSpec ? instanceKey(caretSpec) : null;
    if (current === editingInstance) return;

    const leftInstance = editingInstance;
    const leftId = editingId;
    editingInstance = current;
    editingId = caretSpec ? valueKey(caretSpec) : null;

    if (leftInstance === null || leftId === null) {
      publish({ ...snapshot, focused: editingId });
      return;
    }

    const entry = readTokens(editor).find(
      (t) => instanceKey(t.spec) === leftInstance
    );
    // A control emptied by undo shows the placeholder; reconciling puts its
    // value back instead of reading that in as content.
    if (!entry || entry.value === PLACEHOLDER) {
      reconcile();
      return;
    }

    setTokenValue(leftId, entry.value);
  };

  /** A different document is open: nothing carries over. */
  const onDocumentChange = (): void => {
    editingInstance = null;
    editingId = null;
    refresh();
  };

  /**
   * A number token refuses characters it could never hold — cheaper and
   * clearer than repairing the text afterwards.
   */
  const onKeyDown = (args: any): void => {
    const key = args?.event?.key ?? args?.key;
    const caretSpec = tokenAtCaret(editor);
    if (!caretSpec) return;

    const id = valueKey(caretSpec);
    const spec = plan.specs.get(id);

    if (
      key &&
      key.length === 1 &&
      !args?.event?.metaKey &&
      !args?.event?.ctrlKey &&
      !isText(spec) &&
      !/[0-9.,\-$%]/.test(key)
    ) {
      args?.event?.preventDefault?.();
      if (args) args.isHandled = true;
      return;
    }

    if (key !== 'Enter' && key !== 'Escape') return;
    args?.event?.preventDefault?.();
    if (args) args.isHandled = true;

    if (key === 'Enter') {
      const instance = instanceKey(caretSpec);
      const entry = readTokens(editor).find(
        (t) => instanceKey(t.spec) === instance
      );
      editingInstance = null;
      editingId = null;
      if (entry && entry.value !== PLACEHOLDER) setTokenValue(id, entry.value);
      else reconcile();
      return;
    }

    // Escape: the owner never took the edit, so reconciling restores it.
    editingInstance = null;
    editingId = null;
    reconcile();
  };

  /**
   * Double-clicking selects the CONTROL, which is locked against deletion, so
   * the selection cannot be typed over. Select the value instead.
   */
  const onDoubleClick = (): void => {
    const spec = tokenAtCaret(editor);
    if (spec) selectTokenValue(editor, spec);
  };

  editor.addEventListener?.('selectionChange', onSelectionChange);
  editor.addEventListener?.('documentChange', onDocumentChange);
  editor.addEventListener?.('keyDown', onKeyDown);
  editor.addEventListener?.('doubleClick', onDoubleClick);

  // SyncFusion exposes no double-click event, so listen on the canvas it
  // paints into, a frame later so the reselect lands after its own.
  const surface: any = (editor as any)?.documentHelper?.viewerContainer;
  const onDomDoubleClick = () => setTimeout(onDoubleClick, 0);
  surface?.addEventListener?.('dblclick', onDomDoubleClick);

  refresh();

  return {
    setTokenValue,
    refresh,
    reconcile,
    getState: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    detach: () => {
      editor.removeEventListener?.('selectionChange', onSelectionChange);
      editor.removeEventListener?.('documentChange', onDocumentChange);
      editor.removeEventListener?.('keyDown', onKeyDown);
      editor.removeEventListener?.('doubleClick', onDoubleClick);
      surface?.removeEventListener?.('dblclick', onDomDoubleClick);
      listeners.clear();
    }
  };
};
