# docx-dynamic-blocks — known follow-ups

State at branch completion (fb319898): 375 tests green across
documentBlocks / documentTokens / DocxEditor, typecheck clean, feature
live-verified end-to-end through hosted-forms-next against the local backend.
Everything below is deferred, none of it blocking for a flag-gated feature.

## Parked from the final review

- **BlockPanel `useDebouncedText` drops an unflushed edit on unmount.** The
  500ms idle debounce + blur-flush added in the final fix wave doesn't flush a
  dirty value when the component unmounts first. Dev-flag-gated surface only.
  Fix: flush `commitRef.current(local)` in the unmount cleanup when dirty.

## Deferred (final review minors + task-review leftovers)

- `tokens.ts` ignores `spec.display` and `spec.validate`, both honored by the
  shipped `tokenCycle` — a display-transformed token renders differently in a
  blocks document than in a legacy one.
- `ComponentsTab` applies `setTheme` on every debounced contentChange even
  when the extracted theme is unchanged — each pause costs an undo entry and a
  main-document reopen. Deleting a sample silently resets that type's styling.
- The Components editor mounts whenever the flag is on, even if the tab is
  never opened. Lazy-mount would save the memory.
- `parseTable` doesn't search nested-table content for the block anchor (only
  relevant if nested tables ever carry identity).
- Typing at document end after a trailing table lands inside the last cell
  (Syncfusion caret semantics). Consider a trailing paragraph block emitted by
  `generate`.
- One unreproduced live observation: an absorbed cell edit once vanished from
  the live document without a logged reopen. Echoes the tokens branch's known
  need for a real key-event harness.
- Sync-level test coverage gaps: `history`/`theme` origins through
  `attachBlockSync`, block deletion/adoption through the full loop,
  `refresh()`, debounce coalescing, scroll preservation (needs a stateful fake).
- Prettier drift in `sampleDocument.ts`, `sfdt/generate.ts`,
  `tests/anchors.spec.ts` (`prettier --check` fails; cosmetic).
- Repo-wide `yarn lint` is broken in nested worktrees (duplicate
  `@typescript-eslint` resolution) — environmental, predates this branch.

## Environment notes (for whoever drives this next)

- Dev loop: `yarn dev-local` (webpack watcher) in this worktree +
  `link-forms` + hosted-forms-next `yarn dev-local`; restart Next after SDK
  rebuilds. Enable with
  `window.featheryDocxBlocks = { enabled: true, panel: true, debug: true }`
  before the form loads.
- Test form: "Invoice Generator", `localhost:3001/to/P9iplt` — click
  Load Cart to generate/open the envelope.
- The local backend needed `document` migration 0057 (`live_tokens`) applied
  for envelope generation; done 2026-08-05.
