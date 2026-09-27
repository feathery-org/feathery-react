# Version history review follow-up

Review: https://github.com/feathery-org/feathery-react/pull/1851#pullrequestreview-5236983005

Approved scope: resolve the remaining valid findings, preserve the working attribution/restore experience, verify the SDK and companion backend, and update local consumers. Keep existing authentication, historical artifacts, and unrelated local settings intact.

## Work sequence

- [x] Merge current master; preserve primitive resolution warnings and history acceptance; conventional PR title.
- [x] Scheduler: blocked flush, cancellation/disposal, bounded classified retries.
- [x] Save lifecycle: ordered document persistence, immediate consistent snapshots, failed-save retry, restore save barrier, accurate dirty state.
- [x] Transport: timeouts, structured failures, re-authentication, visible artifact errors.
- [x] Contracts: binding commit/gate, returned save result, author identity/types, response validation, expired URL recovery.
- [x] Restore idempotency: stable operation identity and backend replay before mutation.
- [x] Document replacement/navigation: explicit identity and preservation before controlled replacement; retain unload warnings.
- [x] Performance: compatible allocation-free reverse hashing, meaningful refresh keys, change-only form write-back, byte-bounded caches, measured diff budget.
- [x] Viewer: creation timeout/cleanup; document-region and rapid-selection regressions; real Chrome header/footer/table rendering.
- [x] SDK/backend/consumer checks; review resolved versus remaining limitations; refresh localhost consumers.

## Verification strategy

Use the agreed public seams: scheduler API with injected time, editor/session save flows with controlled network boundaries, and backend version endpoints. Each bug gets a failing regression before its fix. Real editor fixtures cover snapshot/attribution/rendering behavior; headless document tests are used where available. Never claim browser QA or performance guarantees from mocked tests alone.

## Progress and evidence

- Initial head: SDK `231cb0b5`, backend `7f3996c59`.
- Master merge target: `e7d7168d`. Five conflicts preserve both history behavior and master primitive/review diagnostics. Four affected suites passed (222 tests); initial typecheck requires the newly merged `puppeteer-core` dependency.
- Prior baseline: 733 SDK tests, 41 backend tests; blocked flush and retry-after-cancel were independently reproduced.

## Implemented follow-up

### Persistence and recovery

- Explicit blocked flushes reject instead of hanging. Cancellation settles waiters, invalidates late completions, and stops rearming after teardown. Automatic retry stops on permanent failures and after four transient attempts, honors Retry-After, and can be explicitly retried.
- A single document-write FIFO captures each export and destination immediately, preserves failed snapshots, and prevents an older upload from landing after a newer save. Save returns the actual host result. Restore waits for already-running and previously-failed document writes, independently of slower highlight uploads.
- Checkpoints use the same pre-upload SFDT snapshot as the autosaved DOCX. A completed old save cannot clear newer edits' dirty state. Automatic saves commit bindings and obey their gate, without flickering the foreground saving controls.
- Save and artifact errors remain visible and retryable; the container no longer unmounts the editor on an operation error. Artifact retries reuse the encoded payload and share the checkpoint FIFO.
- Document requests have a 45-second fetch-and-body deadline, abort on timeout, retain status/recovery classification, and route authentication failures through the existing reauthentication handler. Form authentication is preserved, not weakened.
- Restores reuse their operation ID after an uncertain response. The backend replays the completed operation before mutating storage. Identical closing PATCH retries also replay without replacing newer live bytes; different stale bytes remain rejected.
- Regenerate/refresh awaits preservation of the old document before swapping sources; save failure keeps the old editor mounted. Envelope identity now reaches the session hook. Hidden-tab saves are best-effort, with the existing unload/leave warnings retained.

### Contracts, previews, and attribution

- Author kinds match backend validation; custom author keys survive SDK metadata, backend parsing/merging, and tracked-author filtering, including same-label people.
- Version lists/details/mutation responses and change-list hunks are validated at the network boundary. Expired artifact URLs get one bounded refresh through the detail endpoint, including DOCX fallbacks.
- Preview creation has a timeout and owns the container before waiting for its created event, so never-created and late-created instances are cleaned up.
- Header/footer regions participate in normalization, diffing, and revision counting. Alignment does not match text across unrelated document regions. Section-end deletions stay in the correct section.
- Current previews use a semantic document key instead of response-object identity or signed-URL churn. Preview caches are host-scoped, byte-bounded, and released when their editing surface unmounts; local preview artifacts are byte-bounded too.
- The reverse fingerprint uses a backwards UTF-16 loop, preserving historical hashes without a character-array allocation. The legacy `sha256` field names are explicitly documented as non-cryptographic FNV fingerprints.
- Diff budget checks now run within alignment/LCS/block processing; incomplete results emit no misleading hunks. Form write-back submits changed values only and retains failed submissions for retry.
- Pinned CDN stylesheets now carry SHA-384 integrity hashes and anonymous cross-origin mode; CORS support was checked on the pinned CDN response.

## Verification

- Full SDK suite: 265 suites passed; 3,862 tests passed, 3 existing skips. Additional focused regressions were subsequently added and checked separately.
- Backend version endpoints and tracked authors: 45 tests passed.
- Real Chrome / pinned Syncfusion: six-section, 332,543-byte fixture; header/footer/table-cell highlights survived opening and serialization, accepted header text stayed exact, renderer state was restored, and contentChange observed the completed edit. Two headless tests passed; measured diff runs were 77–96 ms on this machine.
- Typecheck passed; final lint/build/consumer verification is recorded below when complete.

## Local verification regression: Robin checkpoint ordering

The turn-end checkpoint previously posted history artifacts before the debounced DOCX PATCH created its session row. After an existing version or restore, the backend correctly rejected that unknown session with `Session was never saved`. Local request logs showed the failed checkpoint followed by a successful document save; a regression test reproduced the exact upload-warning banner.

Turn-end checkpoints now use the gated, ordered document-save pipeline and upload artifacts only after that snapshot saves. Requests arriving during an older save remain pending for the next snapshot. Successful replacement artifacts clear their earlier upload warning without suppressing unrelated save errors. Five regressions cover ordering, snapshot consistency, recovery, document-save failure, and overlapping turns. The focused history/editor/transport run passed 224 tests across 22 suites. Changes remain local pending user verification.

## Local verification regressions: history footer and highlight toggle

- The history list's `height: 100%` excluded its padding, allowing content to bleed past the footer divider. The list now uses border-box sizing and the history body clips overflow above the opaque footer.
- The highlight toggle keyed/remounted the viewer, showing the loading skeleton and losing scroll. Reusing the viewer removed the flash but a regression still reproduced the native document-open scroll reset. Same-version SFDT replacement now suppresses selection-driven scrolling and restores/repaints the viewport synchronously before the browser's next frame. Version navigation remains independent; the highlights-off document remains accepted and revision-free.
- The actual parent toggle regression covers four consecutive toggles without a loader, remount, or scroll movement. An isolated Chrome regression mounts the real React preview and pinned Syncfusion engine, samples 24 frames per toggle, and verifies stable vertical/horizontal scroll, zoom, visible canvas content, no loading overlay, revision removal, and original font color. It failed before viewport preservation and passes afterward.
- Verification: 199 focused history/renderer tests across 20 suites, all three real-Chrome history tests, TypeScript, and scoped application lint passed. Local consumer builds include both fixes; final signed-in visual verification remains user-owned. Nothing pushed.

## Local acceptance regression

A DOCX round trip can drop Robin's revision `customData` while retaining its invisible author-identity suffix. The rail grouped those untagged revisions under the visible name, but group resolution compared against the raw author; Accept/Reject therefore matched no revisions. Both paths now share the same author normalization. Separately, history confirmation now includes only requested revisions that actually disappeared from the document, so a stalled or partial native resolve cannot approve still-pending edits.

The affected saved snapshot reproduced 36 revisions remaining after Accept; all 36 clear with the fix. A minimized real-Chrome regression reproduces the same mismatch with a single untagged revision and covers Accept and Reject. Additional checks cover freshly saved text/table suggestions, export-before-accept, and no-op/partial confirmation. No historical artifacts were rewritten. Verification: 290 focused tests across 23 suites, seven real-Chrome tests, and TypeScript passed.

## Valid limitations and decisions (not claimed fully resolved)

- **Tab close is not a durable save boundary.** Browser unload cannot await large DOCX uploads, and keepalive/beacon has a small body budget. Visibility-triggered save reduces exposure; the leave warning remains necessary. No claim of guaranteed tab-death persistence.
- **Worst-case performance still needs customer-sized profiling.** Synchronous engine serialization, JSON parse/clone, and individual very large strings are not preemptible. In-loop checks improve the budget but are not a hard total wall-clock guarantee. The real fixture above is representative test evidence, not proof for every customer document or mobile device. Worker/operation-level provenance remains a follow-up if those profiles exceed the interaction budget.
- **Concurrent editors are not a merge system.** Stale sessions stop automatic retries and show an error; we do not silently overwrite the newer session. A user-facing compare/merge or optimistic revision-token workflow requires separate product/backend design.
- **Authentication must remain enforced.** The proposed cookie-presence bypass was not adopted. Reauthentication uses the existing host flow; durable recovery across a full host remount/reload is outside this in-memory queue.
- **Unused rename UI is not a bug fix.** The existing adapter/API remains compatible; adding a naming feature was not necessary to resolve signed-URL expiry, which now uses GET detail.
- **Historical attribution already overwritten cannot be inferred safely.** No speculative data migration or history rewrite was performed.
- **QA boundary:** isolated real-Chrome engine tests ran; a signed-in walkthrough of the standard dashboard was not performed because in-app browser control was not exposed in this session.

## Approved handoff — September 18, 2026

The user verified the local build and authorized pushing both PRs. Final pre-push checks passed: SDK lint (warnings only), TypeScript, 685 tests across 65 suites (one existing skip), all seven real-Chrome history regressions, and 45 backend version-history tests. The SDK build passed and the same v9 package was verified in both local consumers. SDK PR #1851 contains the source, tests, and these notes; backend PR #3869 contains the retry-idempotency and author-identity changes. Local package tarballs and consumer configuration are excluded.
