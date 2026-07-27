// In-form document indexing (HILB Contract C). ai-services requires a queryable
// semantic index before every bulk document edit: `discoverIndexedDocumentCandidates`
// and `searchGeneratedDocument` read `generated_doc_chunk`, and nothing else
// populates it on the in-form path (there is no envelope / pgvector pipeline for
// a document opened in the form). So when the in-form document editor comes up
// with a loaded document, POST its block inventory to /assistant/document-index.
//
// Keying: the index is scoped by the `generated_document` target id the chat
// sends. ai-services stores chunks under `envelope_id` and resolves the query
// scope with `resolveDocumentScopeId(targets) = envelopeId ?? documentId`; the
// in-form path emits no `envelope` target, so the `generated_document` id IS the
// scope key. It is read here from the very same `getTargets()` the chat body uses
// rather than re-derived, because an index keyed on a different id than the query
// silently returns nothing - which is indistinguishable from not indexing at all.

import { useEffect } from 'react';
import { buildIndexBlocks, IndexBlock } from './syncfusionDocumentOps';
import { subscribeDocxEditors } from './docxEditorRegistry';

// The registry fires when DocxEditor hands over its live instance, which happens
// as soon as Syncfusion finishes `created` - BEFORE the .docx is fetched,
// converted server-side and opened. At that moment the editor holds a blank
// document, so its inventory is empty. Poll until content appears instead of
// giving up: an empty POST would embed nothing and clobber the index.
// Serializing a blank document is cheap, so the expensive full serialize happens
// exactly once, on the tick that finds content.
export const INDEX_POLL_MS = 500;
export const INDEX_MAX_POLLS = 40; // 20s of headroom for a large docx conversion

// Re-index this long after content settles. Robin's own bulk edits, a user's
// typing and a regenerate (which re-opens a new document into the same editor
// instance, so no fresh registration fires) all arrive as content changes.
export const REINDEX_DEBOUNCE_MS = 5000;

export const GENERATED_DOCUMENT_TARGET_TYPE = 'generated_document';

type Target = { type: string; id: string };

// Per-scope index sync state. Module scope, not component state, on purpose: a
// remount of the chat, a re-render, or a second Robin request must not re-POST
// unchanged content - and the freshness answer must survive all of those too.
//
// The freshness contract (S3, "staleness must be detectable, not silent"):
//   - `changeSeq` bumps on EVERY contentChange, immediately, no debounce. The
//     document goes stale the instant it changes; the 5s re-index debounce is
//     the repair, not the detector.
//   - `postedSeq`/`postedHash` record which change generation the server's
//     index corresponds to. dirty === (changeSeq !== postedSeq).
//   - The same digest is sent to the server as `contentHash` with each index
//     POST and again as `document_state.indexHash` with each chat request, so
//     the server can compare what it stored against what this client is
//     looking at. Both values come from this one function; the server only
//     ever tests them for equality.
interface ScopeIndexState {
  // Digest the server confirmed it stored, null until the first clean POST.
  postedHash: string | null;
  postedAt: number | null;
  // Change generation the posted snapshot was built from.
  postedSeq: number;
  // Bumped synchronously on every contentChange.
  changeSeq: number;
  dirtySince: number | null;
  // Digest currently being POSTed, so overlapping triggers cannot double-post.
  inFlightHash: string | null;
}

const scopeState = new Map<string, ScopeIndexState>();

const stateFor = (scopeId: string): ScopeIndexState => {
  let state = scopeState.get(scopeId);
  if (!state) {
    state = {
      postedHash: null,
      postedAt: null,
      postedSeq: 0,
      changeSeq: 0,
      dirtySince: null,
      inFlightHash: null
    };
    scopeState.set(scopeId, state);
  }
  return state;
};

export const _resetDocumentIndexState = (): void => scopeState.clear();

// What the chat sends as `context.document_state` on every request from a
// document surface. ai-services compares `indexHash` against the hash stored
// with the index and refuses semantic search while `indexDirty` - a stale
// index returning plausible-but-wrong anchors is strictly worse than a loud
// refusal.
export interface DocumentIndexFreshness {
  indexHash: string | null;
  indexDirty: boolean;
  dirtyForSeconds?: number;
}

export const getDocumentIndexFreshness = (
  scopeId: string
): DocumentIndexFreshness => {
  const state = scopeState.get(scopeId);
  // No confirmed POST yet this session: the server may hold an index from an
  // earlier session or another submitter, and this client cannot vouch for it.
  if (!state || state.postedHash === null)
    return { indexHash: null, indexDirty: true };
  if (state.changeSeq === state.postedSeq)
    return { indexHash: state.postedHash, indexDirty: false };
  return {
    indexHash: state.postedHash,
    indexDirty: true,
    dirtyForSeconds:
      state.dirtySince === null
        ? 0
        : Math.round((Date.now() - state.dirtySince) / 1000)
  };
};

// The instant-staleness half of the contract: called synchronously from the
// editor's contentChange, before any debounce.
const markScopeDirty = (scopeId: string): void => {
  const state = stateFor(scopeId);
  state.changeSeq++;
  if (state.dirtySince === null) state.dirtySince = Date.now();
};

// Cheap, stable digest of the posted payload. Only ever compared against itself,
// so collision resistance does not matter; length + content sensitivity does.
const fingerprint = (blocks: IndexBlock[]): string => {
  const serialized = JSON.stringify(blocks);
  let hash = 5381;
  for (let i = 0; i < serialized.length; i++) {
    hash = ((hash << 5) + hash + serialized.charCodeAt(i)) | 0;
  }
  return `${serialized.length}:${hash}`;
};

export type PostDocumentIndexArgs = {
  // `${origin}/agent/assistant/` - the same base the chat posts to.
  baseUrl: string;
  // The `generated_document` target id; the index scope key.
  generatedDocumentId: string;
  blocks: IndexBlock[];
  headers: () => Record<string, string>;
  // Document-level digest of `blocks`; the server stores it with the index so
  // a later query can tell whether the index matches what this client sees.
  contentHash?: string;
};

// What the index endpoint reports it did. `failed` counts blocks whose
// embedding failed (they are NOT in the index); `storedBlocks` is how many
// blocks the scope holds after the sync. Older servers return neither.
export interface PostDocumentIndexResult {
  posted: boolean;
  failed?: number;
  storedBlocks?: number;
}

// POST the block inventory. Returns { posted: false } (nothing sent) when the
// scope key or the blocks are missing - never POST an empty inventory.
export const postDocumentIndex = async ({
  baseUrl,
  generatedDocumentId,
  blocks,
  headers,
  contentHash
}: PostDocumentIndexArgs): Promise<PostDocumentIndexResult> => {
  if (!baseUrl || !generatedDocumentId || !blocks?.length)
    return { posted: false };
  const res = await fetch(`${baseUrl}document-index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers() },
    // Both fields carry the same id: ai-services takes
    // `envelopeId?.trim() || documentId?.trim()` as the scope key, and the
    // in-form document has no envelope of its own.
    body: JSON.stringify({
      envelopeId: generatedDocumentId,
      documentId: generatedDocumentId,
      blocks,
      ...(contentHash ? { contentHash, blockCount: blocks.length } : {})
    })
  });
  if (!res.ok) throw new Error(`document-index failed (${res.status})`);
  let body: any;
  try {
    body = await res.json();
  } catch {
    body = undefined; // older server; nothing to verify against
  }
  return {
    posted: true,
    failed: typeof body?.failed === 'number' ? body.failed : undefined,
    storedBlocks:
      typeof body?.storedBlocks === 'number' ? body.storedBlocks : undefined
  };
};

// Indexing is best-effort: Robin still works from live `findDocumentOccurrences`,
// which the prompt names authoritative. But it must be loud in the console when
// it does not happen - a silently empty index is exactly what let this wiring go
// missing unnoticed.
const warn = (message: string, detail?: unknown) =>
  detail === undefined
    ? console.warn(`Feathery: ${message}`)
    : console.warn(`Feathery: ${message}`, detail);

// Read the editor and sync the index. Returns true once indexing has been
// initiated for the scope (content existed), which is the poll loop's stop
// signal.
const indexNow = (
  editor: any,
  baseUrl: string,
  generatedDocumentId: string,
  headers: () => Record<string, string>
): boolean => {
  let blocks: IndexBlock[];
  try {
    blocks = buildIndexBlocks(editor);
  } catch (err) {
    warn('could not read the document for indexing', err);
    return false;
  }
  if (blocks.length === 0) return false;

  const state = stateFor(generatedDocumentId);
  const digest = fingerprint(blocks);
  // The change generation this snapshot represents. Captured before the async
  // POST so an edit that lands mid-flight keeps the scope dirty.
  const seqAtBuild = state.changeSeq;

  if (state.postedHash === digest) {
    // The server already holds exactly this content - e.g. a burst of edits
    // that netted out to no change. The index is fresh again; say so.
    state.postedSeq = seqAtBuild;
    if (state.changeSeq === seqAtBuild) state.dirtySince = null;
    return true;
  }
  // Claim the digest before the request so two overlapping triggers cannot
  // both POST the same content; drop the claim when the POST settles.
  if (state.inFlightHash === digest) return true;
  state.inFlightHash = digest;

  postDocumentIndex({
    baseUrl,
    generatedDocumentId,
    blocks,
    headers,
    contentHash: digest
  })
    .then(({ failed, storedBlocks }) => {
      state.inFlightHash = null;
      // The server reporting fewer blocks than were sent (or failed embeds)
      // means the index does NOT hold this document. Refuse to mark it fresh:
      // postedHash stays unset so the next trigger re-posts, and queries keep
      // failing loud instead of silently missing content.
      if (
        (typeof failed === 'number' && failed > 0) ||
        (typeof storedBlocks === 'number' && storedBlocks !== blocks.length)
      ) {
        state.postedHash = null;
        if (state.dirtySince === null) state.dirtySince = Date.now();
        warn(
          `document index for ${generatedDocumentId} is incomplete ` +
            `(sent ${blocks.length} blocks, stored ${
              storedBlocks ?? 'unknown'
            }, ` +
            `${
              failed ?? 0
            } failed embeds) - semantic search will refuse until a re-index succeeds`
        );
        return;
      }
      state.postedHash = digest;
      state.postedAt = Date.now();
      state.postedSeq = seqAtBuild;
      // Only declare the scope clean when nothing changed while the POST was
      // in flight; otherwise the pending debounce re-posts and clears it.
      if (state.changeSeq === seqAtBuild) state.dirtySince = null;
    })
    .catch((err) => {
      state.inFlightHash = null;
      if (state.dirtySince === null) state.dirtySince = Date.now();
      warn(
        `document index POST failed for ${generatedDocumentId} - semantic document search will return nothing`,
        err
      );
    });
  return true;
};

type UseDocumentIndexArgs = {
  baseUrl: string;
  // The chat's own target builder, so index and query key on the same id.
  getTargets: () => Target[];
  // The chat's own header factory, so index and chat authenticate identically.
  headers: () => Record<string, string>;
};

// Indexes the in-form document whenever an editor with a loaded document is
// available. Mounted from AssistantChat, which is rendered only when Assist is
// enabled - the same gate the old implementation applied explicitly.
//
// Never blocks: every trigger schedules work on a timer and the POST itself is
// fire-and-forget, so nothing here can delay the editor becoming usable or a
// Robin request starting.
export function useDocumentIndex({
  baseUrl,
  getTargets,
  headers
}: UseDocumentIndexArgs): void {
  useEffect(() => {
    if (!baseUrl) return;

    const timers = new Set<ReturnType<typeof setTimeout>>();
    const watched = new Set<any>();
    const detach: (() => void)[] = [];
    let cancelled = false;

    const later = (fn: () => void, ms: number) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!cancelled) fn();
      }, ms);
      timers.add(timer);
      return timer;
    };

    const scopeId = (): string | undefined =>
      getTargets().find((t) => t.type === GENERATED_DOCUMENT_TARGET_TYPE)?.id;

    const onEditor = (editor: any) => {
      if (!editor || watched.has(editor)) return;
      watched.add(editor);

      let polls = 0;
      const poll = () => {
        const generatedDocumentId = scopeId();
        // No document target yet (the generate action has not run): there is
        // nothing to key an index on, so keep waiting rather than guessing an id.
        if (
          generatedDocumentId &&
          indexNow(editor, baseUrl, generatedDocumentId, headers)
        )
          return;
        if (++polls < INDEX_MAX_POLLS) later(poll, INDEX_POLL_MS);
        else
          warn(
            'gave up indexing the in-form document: no content after ' +
              `${(INDEX_MAX_POLLS * INDEX_POLL_MS) / 1000}s`
          );
      };
      // Yield the frame first so indexing never competes with the editor's
      // first paint, then start immediately - the sooner the index lands, the
      // smaller the window in which a Robin request sees a cold index.
      later(poll, 0);

      // Keep the index current: a regenerate re-opens a new document into this
      // same editor instance, so no fresh registration fires and this is the
      // only signal. The dirty mark is synchronous - the index is stale the
      // instant the document changes, and queries must see that immediately -
      // while the re-index itself is debounced, and the fingerprint check
      // means a settled edit that produced no net change costs nothing.
      let debounce: ReturnType<typeof setTimeout> | null = null;
      const onContentChange = () => {
        const dirtyScopeId = scopeId();
        if (dirtyScopeId) markScopeDirty(dirtyScopeId);
        if (debounce) clearTimeout(debounce);
        debounce = later(() => {
          const generatedDocumentId = scopeId();
          if (generatedDocumentId)
            indexNow(editor, baseUrl, generatedDocumentId, headers);
        }, REINDEX_DEBOUNCE_MS);
      };
      try {
        editor.addEventListener?.('contentChange', onContentChange);
        detach.push(() =>
          editor.removeEventListener?.('contentChange', onContentChange)
        );
      } catch (err) {
        warn('could not watch the document for re-indexing', err);
      }
    };

    const unsubscribe = subscribeDocxEditors(onEditor);
    return () => {
      cancelled = true;
      unsubscribe();
      timers.forEach(clearTimeout);
      timers.clear();
      detach.forEach((off) => {
        try {
          off();
        } catch {
          /* editor already torn down */
        }
      });
    };
  }, [baseUrl, getTargets, headers]);
}
