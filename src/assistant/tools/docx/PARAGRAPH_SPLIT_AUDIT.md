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
6. Transient edit/verification selections are non-navigating for the exact
   synchronous transaction. SyncFusion's layout Control-Home is suppressed only
   inside that boundary, all public methods are restored before returning, and
   the viewer retains its request-time scroll position.
7. The host disables Chromium scroll anchoring on SyncFusion's private viewer.
   SyncFusion already owns cursor-to-page mapping; browser anchoring was applying
   a second, deferred 27 px correction after the engine restored the viewport.

The real-SyncFusion oracle selects the paragraph through the public editor
selection API, checks the exact `2;11;0`..`2;11;273` request-time range, applies
the exact wire payload, requires one logical change-set group, and measures 10
pt formatting inside both resulting non-empty halves.

## PR-range commit audit

Scope: every `origin/master..hilb-fresh` commit whose patch changes
`syncfusionDocumentOps` verification, preflight, expectation/relocation, or
selection behavior, plus the directly related paragraph-split and viewport
commits. SHAs below are from the current rebased `hilb-fresh` history.

| Commit     | Decision  | Reason                                                                                                                                                |
| ---------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `efbb918a` | rewritten | Its per-anchor post-write guards now delegate to the shared block-span verifier. Table appearance and grounded numeric writes remain intact.          |
| `b0cbaa68` | keep      | Structural formatting inheritance is independent of expectation ordering and is proven by the oracle's measurements inside both halves.               |
| `3c694f07` | rewritten | Verified snapshots are invalidated after topology changes; its queued public layout toggle is now a muted, non-navigating batch.                      |
| `dc813495` | rewritten | Per-group relocation remains; preflight relocation now reads simulated post-prior-op text while the write plan retains the real baseline block.       |
| `964f4886` | keep      | Stable attached-section boundaries are structural composition, not the split verifier.                                                                |
| `6d6d385f` | keep      | Live-order structural revision resolution is required for lossless accept/reject and does not alter text expectations.                                |
| `aaeeaac0` | keep      | Atomic section composition uses the deferred topology path; topology-stable text simulation deliberately does not impersonate it.                     |
| `b99dfec2` | keep      | Section insertion entry-point resolution is orthogonal and remains covered by its composer tests.                                                     |
| `ec200bc4` | keep      | Transactional appearance rollback remains the formatting safety boundary; it is not a second text verifier.                                           |
| `53b15a28` | keep      | Composed-table border normalization verifies appearance, not text payloads.                                                                           |
| `ce906cea` | keep      | Background reads must preserve the user's live editor selection.                                                                                      |
| `9237617c` | keep      | Visually silent background serialization prevents selection/layout reads from moving the UI.                                                          |
| `b0f73c12` | keep      | Pins the request-time selection across tool continuations and uniquely relocates it by content; reverting would restore the mutable-selection race.   |
| `7c644375` | keep      | Restores the editor viewport around revision relayout; independent of text preflight.                                                                 |
| `af66a2a8` | keep      | Anchored sibling-family choice affects inherited section appearance only.                                                                             |
| `acc56ae6` | rewritten | Replaced the CR-only, selection-only range verifier with the shared newline-normalized payload-span verifier and a live-selection oracle.             |
| `086250c3` | keep      | Resolves section siblings at document edges; its deferred topology logic remains separate from stable text simulation.                                |
| `b7417583` | keep      | Keeps container relayout visually silent and composes with the editor viewport preservation path.                                                     |
| `81b3c25c` | keep      | Selection-split formatting inheritance is correct; the oracle proves both created halves retain the source font after the split lands.                |
| `41fa7679` | rewritten | Replaces the stacked text guards with ordered text simulation and one newline-normalized payload-span verifier shared by every text source.           |
| `c713f293` | keep      | Scopes chat auto-scroll to the message container; the live tracer confirms it does not move the document viewport.                                    |
| `97855758` | rewritten | Keeps deferred formatting anchored to the real preflight block while text expectations alone use the simulated state.                                 |
| `4148cbb4` | rewritten | The ancestor-walking rail scroll fix could still choose the editor viewport when the rail fit; the rail now references only its explicit scrollbox.   |
| `e4680a2b` | keep      | Gives the tracked-change rail one explicit scroll owner and proves chip reveal cannot select the document viewer as a fallback.                       |
| `29e09b36` | revert    | Its two-frame, pixel-threshold compensation masked navigation after it happened instead of preventing the rail and SyncFusion sources.                |
| `3cdb6c55` | keep      | Removes that deferred compensation completely so viewport correctness comes from deterministic scroll ownership and the edit transaction.             |
| `310173ea` | keep      | Ignores ResizeObserver notifications whose measured editor geometry did not change, avoiding needless relayout during chat streaming.                 |
| `d6d69984` | rewritten | Removed its 1.5-second monkey-patch. Control-Home is now suppressed only for the synchronous document-edit transaction that triggers it.              |
| `8c512f2b` | keep      | Host geometry changes use the narrower native editor resize API; no timer or broad container refresh remains.                                         |
| `5f1d6903` | keep      | Makes every engine-owned selection non-navigating and blocks layout Control-Home only while the atomic edit call is on the stack, with exact cleanup. |
| `22d83dee` | rewritten | Identified and removed the queued bulk-layout property change whose deferred `refreshLayout()` moved the viewport to the document start.              |
| `db020a64` | keep      | Gates assistant review wiring to writable assistant hosts; non-assistant and read-only editors remain outside the split/review path.                  |
| `2a920fb2` | keep      | Restores one efficient layout batch via muted `setProperties`, then explicitly repaginates without queuing SyncFusion's Control-Home refresh.         |
| `1e9cdf8f` | keep      | Extracts revision-review primitives without changing the ordered text verifier; both exact real-SyncFusion strategies remain green after extraction. |
| `4fbcd7ba` | rewritten | Keeps its host cleanup, but restores this captain-mandated audit after that commit incorrectly classified it as a review-only artifact.              |
| `9aa25327` | keep      | Narrows tracked-review event guards to the rail's own interactions and leaves editor selection/navigation ownership unchanged.                      |
| `374cf561` | keep      | Refines and tests the native host-resize path; geometry changes remain viewport-preserving and same-size notifications remain no-ops.                |
| `9ff66ce8` | keep      | Disables Chromium anchoring on the editor-owned viewer, eliminating the deferred 27 px browser correction proven by the live scroll tracer.         |
