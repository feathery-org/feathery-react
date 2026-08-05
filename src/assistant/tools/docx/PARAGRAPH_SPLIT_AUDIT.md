# Paragraph-split failure audit

## Finding

The two exact live wire strategies are already broken on `origin/master`; there
is no honest good endpoint inside `origin/master..hilb-fresh`. Bisecting from
the parent of the document-operation engine instead identifies
`732e8cefb0d2b383294bb54e03e44f0910d49c78` (`feat: Attach document ops and client-side logic rules to the SyncFusion editor (#1715)`) as the first bad
commit for both strategies:

| Strategy                                                   | Good boundary                                                 | First bad  | Failure at first bad                              |
| ---------------------------------------------------------- | ------------------------------------------------------------- | ---------- | ------------------------------------------------- |
| Full-paragraph `replace_selection` with LF paragraph marks | `5a57a947b0571fa8fbc400615e7579b03b509b6d` (operation absent) | `732e8cef` | `Text verification failed across "2;11".."2;11".` |
| Same-anchor `replace_text` then dependent `insert_text`    | `5a57a947b0571fa8fbc400615e7579b03b509b6d` (operation absent) | `732e8cef` | op 2 `expect_mismatch` in static preflight        |

Commands used for each independent bisect were equivalent to:

```sh
git bisect start origin/master 5a57a947b0571fa8fbc400615e7579b03b509b6d
yarn jest src/assistant/tools/docx/tests/paragraphSplitOracle.spec.ts --runInBand
PARAGRAPH_SPLIT_ORACLE_STRATEGY=dependent-ops yarn jest src/assistant/tools/docx/tests/paragraphSplitOracle.spec.ts --runInBand
```

The introduction commit made two incompatible assumptions: all operations in a
change set were preflighted against one pre-change snapshot, and post-write
text verification read only the original block. The first rejects a later
operation whose `expect` is intentionally made true by a prior operation. The
second cannot prove a payload which creates paragraph blocks and also treated
only CR as a paragraph mark even though SyncFusion accepts CR, LF, and CRLF.
For an `insert_text` after a tracked replacement, a third instance of the same
static-coordinate assumption selected a serialized offset containing pending
revision runs rather than the visible paragraph end.

The release-range selection work exposed the old engine defect to the current
UI path; it did not create the two engine failures. In particular,
`0e376990` correctly pins the user's selection across automatic continuations.
Reverting it would make requests target mutable background selections again.
`e9b6bb39` (the rebased equivalent of `c03403b2`) tried to repair the first
strategy, but its CR-only, selection-only verifier and manually assembled test
offsets did not exercise the live LF payload selected through the editor API.

## Root rewrite

The engine now has one text-write verification model:

1. Read-only preflight simulates topology-stable text operations in change-set
   order, so each `expect`, `find`, and relocation sees the state after prior
   accepted operations.
2. Write-time guards still re-read the real editor after every operation.
3. Selection-sourced and anchor-sourced writes use the same block-span verifier.
   It normalizes CR/LF/CRLF and reads every block the payload created.
4. Paragraph-boundary insertion uses SyncFusion's live selection movement API,
   avoiding stale serialized coordinates after a tracked replacement.
5. A verified snapshot is not reused after section-boundary inheritance changes
   topology.

The real-SyncFusion oracle selects the paragraph through the public editor
selection API, checks the exact `2;11;0`..`2;11;273` request-time range, applies
the exact wire payload, requires one logical change-set group, and measures 10
pt formatting inside both resulting non-empty halves.

## PR-range commit audit

Scope: every `origin/master..hilb-fresh` commit whose patch changes
`syncfusionDocumentOps` verification, preflight, expectation/relocation, or
selection behavior, plus the directly related paragraph-split and viewport
commits. SHAs below are from the current rebased `hilb-fresh` history.

| Commit     | Decision  | Reason                                                                                                                                              |
| ---------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ac90a1d2` | rewritten | Its per-anchor post-write guards now delegate to the shared block-span verifier. Table appearance and grounded numeric writes remain intact.        |
| `32397351` | keep      | Structural formatting inheritance is independent of expectation ordering and is proven by the oracle's measurements inside both halves.             |
| `71203dcd` | rewritten | Serialized snapshot reuse remains, but verified snapshots are invalidated when later section-boundary inheritance changes topology.                 |
| `1306793c` | rewritten | Per-group relocation remains; preflight relocation now reads simulated post-prior-op text while the write plan retains the real baseline block.     |
| `54f9bca1` | keep      | Stable attached-section boundaries are structural composition, not the split verifier.                                                              |
| `68bfba67` | keep      | Live-order structural revision resolution is required for lossless accept/reject and does not alter text expectations.                              |
| `1b9d0036` | keep      | Atomic section composition uses the deferred topology path; topology-stable text simulation deliberately does not impersonate it.                   |
| `038147d6` | keep      | Section insertion entry-point resolution is orthogonal and remains covered by its composer tests.                                                   |
| `34586856` | keep      | Transactional appearance rollback remains the formatting safety boundary; it is not a second text verifier.                                         |
| `e20ffd9f` | keep      | Composed-table border normalization verifies appearance, not text payloads.                                                                         |
| `6dd91d6d` | keep      | Background reads must preserve the user's live editor selection.                                                                                    |
| `7d4023b6` | keep      | Visually silent background serialization prevents selection/layout reads from moving the UI.                                                        |
| `0e376990` | keep      | Pins the request-time selection across tool continuations and uniquely relocates it by content; reverting would restore the mutable-selection race. |
| `2acda52c` | keep      | Restores the editor viewport around revision relayout; independent of text preflight.                                                               |
| `734ddbc2` | keep      | Anchored sibling-family choice affects inherited section appearance only.                                                                           |
| `e9b6bb39` | rewritten | Replaced the CR-only, selection-only range verifier with the shared newline-normalized payload-span verifier and a live-selection oracle.           |
| `0191255c` | keep      | Resolves section siblings at document edges; its deferred topology logic remains separate from stable text simulation.                              |
| `53d2c471` | keep      | Keeps container relayout visually silent and composes with the editor viewport preservation path.                                                   |
| `36b25f65` | keep      | Selection-split formatting inheritance is correct; the oracle proves both created halves retain the source font after the split lands.              |
| `956bfb33` | rewritten | Replaces the stacked text guards with ordered text simulation and one newline-normalized payload-span verifier shared by every text source.         |
| `5215714c` | keep      | Scopes chat auto-scroll to the message container; the live tracer confirms it does not move the document viewport.                                  |
| `7a418c39` | rewritten | Keeps deferred formatting anchored to the real preflight block while text expectations alone use the simulated state.                               |
| `2dd1d711` | rewritten | The ancestor-walking rail scroll fix could still choose the editor viewport when the rail fit; the rail now references only its explicit scrollbox. |
