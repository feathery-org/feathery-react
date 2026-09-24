# Version history audit — 2026-09-17

Scope: `feat/docx-version-history` in the SDK and `feat/envelope-version-history` in the backend. This audit covers editing, checkpoints, Save, acceptance, historical previews, restore baselines, attribution, degraded artifacts, and the existing endpoint protections. Changes are local source changes; no production deployment or historical-data rewrite was performed.

## How history works

The editor captures a starting document and snapshots at author boundaries. At checkpoint/close, the browser compares these snapshots and uploads the final SFDT plus per-author changes. The server stores the DOCX separately and derives the version's author list from the rendered change authors. The viewer reconstructs highlights from the stored final document and changes.

Robin's native tracked revisions are pending suggestions; human typing is normally untracked. The comparison normalizes pending revisions to their accepted content. Accepting selected revisions creates a separate confirmation version, while the preceding version preserves its original state. A Robin turn checkpoints an open session; Save and the idle timer close it.

Consequently, a wrong author boundary or a destructive reconstruction of a previous change list affects both highlight colors and the names displayed in the history list.

## Findings and implemented fixes

| Finding / trigger | Effect before the fix | Implemented correction |
| --- | --- | --- |
| Human types after Robin in the same session | The first human edit was already present when the Robin boundary was serialized. Both edits could become Robin's. | Retain the preceding document snapshot and use it for both directions of author switch. |
| Human types between Robin tool calls | The whole-turn flag labeled human typing as Robin. | Use the actual mutation flag for authorship; retain the whole-turn flag for autosave/selection gates. |
| Accept after reload or an already-closed session | The preservation path regenerated the preceding version from pending suggestions alone, overwriting human edits and earlier accepted edits. | Never reconstruct existing artifacts. If artifacts are missing, preserve the raw pending document and known server-side authors without inventing a diff or an unchanged-session hash. |
| Human types while the pre-accept save is pending | The confirmation could include those human edits and attribute them to Robin. | Save intervening editing sessions, then capture the immediate pre-accept state. Abort acceptance if the underlying document changed. |
| Human and Robin write the same words | Global text matching could override correct human attribution and mark their edit pending. | New artifacts declare authoritative slice attribution. Text matching can enrich matching authors but cannot transfer a human hunk to Robin. Legacy artifacts retain their compatibility behavior. |
| Accept one of several identical suggestions | A different live suggestion could make the accepted edit appear pending or supply the wrong group. | Confirmation hunks are settled. Recover group metadata only from the selected revision IDs. |
| Typing during Save | DOCX export happened after an await, while SFDT was captured before it. Restoring could yield a different state from the highlighted preview. | Start both snapshots synchronously and retain the original save destination. Use an independent Word export archive for overlapping saves. Later typing remains dirty. |
| Restore/regenerate reuses the editor | The next edit could compare against the prior document or lose its first change. | Reset session state before capturing the replacement baseline, including when the old session was already closed. Ordinary editor recreation preserves the session. |
| Browser postpones the idle timer | Closing from a post-edit event could swallow the first resumed edit into the preceding session and clear the new baseline. | The editor hook lets the idle timer close sessions; post-edit notifications never retroactively close them. If the timer was delayed, resumed edits stay in the same correctly attributed session. |
| Diff unavailable at close | The backend treated “no diff available” as “no authors,” and the panel hid the remaining attribution. | Preserve known authors for unavailable diffs and display them alongside saved fallback snapshots. A valid empty diff still has no surviving authors. |
| Temporary changes-file fetch failure | The plain fallback could be cached for the rest of the visit. | Do not cache degraded results when a changes artifact exists; reopening retries. |
| Stale/mismatched artifacts | Comparing only two metadata hashes could apply highlights to the wrong actual document. Older checkpoint URLs could outrank a newer local close. | Verify the normalized fetched document's hash. Prefer the pending local closing snapshot and include content metadata in cache keys. Invalidate stale requests when selection clears. |
| More than 20 author boundaries / diff timeout | Dropped boundaries silently transferred earlier edits to later authors; timeouts could emit intermediate offsets against the final document. | Detect missing provenance, preserve the document and known authors, and explicitly show detailed changes as unavailable. Never render intermediate-state hunks against the final document. |
| Historical “pending” badge | It sounded like a statement about today's review state. | Historical versions say “pending at save” and explain that later acceptance/rejection may differ. Saved history remains a record of its original state. |

## Follow-up from hands-on testing — 2026-09-18

- **Missing human avatar on “Just now.”** The document preview used a live diff, while the history row hid authors until saved change files arrived. Live previews now expose their actual surviving authors through the same extraction used for saved history. The panel uses these authors only for the matching open session, ahead of stale checkpoint data. It retains both authors when Robin edits arrive, removes attribution when changes are fully undone, and does not transfer it to another session. A checkpoint refresh updates the currently viewed live preview as well as its avatars.
- **Robin marks on restored versions.** The read-only viewer painted native suggestions embedded in restored files even though restores are clean history baselines. Restored history previews now always use a revision-free display copy, with no highlight controls, edit navigation, or pending badge. This applies to live SFDT, fetched SFDT, DOCX fallback, and restores whose source was later pruned. The editable document and its reviewable suggestions are not modified.

The diagnosis loop reproduced both reported symptoms before fixes. New coverage drives the actual editor → session → history panel → preview flow while checkpoint persistence is delayed, then adds Robin edits during the upload. Updated verification: 63 SDK suites, 730 tests passed, one skipped. Browser visual confirmation remains user-owned.

Restore UX follow-up: confirmation now shows a persistent “Restoring version…” spinner through the pre-restore save and restore request, blocks duplicate actions, and explicitly refreshes history afterward. The new restored baseline is selected using the returned version ID (or the refreshed list for older hosts), without reopening the stale live document. A failed restore clears the indicator and preserves the previous selection for retry. Seven affected suites passed (81 tests), including delayed save/restore, duplicate clicks, success selection, delayed history uploads, and failure recovery; typecheck and targeted lint passed.

## Regression evidence

The initial mixed-author regression expected `[you, robin]` and received `[robin, robin]`. The reload/acceptance regression observed an extra upload replacing the preceding version. Both now pass.

Other tests reproduced DOCX/SFDT divergence during Save, lost restore baselines, incorrect pending status after partial acceptance, metadata-only hash validation, cached network failures, and intermediate-state hunks after timeout. Coverage also exercises repeated text, typing between tool calls, typing during acceptance, slice overflow, delayed idle timers, local close artifacts, and missing-diff attribution.

The real Syncfusion Word exporter is exercised with overlapping exports: the first DOCX must contain only the original text, and the second only the later text. Existing editor tests cover table structure, content controls, bindings, tracked-change review, undo/history sequencing, viewer switching, unmount, and restore integration. Backend version API tests cover snapshotting, close artifacts, deduplication, restore, signed documents, ownership, and retention.

Commands:

```sh
# SDK worktree
yarn test --runInBand --silent --watch=false src/elements/components/DocxEditor src/assistant/tools/docx/tests/syncfusionDocumentOps.spec.ts
yarn typecheck
git diff --name-only -- '*.ts' '*.tsx' | xargs yarn eslint

# Backend worktree, using its virtualenv
python manage.py test apps.document.tests.test_version_tracked_authors apps.api.tests.test_document_views.TestAPIEnvelopeVersionViews --keepdb --noinput
```

No interactive browser pass was performed. The tests exercise the real editor engine where applicable and mock network persistence in the SDK; the backend API suite uses the local test database.

Final pre-push verification, including the restore UX follow-up: 63 SDK suites passed (733 tests passed, one skipped); 41 backend tests passed. TypeScript checking and whitespace checks passed. ESLint reported no errors, with non-null assertion warnings in tests/existing diff code and one ignored test-file warning.

## Remaining design limits and recommendations

- Historical damage is not automatically repairable. A previous overwritten artifact may no longer contain the author boundary needed to recover attribution. Preserve backups and compare the original artifacts before attempting any migration; do not guess from identical text. New artifacts use trustworthy boundaries, while old artifacts retain their previous matching behavior.
- Rejection and undo are represented as content changes, not a review-event audit trail. A durable ledger keyed by revision ID should record who accepted/rejected, when, and which suggestion was involved, separately from who authored the text. That would also support a distinct “current resolution” view without rewriting historical snapshots. This patch preserves the existing content-history semantics.
- Slice overflow now degrades visibly instead of fabricating attribution. Preserving detailed highlights for arbitrarily long mixed sessions needs incremental provenance compaction or additional durable boundaries, beyond the existing bounded snapshot store.
- Attribution snapshots now serialize the document on each content-change event. This adds work during human typing but keeps only one extra latest snapshot. Large/image-heavy documents should be profiled; an eventual operation-level provenance model would avoid whole-document serialization.
- Concurrent tabs remain separate sessions without document-level optimistic concurrency control. Existing API tests check session ordering and ownership; they do not establish collaborative merge semantics. A future revision-token precondition should reject stale writes and offer an explicit recovery flow.

Deploy the SDK and backend changes together. There is no schema migration.
