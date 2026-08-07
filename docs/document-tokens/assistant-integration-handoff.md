# Assistant ↔ document tokens — integration handoff

**Audience:** the engineer wiring Feathery's AI assistant to the live-document-
token system so it can create and manage tokens on a user's behalf.

**Status:** the token *runtime* (reconcile cycle, formula graph, row sync, the
Syncfusion write path) is built and covered by tests. A *value* API the
assistant can call today exists (`setTokenValue`). A structural **add / edit /
delete token** API for the assistant does **not** yet exist as a public surface
— the primitives are here, the wrapper is not. This document gives you the
mental model, the exact data model, the surface that exists, and what you'll
need to add.

Everything below is grounded in `src/documentTokens/`. File and symbol
references are exact; line numbers are approximate anchors as of this writing.

---

## 1. Mental model

```
   field change ──┐
   document edit ─┼──→ reconcile() ──→ recalc computed values ──→ write only
   panel edit ────┤                     the tokens whose document text is stale
   assistant op ──┘
```

Five things and their relationships:

- **Field** — a form field, owned by the form engine. The single source of
  truth for a field-backed token's value.
- **Token** — an appearance in the document (a Syncfusion content control)
  carrying a `TokenSpec`. Many appearances can share one value.
- **Value** — the number or string behind a token. A field-backed token's value
  lives in the field store; a memory token's lives in an in-memory store the
  cycle owns.
- **Formula** — an expression on a computed token, recomputed from other values
  in dependency order.
- **Format** — how a value is rendered to text (`currency`/`number`/`percent`/
  `text`) plus optional display transforms (`UPPER`/`LOWER`/`TITLE`/`TRIM`).

**The single-owner rule is the whole design.** There is exactly one owner per
value. The document is a *view*; the cycle never keeps a second copy of a field
value. Every propagation bug this replaced came from two stores disagreeing.

### The reconcile cycle

`reconcile()` (`tokenCycle.ts:371`) is the heart. It is **idempotent** — it
derives everything from current inputs and writes only what the document does
not already show — so calling it more often than necessary is free and can never
lose an edit. One pass does, in order:

1. **syncRows** (`tokenCycle.ts:549`) — bring the document's repeat rows in step
   with the fields' arrays (grow/shrink). Gated so it never runs mid-keystroke.
2. **derive** (`tokenCycle.ts:265`) — read every input value from its owner,
   parse numbers, run `recalc` over the plan to compute formula tokens.
3. **writeValues** (`controls.ts:504`) — for every token present in the
   document, compare its expected text against what the control shows and write
   only the differences, as one undo step.

**Sync directions:**

- **field → document:** a field change re-renders the host, which calls
  `reconcile()`; derived values recompute and stale controls are rewritten.
- **document → field:** a reader edits a token; on blur/Enter the cycle reads
  the control's text and writes it to the owner (`setTokenValue`).
- **document → field on undo:** during Syncfusion history replay the cycle
  *adopts* the restored text into the fields (see §5, `adoptFromDocument`).

**Seeding / precedence:** on the first read of a token this attach,
`seedDefault` (`tokenCycle.ts:229`) writes the authored `default` into the owner
**once** (`seededDefaults` set guards it). `DEFAULT_WINS = true`
(`tokenCycle.ts:118`) means the default is written even over an existing value on
open; after that first seed, the field wins and a cleared value stays cleared.

---

## 2. Data model

### `TokenSpec` (`plan.ts:33`)

The exact shape carried by every token, both in memory and on disk:

```ts
type TokenSpec = {
  id: string;                 // the authored name; a field key when one matches
  index?: number | null;      // row of a repeated field; absent/null for a scalar
  source?: string | null;     // field key when field-backed; absent for memory tokens
  formula?: string | null;    // expression for computed tokens; absent for inputs
  display?: string | null;    // a display transform, e.g. "UPPER(note)"
  reads?: string[] | null;    // field keys a formula reads that have no token of their own
  instance?: string;          // address of THIS appearance (a token may appear many times)
  default?: string | number;  // author fallback; only meaningful for a field-backed token
  format?: TokenFormat;       // { kind: 'currency'|'number'|'percent'|'text'; decimals?: number }
  validate?: TokenValidation; // { min?: number; max?: number; required?: boolean }
};
```

Two derived keys you will use constantly (`plan.ts:66`, `plan.ts:72`):

- **`valueKey(spec)`** identifies a **value**: `id` for a scalar, `` `${id}__${index}` ``
  for a repeated row (e.g. `qty__2`). One value key, shared by every appearance.
- **`instanceKey(spec)`** identifies an **appearance**: `spec.instance` if set,
  else the value key. A token used twice in one row carries a `#N` suffix
  (e.g. `qty__2#1`) so both controls stay separately addressable.

### The on-disk content-control tag (`controls.ts`)

A token is identified, read, and written entirely through its Syncfusion content
control's **tag**. The tag is:

```
ftk:<compact JSON of the TokenSpec>
```

- `TAG_PREFIX = 'ftk:'` (`controls.ts:14`). Any control whose tag starts with
  `ftk:` is ours; everything else is left untouched.
- `encodeTag(spec)` = `` `ftk:${JSON.stringify(spec)}` `` (`controls.ts:93`).
- `decodeTag(tag)` parses it back, returning `null` for a foreign or malformed
  tag, or when the decoded object has no string `id` (`controls.ts:96`).

A real tag (from `tokenSpecCases.json`, a repeated numeric field):

```
ftk:{"id":"qty","format":{"kind":"number"},"instance":"qty__2","index":2,"source":"qty"}
```

A derived scalar's second appearance:

```
ftk:{"id":"subtotal","format":{"kind":"currency"},"instance":"subtotal#1","formula":"SUM(item_total)"}
```

> The backend emits this JSON with a fixed key order and compact separators
> (`declare._spec()`), and `token_spec_cases.json` is a **shared contract** with
> a duplicate in `feathery-backend`. If you construct specs on the JS side, key
> order does not matter for `decodeTag` (it's `JSON.parse`), but a value
> formatted on the server and reformatted here must agree — keep `format.ts` and
> the backend `format.py` in step.

There is also a bookmark, `bookmarkFor(id)` = `` `ftk_${id}` `` (`controls.ts:35`),
used only as a fallback address; the durable address is the control itself.

### How `index` works for repeated rows

- A repeated field is one field key holding an array. Row `i` of the table binds
  to array element `i` — **`index === array position`**, invariantly. Every read
  and write goes through that number.
- `valueKey` folds the index in (`qty__0`, `qty__1`, …). A formula in a row
  resolves bare names to that row's value keys (`plan.ts:95`, `edgesFor`).
- A scalar formula naming a repeated token sees the whole column as a list, which
  is how `SUM(item_total)` aggregates it (`plan.ts:250`, `viewFor`).
- After a middle-row deletion, survivors are **renumbered** back to `0..n-1`
  (`rows.ts:392`, `renumberGroup`) or the field array and the controls drift out
  of alignment.

---

## 3. The management surface

### What exists: the `attachTokenCycle` API

`attachTokenCycle(editor, { fields })` (`tokenCycle.ts:140`) attaches the cycle
to a live Syncfusion editor and returns a `TokenCycle` (`cycleTypes.ts:53`):

```ts
type TokenCycle = {
  setTokenValue: (id: string, raw: TokenValue) => TokenState; // id is a valueKey
  refresh:  () => TokenState;   // re-read document, rebuild the plan (structural change)
  reconcile: () => TokenState;  // bring document in step with current values (idempotent)
  getState: () => TokenState;   // current snapshot, no side effects
  subscribe: (listener: (state: TokenState) => void) => () => void;
  detach:  () => void;
};
```

- Attaching **supersedes** any prior cycle on that editor — two cycles fight
  (`activeCycle` WeakMap, `tokenCycle.ts:138`). One cycle per editor.
- `options.fields` is a `FieldAccess` (`cycleTypes.ts:20`): `read`, `write`, and
  optional `rowCount` / `removeRow`. The host in
  `DocumentEditorContainer.tsx:70` (`formFieldAccess`) wires these to the form
  engine's `fieldValues` / `setFieldValues`. Omit it and the cycle holds values
  in memory (used by tests).
- `TokenState` (`cycleTypes.ts:39`): `specs`, `values` (numeric, by value key),
  `texts`, `errors` (formula/cycle failures), `invalid` (validation), `focused`.
- `saveBlockers(state)` (`cycleTypes.ts:73`) returns a message when validation or
  formula errors must stop a save; the host calls it before saving the envelope.

**The assistant's value ops should land on `setTokenValue` exactly as a panel
edit does** — never write the document directly. `setTokenValue(valueKey, raw)`
(`tokenCycle.ts:601`) writes through the owner and reconciles; it ignores
computed tokens, coerces text vs. number by format, and refuses an unparseable
numeric edit rather than zeroing the token.

### What does NOT exist yet: structural add / edit / delete

There is **no public `addToken` / `editToken` / `deleteToken`** on `TokenCycle`.
The primitives to build them are all in `controls.ts` and `rows.ts`, and
`rows.ts:growGroup` already demonstrates the full create-a-token sequence. Below
is what each operation must do and the functions it must go through.

#### Insert a new token / content control

The proven sequence (as done per-token inside `growGroup`, `rows.ts:194`):

1. Position the selection where the token goes (`selectParagraph` /
   `selectCell`, `controls.ts:159`).
2. `insertUntaggedControl(editor)` (`controls.ts:191`) — the **string** form
   `insertContentControl('Text')` creates a control; the object form no-ops.
   The selected text is **discarded** and Word's placeholder inserted.
3. Find the freshly built untagged control by identity (it is *not* the last
   entry in the collection — the collection is in document order). `growGroup`
   scopes the search to the target row/paragraph to avoid retagging a foreign
   untagged control.
4. Assign its properties:
   ```ts
   built.contentControlProperties.tag = encodeTag(spec);   // ftk:{…}
   built.contentControlProperties.title = spec.id;
   built.contentControlProperties.lockContents = Boolean(spec.formula); // computed = read-only
   built.contentControlProperties.lockContentControl = true;            // not deletable by reader
   ```
5. Write the initial value through `writeValues` (`controls.ts:504`), then call
   `cycle.refresh()` so the plan is rebuilt and the graph re-derived.

**What the assistant must supply to create a token:** the `id` (and, for a
field-backed token, `source` = the field key); optional `default`; optional
`formula` (a string the grammar can parse — see `grammar.ts`); optional `format`
(`{ kind, decimals? }`); and, for a repeated token, `index`. `reads` (field keys
a formula touches that have no token) should be filled for a formula so the value
moves when those fields change — the backend computes this via
`dependencies(parse(formula))`; you can do the same with `grammar.ts`'s
`dependencies` + `parse`.

> A structural insert changes the token set, which is exactly what the structure
> watchdog (§5) exists to undo. Any assistant-driven insert must be flagged as
> "ours" the same way reconcile's writes are (set `applying` / re-baseline the
> watchdog), or the watchdog will revert it. Today there is no public hook to do
> that from outside the cycle — this is part of what you'll add (§6).

#### Edit a token's binding / formula / format

A token's identity and behaviour live entirely in its tag. To rebind, re-formula,
or reformat: find the control by `instanceKey`, build the new `TokenSpec`,
re-encode:

```ts
control.contentControlProperties.tag = encodeTag({ ...oldSpec, formula: 'qty * cost * 1.1' });
control.contentControlProperties.lockContents = Boolean(newSpec.formula);
```

then `cycle.refresh()` (a formula/binding change is **structural** — it rebuilds
the plan). Changing only a `format` still needs a `refresh` for the spec to
propagate, but no graph topology changes.

`controlCollection(editor)` (`controls.ts:148`) and `decodeTag` are your read
path; `readTokens(editor)` (`controls.ts:212`) gives you `{ spec, value }[]` in
document order, already dropping controls whose row was deleted.

#### Delete a token

This is the thinnest primitive today. Note the mechanics measured in the code:

- `deleteRow` / a detached control leaves the control **in the collection** still
  carrying its tag (`rows.ts` comments). The truthful "is this token gone" test
  is `isDetached(control)` (`controls.ts:141`) — by widget identity, not stored
  index.
- **Tombstoning** is the cleanup mechanism: `tombstoneDetached(editor)`
  (`rows.ts:53`) clears the `tag` off every detached control (`tag = ''`), so
  address lookups and renumbering ignore the zombie and exactly one live control
  remains per address. This is what handles the **freed-index** problem — a later
  grow onto a freed index would otherwise collide with the zombie.
- There is **no `removeContentControl` wrapper** in `controls.ts`. The design
  spec notes `editor.removeContentControl()` as a `@private` gap to be isolated
  here. To truly delete a *scalar* token's control (not a row), you either add
  that wrapper, or clear its value (a delete of the selected range, as
  `writeValues` does for empty text) and clear its tag — but the locked control
  itself will linger unless you call the private removal API.
- The reader **cannot** delete a token by keystroke: `lockContentControl` blocks
  it, and `onKeyDown` (`tokenCycle.ts:752`) swallows Backspace/Delete on an
  already-empty token so the control's markers can't be eaten (a destroyed
  control cannot be rebuilt — `insertContentControl` is a no-op on an object).

#### Rows: programmatic vs. field-driven

- **Field-driven (preferred):** change the field array and let the cycle sync.
  `syncRows` (`tokenCycle.ts:549`) grows/shrinks to `fields.rowCount(source)` on
  the next reconcile. Adding an array element grows a row; removing one shrinks
  from the end. This is the path the assistant should prefer — go through
  `setFieldValues` / the field, not the table.
- **Programmatic (low-level):** `growGroup` / `shrinkGroup` / `renumberGroup`
  (`rows.ts`) drive the table directly. These are internal to the reconcile
  pass; calling them from outside means owning the `applying` flag and watchdog
  baseline yourself. Prefer the field-driven path.
- **Editor-side row delete → field:** when a reader deletes a row via Word's
  menu, `adoptRowDeletions` (`tokenCycle.ts:683`) diffs the row snapshot,
  splices the field via `fields.removeRow`, tombstones the zombies, and
  renumbers. You get this for free.

---

## 4. Where the assistant plugs in

The host wiring already exists in
`src/elements/components/DocxEditor/DocumentEditorContainer.tsx`:

- On editor-ready it calls `registerDocxEditor(containerId, editor, {…})`
  (`docxEditorRegistry.ts`) and `attachTokenCycle(editor, { fields: formFieldAccess })`.
- The assistant's existing docx tools resolve the live editor through
  `getActiveDocxEditorTarget` / `getDocxEditor` in
  `src/assistant/tools/docxEditorRegistry.ts`, and there is an existing family of
  docx ops under `src/assistant/tools/` (`docxEditorBridge.ts`,
  `syncfusionDocumentOps.ts`, etc.).

Critically, **the registry hands out the raw `editor`, not the `TokenCycle`.**
The cycle is held in a `useRef` inside `DocumentEditorContainer` and is not
currently exposed to the assistant layer. Bridging that ref (or the cycle's
methods) to the registry is the main integration seam — see §6.

---

## 5. Constraints & gotchas the integration must respect

- **Never write while `applying` is true.** The cycle sets `applying`
  (`tokenCycle.ts`) around its own writes and row syncs; selection/content events
  are swallowed during it. An external write racing a reconcile corrupts state.
  Any assistant write must cooperate with this flag.
- **Never write during Syncfusion history replay.** `isReplayingHistory`
  (`tokenCycle.ts:94`) guards every write. Writing into an undo turns it
  destructive: each write pushes a fresh history entry so the stack never drains,
  and a write against mid-restore positions compounds text
  (`$800.00` + `7.00` → `$800.007.00`).
- **Focus preservation is the host's job — but your writes can break it.**
  Writing into the document steals focus to Syncfusion's hidden input. The host
  (`DocumentEditorContainer.tsx`, `reconcileKeepingFormFocus`) defers reconciles
  and restores the form input's caret afterward. If the assistant triggers a
  write while a user is typing in a form field, it must go through the same
  deferred, focus-restoring path — do not call `reconcile()` synchronously from
  an assistant op that fires mid-typing.
- **Number tokens reject non-numeric input** at the keystroke (`onKeyDown`,
  `tokenCycle.ts:782`) and `setTokenValue` ignores an unparseable numeric edit
  rather than zeroing (`tokenCycle.ts:613`). If the assistant sets a numeric
  token, pass a number or a parseable string (`parseValue` in `format.ts` strips
  `$`, `,`, `%`).
- **Format defaults to `text`** when a spec has no `format`
  (`format.ts:34`, `renderValue`). A `text` token is never reformatted and shows
  the raw value; a numeric token with no value renders its `0` fallback. Don't
  assume an unformatted token is numeric.
- **The doc-edit write-back only runs under history replay.** `adoptFromDocument`
  without `whenUnset` treats the document as authoritative and is called only
  from the deferred replay handler (`onContentChange`, `tokenCycle.ts:715`).
  Ordinary reader edits commit on **blur/Enter** via `onSelectionChange` /
  `onKeyDown`, not continuously.
- **The structure watchdog will undo unexpected structural change.**
  `structureWatchdog` (`structureWatchdog.ts`) undoes any edit that changes the
  token address multiset unless the baseline was moved with it. Legitimate
  cycle writes call `watchdog.baseline()`; an assistant insert/delete that
  doesn't will be reverted.
- **`writeValues` is the only safe write.** It selects a control's value and
  replaces it (`resetContentControlData` resets to placeholder — not a write),
  checks the document shape before/after (`shapeViolations`), and reports
  corruption. Route every value write through it, not through raw
  `insertText`.
- **`lockContents` / `canEdit` naming is inverted.** In Syncfusion's
  `ContentControlInfo`, `canEdit: true` means contents **cannot** be edited and
  `canDelete: true` means it **cannot** be deleted (`controls.ts:25`). Computed
  tokens set `lockContents = true`; programmatic writes bypass the lock, so no
  unlock dance is needed.

---

## 6. Open questions / TODOs for the assistant work

Not yet built on the assistant side; you will likely need to add:

1. **Expose the `TokenCycle` to the assistant layer.** Today only the raw
   `editor` is registered (`docxEditorRegistry.ts`). Add the cycle (or a thin
   token-ops facade) to the registration so tools can reach `setTokenValue`,
   `getState`, `refresh`, and `subscribe`.

2. **A public structural token API.** Wrap the create/edit/delete sequences of
   §3 into cycle methods (e.g. `insertToken(spec, at)`, `updateToken(instance,
   patch)`, `deleteToken(instance)`) that internally set `applying`, re-baseline
   the watchdog, and call `refresh()`. Without this, an external insert races the
   watchdog and reconcile.

3. **A `removeContentControl` wrapper in `controls.ts`.** The one true delete
   path (`editor.removeContentControl`) is still an un-isolated `@private` gap.
   Tombstoning handles *row* deletion; scalar-token removal needs this.

4. **Formula/spec construction helpers exposed to the assistant.** The assistant
   should build specs using `grammar.ts` (`parse`, `dependencies`) to validate a
   formula and compute `reads` before insertion, and reject specs the grammar
   can't parse — mirroring the backend `syntax.parse_tag` classification so an
   assistant-authored token behaves identically to a template-authored one.

5. **Value-op vs. structural-op routing.** Decide which assistant intents map to
   `setTokenValue` (a value change — safe, exists today) vs. a structural op (add
   / rebind / delete — must rebuild the plan). Value ops should never `refresh`;
   structural ops always must.

6. **Focus/timing contract for assistant-triggered writes.** Reuse the host's
   deferred, focus-restoring reconcile so an assistant op fired while a user is
   typing doesn't strand the caret. This may mean the assistant enqueues an
   intent the host drains on the next safe tick rather than calling the cycle
   synchronously.

---

## 7. Source map

| File | What it owns | Key symbols |
| --- | --- | --- |
| `grammar.ts` | Formula parse + evaluate, no `eval` | `parse`, `evaluate`, `dependencies`, `wildcardPrefixes`, `FUNCTIONS`, `DISPLAY_FUNCTIONS`, `roundHalfAwayFromZero` |
| `format.ts` | Value → display text and back | `renderValue`, `parseValue`, `DEFAULT_DECIMALS` |
| `plan.ts` | Spec model, dependency graph, recalc | `TokenSpec`, `TokenFormat`, `valueKey`, `instanceKey`, `buildPlan`, `recalc`, `validationErrors` |
| `controls.ts` | The Syncfusion content-control boundary | `TAG_PREFIX`, `encodeTag`, `decodeTag`, `readTokens`, `writeValues`, `controlCollection`, `insertUntaggedControl`, `isDetached`, `documentShape`, `shapeViolations`, `selectTokenValue` |
| `rows.ts` | Repeated-table row grow/shrink/renumber | `repeatGroups`, `growGroup`, `shrinkGroup`, `renumberGroup`, `tombstoneDetached`, `deletedRows`, `rowSnapshot` |
| `tokenCycle.ts` | The reconcile engine + public cycle | `attachTokenCycle`, `reconcile`, `setTokenValue`, `refresh`, `derive`, `syncRows`, `adoptFromDocument`, `seedDefault`, `DEFAULT_WINS` |
| `cycleTypes.ts` | Host-facing types + pure helpers | `TokenCycle`, `TokenState`, `FieldAccess`, `TokenValue`, `saveBlockers`, `tokenFieldSignature` |
| `structureWatchdog.ts` | Undo edits that damage token structure | `structureWatchdog` (`check` / `baseline` / `reset`) |
| `tokenOverlay.ts` | Cosmetic editor-only token highlight | `attachTokenOverlay` |
| `TokenPanel.tsx` | Dev-only token inspector (`window.featheryDocxTokens.panel`) | `TokenPanel`, `tokenPanelEnabled` |

**Host wiring:** `src/elements/components/DocxEditor/DocumentEditorContainer.tsx`
(`formFieldAccess`, `onEditorReady`, `reconcileKeepingFormFocus`, `saveEnvelope`).

**Backend twins** (must stay in step; shared fixtures
`grammarCases.json` / `tokenSpecCases.json`):
`feathery-backend/apps/document/utils/tokens/` — `grammar.py`, `format.py`,
`syntax.py` (the `[[ … ]]` author grammar), `scan.py`, `declare.py`, `wrap.py`
(emits the `ftk:` tag).
