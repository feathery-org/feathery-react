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
 *
 * TODO(docx-tokens): known gaps, kept here so they are not rediscovered the
 * hard way. Detail in docs/superpowers/2026-08-04-docx-linked-tokens-handoff.md.
 *
 * 1. The fuzz harness (tests/fuzz.spec.ts) drives a real editor, but through its
 *    API rather than real mouse and key events, and asserts structure only. Add
 *    value invariants (a settled token's text must be what its owner holds),
 *    more gesture kinds, and more seeds.
 * 2. Redo after undoing a token edit is lost: adopting the restored values
 *    writes to the document, and any write clears Syncfusion's redo stack.
 * 3. Content controls have been seen DUPLICATED after clicking a double-click
 *    selection. Not reproduced: 125 random API-level gestures never broke the
 *    structure, so it probably needs real mouse events. Aiming one at a token
 *    needs on-screen coordinates, which went away with tokenRects.ts — restore
 *    a test-only version to chase it.
 * 4. Editing happens in the document, so any gesture can damage the structure
 *    the whole feature depends on. Making token text read-only and editing
 *    through UI instead would remove that class of bug rather than defend
 *    against each instance.
 * 5. The dev TokenPanel keys rows by `spec.id`, so repeated tokens collide in
 *    its readout — a panel display bug, not an engine one.
 */

import {
  documentShape,
  EditorLike,
  readTokens,
  selectTokenValue,
  shapeViolations,
  showsPlaceholder,
  tokenAtCaret,
  writeValues
} from './controls';
import { evaluate } from './grammar';
import { parseValue, renderValue } from './format';
import {
  deletedRows,
  renumberGroup,
  groupLength,
  growGroup,
  liveTokens,
  repeatGroups,
  rowSnapshot,
  RowSnapshot,
  shrinkGroup
} from './rows';
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

type CycleEditor = EditorLike & {
  addEventListener?: (event: string, handler: (args?: any) => void) => void;
  removeEventListener?: (event: string, handler: (args?: any) => void) => void;
};

/**
 * True while Syncfusion is replaying its own history.
 *
 * Writing into an undo is what turns it destructive: each write pushes a fresh
 * history entry, so the stack never drains, and a write aimed at a document
 * that is mid-restore lands against stale positions and compounds the text
 * (`$800.00` and `7.00` becoming `$800.007.00`). Reading an undo as a user edit
 * is just as wrong — restored text is not something anyone typed.
 */
const isReplayingHistory = (editor: EditorLike): boolean => {
  const history = (editor as any)?.editorHistory;
  return Boolean(history?.isUndoing || history?.isRedoing);
};

/**
 * Keys that can change a token's text: any single character, plus the two
 * deletions. Everything else — arrows, Home/End, Tab, Escape, modifiers — only
 * moves the caret and must not start an undo step.
 */
const CHANGES_CONTENT = /^(.|Backspace|Delete)$/;

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
  // True while an undo action is held open around someone's edit — see
  // openEditStep.
  let editStepOpen = false;
  // The repeat rows the document had when we last looked. A row deleted through
  // the editor's own context menu is spotted by comparing against this, because
  // the token collection still lists the deleted row's controls.
  let lastRows: RowSnapshot = [];
  const listeners = new Set<(state: TokenState) => void>();

  let snapshot: TokenState = {
    specs: [],
    values: new Map(),
    texts: new Map(),
    errors: new Map(),
    invalid: new Map(),
    focused: null
  };

  /**
   * A write damaged the document's structure.
   *
   * Loud on purpose: every corruption this feature has produced was invisible
   * until someone opened a document and noticed a mangled number, so a broken
   * invariant must not pass quietly. The write is already done — Syncfusion has
   * no transaction to roll back — but the token names say exactly what to look
   * at, which is the part that always took hours to work out.
   */
  const reportRepair = (damage: string[]): void => {
    // A warning, not an error: the document is intact again. Still surfaced,
    // because a gesture that needs undoing is a gap worth closing at the source.
    // eslint-disable-next-line no-console
    console.warn(
      `[feathery] undid an edit that would have broken a docx token:\n  ${damage.join(
        '\n  '
      )}`
    );
  };

  const reportViolations = (problems: string[]): void => {
    // eslint-disable-next-line no-console
    console.error(
      `[feathery] docx token write broke the document:\n  ${problems.join(
        '\n  '
      )}`
    );
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

  /**
   * The text a token should show. Numbers default to 0, text to ''.
   *
   * A display transform decides the rendering while the field keeps whatever
   * the reader typed — `UPPER(note)` shows `ACME` over a field holding `acme`,
   * exactly as a currency format shows `$30.00` over `30`.
   */
  const expectedText = (
    key: string,
    texts: Map<string, string>,
    numbers: Map<string, number>
  ): string => {
    const spec = plan.specs.get(key);

    if (spec?.display) {
      try {
        // Display functions work on text, so the raw strings go in alongside
        // the numbers; the numeric evaluator never sees a string because only
        // a display function can reach one.
        const seen = new Map<string, any>(numbers);
        for (const [id, value] of texts) seen.set(id, value);

        // A display formula names the BARE field (`UPPER(description)`), while
        // the values above are keyed by row (`description__0`). Bind this
        // token's own row under its bare name, exactly as a formula's view
        // does — without it every repeated token's transform failed to resolve
        // and fell through to the untransformed text, silently.
        for (const [otherKey, other] of plan.specs) {
          if (other.index !== spec.index) continue;
          const value = texts.get(otherKey) ?? numbers.get(otherKey);
          if (value !== undefined) seen.set(other.id, value);
        }

        return String(evaluate(spec.display, seen));
      } catch {
        // A display that cannot be evaluated must not blank the token — but a
        // text token with no value shows nothing, never the numeric default,
        // or clearing one leaves a literal "0" behind.
        if (isText(spec)) return texts.get(key) ?? '';
        return renderValue(numbers.get(key) ?? 0, spec?.format);
      }
    }

    if (isText(spec)) return texts.get(key) ?? '';
    return renderValue(numbers.get(key) ?? 0, spec?.format);
  };

  /**
   * Hold one undo action open across a whole edit.
   *
   * Typing into a token and the recalculation it causes are one act, so they
   * must revert as one: opening the action when the caret enters a token and
   * closing it after the commit puts the keystrokes and every derived write in
   * the same step. Otherwise Ctrl+Z takes the numbers back but leaves the digits
   * that produced them, which reads as the undo half-working.
   *
   * Opening is idempotent and closing is guaranteed — a stray open action would
   * swallow every later edit into one giant step.
   */
  const openEditStep = (): void => {
    if (editStepOpen || isReplayingHistory(editor)) return;
    editStepOpen = true;
    editor.editorHistory?.beginUndoAction();
  };

  const closeEditStep = (): void => {
    if (!editStepOpen) return;
    editStepOpen = false;
    editor.editorHistory?.endUndoAction();
  };

  /** Whether any appearance of a token is showing a placeholder. */
  const showsPlaceholderFor = (key: string): boolean =>
    liveTokens(editor).some(
      ({ spec, value }) =>
        valueKey(spec) === key &&
        (value === PLACEHOLDER || showsPlaceholder(editor, instanceKey(spec)))
    );

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
    // Rows first: the graph has to know about a row before values are written
    // into it. Skipped mid-edit so a table never restructures under the caret.
    //
    // Flagged as ours for the same reason a write is: adding or removing a row
    // CHANGES the token set, which is exactly what the structure watchdog exists
    // to undo. Without this it reverts our own row and the growth half-lands.
    if (!editingId && !applying && !isReplayingHistory(editor)) {
      applying = true;
      let moved = false;
      try {
        moved = syncRows();
      } catch (err) {
        // Rows are a convenience; the document is not. Driving tables through
        // private editor surface can fail in ways no test reaches, and none of
        // them is worth taking the form down for.
        // eslint-disable-next-line no-console
        console.warn('[feathery] could not sync document rows', err);
      } finally {
        applying = false;
        lastGood = documentShape(editor);
      }
      if (moved) {
        plan = buildPlan(liveTokens(editor).map(({ spec }) => spec));
      }
    }

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

    // The token being edited is normally left alone so the caret is not yanked
    // mid-word — but Syncfusion drops its own placeholder into a control it
    // considers empty, and that text is not a value. A token showing one loses
    // its exemption, so "Click here or tap to insert text" can never stand. A
    // genuinely empty value still waits for blur, which is what keeps a number
    // cleared on the way to typing a new one from being overwritten.
    const skipId =
      editingId && !showsPlaceholderFor(editingId) ? editingId : undefined;

    // Only tokens the document actually carries. The plan also holds seeded
    // input nodes for fields a formula reads but that have no control anywhere
    // (`tax_pct`), and offering those to the write reports them as unreachable
    // every pass.
    const present = new Set(
      liveTokens(editor).map(({ spec }) => valueKey(spec))
    );
    const updates = [...plan.specs.keys()]
      .filter((key) => key !== skipId && present.has(key))
      .map((key) => ({ id: key, text: expectedText(key, texts, numbers) }));

    if (updates.length > 0 && !isReplayingHistory(editor)) {
      applying = true;
      try {
        // Do not open a second action inside the one held around the edit.
        const { missed } = writeValues(editor, updates, {
          skipId,
          group: !editStepOpen,
          onViolation: reportViolations
        });
        // A token the write could not reach shows stale text — or, for one just
        // built, a placeholder — and nothing else says so. Every silent failure
        // in this feature has looked exactly like a token that "unlinked".
        if (missed.length > 0) {
          // eslint-disable-next-line no-console
          console.warn(
            `[feathery] could not write ${
              missed.length
            } docx token(s): ${missed.join(', ')}`
          );
        }
      } finally {
        applying = false;
        // Our writes are legitimate by construction, so the watchdog's baseline
        // moves with them rather than treating them as damage.
        lastGood = documentShape(editor);
      }
    }

    lastRows = rowSnapshot(editor);

    return publish({
      specs: [...plan.specs.values()],
      values: new Map(numbers),
      texts: new Map(texts),
      errors,
      invalid,
      focused: editingId
    });
  };

  /**
   * Take the document's own token text into the stores that own those values.
   *
   * `whenUnset` limits it to tokens the owner holds nothing for, which is what
   * opening an envelope wants — the server rendered values in, and adopting
   * them keeps ownership in one place instead of splitting it.
   *
   * Without that flag the document is treated as authoritative for every input
   * token, which is what an undo needs: Syncfusion has just restored the text
   * the reader asked to get back, and the field has to follow or the next
   * reconcile drags the old value forward again.
   */
  const adoptFromDocument = (options: { whenUnset?: boolean } = {}): void => {
    const adopt = new Map<
      FieldAccess,
      Array<{ spec: TokenSpec; value: TokenValue }>
    >();

    for (const { spec, value } of liveTokens(editor)) {
      if (isComputed(spec) || value === PLACEHOLDER) continue;
      if (showsPlaceholder(editor, instanceKey(spec))) continue;

      const owner = ownerOf(spec);
      const held = owner.read(spec);
      if (options.whenUnset && held !== undefined) continue;

      const parsed = isText(spec) ? value : parseValue(value);
      if (parsed === null || parsed === undefined || parsed === '') continue;
      if (held === parsed) continue;

      const pending = adopt.get(owner) ?? [];
      pending.push({ spec, value: parsed });
      adopt.set(owner, pending);
    }

    for (const [owner, updates] of adopt) owner.write(updates);
  };

  /**
   * Bring the document's repeat rows in step with the fields, then rebuild.
   *
   * The document is a view of the field: however many rows the field holds is
   * how many the table shows. Growing builds the missing rows from the last one
   * as a template; shrinking drops the surplus off the end, which is what keeps
   * every surviving row's index correct.
   */
  const syncRows = (): boolean => {
    if (typeof fields.rowCount !== 'function') return false;
    let structural = false;

    for (const group of repeatGroups(editor)) {
      const lengths = group.sources
        .map((source) => fields.rowCount?.(source))
        .filter((count): count is number => typeof count === 'number');
      if (lengths.length === 0) continue;

      const target = Math.max(...lengths);
      const current = groupLength(group);
      // Never collapse a repeat to nothing: the last row is the template every
      // later row is built from, and a table with no token rows cannot grow back.
      if (target === current || target < 1) continue;

      const { texts, numbers } = derive();
      const changed =
        target > current
          ? growGroup(editor, group, target, (spec) =>
              expectedText(valueKey(spec), texts, numbers)
            ).length > 0
          : shrinkGroup(editor, group, target).length > 0;
      structural = structural || changed;
    }

    return structural;
  };

  /** Re-read the document and rebuild the graph. */
  const refresh = (): TokenState => {
    plan = buildPlan(liveTokens(editor).map(({ spec }) => spec));
    adoptFromDocument({ whenUnset: true });
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
    if (applying || isReplayingHistory(editor)) return;

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

    try {
      const entry = readTokens(editor).find(
        (t) => instanceKey(t.spec) === leftInstance
      );
      // A control emptied by undo shows the placeholder; reconciling puts its
      // value back instead of reading that in as content.
      if (!entry || entry.value === PLACEHOLDER) reconcile();
      else setTokenValue(leftId, entry.value);
    } finally {
      // The edit is committed and its dependents written, so the step is done.
      closeEditStep();
    }
  };

  /**
   * The last document state whose token structure was intact, so a damaging
   * edit can be told from an ordinary one and rolled back. Structure only —
   * values move constantly and are none of this concern.
   */
  let lastGood: ReturnType<typeof documentShape> | null = null;
  let repairing = false;

  /**
   * Revert any edit that damages the token structure.
   *
   * Checking our own writes was never enough: the damage a reader hits comes
   * from editing AROUND a token — typing at its edge, deleting across it,
   * pasting over it — where Syncfusion will merge two controls, drop a
   * control's markers, or duplicate it. None of that goes through `writeValues`,
   * so nothing was watching.
   *
   * Rather than enumerate the dangerous gestures, this watches the outcome: if
   * the set of controls is not what it was, the edit is undone. That covers keys
   * nobody thought of, and paste, cut and drag alike, and it fails safe — the
   * reader loses one keystroke instead of the document losing a token, which
   * cannot be rebuilt (`insertContentControl` is a no-op).
   *
   * Values are deliberately not defended: changing a token's text is exactly
   * what the reader is here to do, and the blur commit decides what it means.
   */
  const guardStructure = (): void => {
    if (repairing) return;
    const now = documentShape(editor);
    if (!lastGood) {
      lastGood = now;
      return;
    }

    // Only the address multiset matters: the same tokens, the same number of
    // times each.
    const structureOnly = (shape: typeof now) => ({
      addresses: shape.addresses,
      text: new Map<string, string>()
    });
    const damage = shapeViolations(
      structureOnly(lastGood),
      structureOnly(now),
      new Set()
    );
    if (damage.length === 0) {
      lastGood = now;
      return;
    }

    repairing = true;
    try {
      (editor as any).editorHistory?.undo?.();
      const repaired = documentShape(editor);
      const left = shapeViolations(
        structureOnly(lastGood),
        structureOnly(repaired),
        new Set()
      );
      if (left.length === 0) {
        reportRepair(damage);
      } else {
        // The undo did not put it back. Stop fighting rather than undoing the
        // reader's earlier work too, and accept the document as it now stands.
        lastGood = repaired;
        reportViolations([
          ...damage,
          'and the undo did not restore it',
          ...left
        ]);
      }
    } finally {
      repairing = false;
    }
  };

  /**
   * An undo or redo has changed the document, so move the fields to match.
   *
   * The reader asked for the text Syncfusion just restored, so that text is the
   * truth for this moment. To the field it is an ordinary change — from what it
   * holds now to the undone value — which is why nothing here needs a history
   * of its own to stay in step with Syncfusion's.
   *
   * Deferred by a task because the replay is still running when this fires;
   * reading now would take half-restored text. Coalesced, because a single undo
   * emits several of these.
   */
  /**
   * A row deleted in the editor has to leave the field, not just the page.
   *
   * The reader used the table's own context menu, so the document is already
   * short a row; splicing the field is what stops the next sync putting it back.
   * Highest index first, so each splice leaves the lower ones still valid.
   */
  const adoptRowDeletions = (): boolean => {
    if (typeof fields.removeRow !== 'function') return false;
    // Nothing to compare against yet: the first read establishes the baseline
    // rather than reading an empty document as "every row was deleted".
    if (lastRows.length === 0) return false;
    const gone = deletedRows(lastRows, rowSnapshot(editor));
    if (gone.length === 0) return false;

    for (const { sources, indexes } of gone) {
      const backed = sources.filter(Boolean);
      if (backed.length === 0) continue;
      for (const index of [...indexes].sort((a, b) => b - a)) {
        fields.removeRow?.(backed, index);
      }
    }

    // Close the gap the deletion left. Deleting the middle of {0,1,2} leaves controls tagged
    // 0 and 2 over a field now holding two values, so the survivor reads
    // nothing — and the adopt that follows would take its own text back INTO
    // the field, undoing the splice. Renumbering restores index == array
    // position, which every read and write depends on.
    for (const group of repeatGroups(editor)) renumberGroup(editor, group);

    return true;
  };

  let adoptScheduled = false;
  const onContentChange = (): void => {
    if (applying) return;
    if (!isReplayingHistory(editor)) {
      if (adoptRowDeletions()) {
        lastRows = rowSnapshot(editor);
        refresh();
        return;
      }
      guardStructure();
      return;
    }
    if (adoptScheduled) return;
    adoptScheduled = true;
    setTimeout(() => {
      adoptScheduled = false;
      adoptFromDocument();
      reconcile();
    }, 0);
  };

  /** A different document is open: nothing carries over. */
  const onDocumentChange = (): void => {
    closeEditStep();
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

    // The undo step opens on the first keystroke that could change something,
    // not when the caret arrives: opening on arrival meant every caret move
    // through a token left an empty undo entry behind, which buried real edits
    // and threw away the redo path.
    if (CHANGES_CONTENT.test(key ?? '')) openEditStep();

    // An already-empty token swallows Backspace and Delete. The keystroke would
    // otherwise carry on past the value and consume the content control's own
    // markers, and a destroyed control cannot be rebuilt — `insertContentControl`
    // is a no-op — so the token would be gone for the rest of the session.
    // Clearing a value is fine; deleting THROUGH it is not.
    if (key === 'Backspace' || key === 'Delete') {
      const here = readTokens(editor).find(
        (t) => instanceKey(t.spec) === instanceKey(caretSpec)
      );
      if (here && (here.value === '' || here.value === PLACEHOLDER)) {
        args?.event?.preventDefault?.();
        if (args) args.isHandled = true;
      }
      return;
    }

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
      try {
        if (entry && entry.value !== PLACEHOLDER)
          setTokenValue(id, entry.value);
        else reconcile();
      } finally {
        closeEditStep();
      }
      return;
    }

    // Escape: the owner never took the edit, so reconciling restores it.
    editingInstance = null;
    editingId = null;
    try {
      reconcile();
    } finally {
      closeEditStep();
    }
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
  editor.addEventListener?.('contentChange', onContentChange);
  editor.addEventListener?.('keyDown', onKeyDown);

  // SyncFusion emits no double-click event of its own — measured, the name is
  // absent from its typings — so the canvas it paints into is the only path, a
  // frame later so the reselect lands after SyncFusion's own handling.
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
      // Leaving an action open would swallow every later edit into one step.
      closeEditStep();
      editor.removeEventListener?.('selectionChange', onSelectionChange);
      editor.removeEventListener?.('documentChange', onDocumentChange);
      editor.removeEventListener?.('contentChange', onContentChange);
      editor.removeEventListener?.('keyDown', onKeyDown);
      surface?.removeEventListener?.('dblclick', onDomDoubleClick);
      listeners.clear();
    }
  };
};
