// In-form document indexing (HILB Contract C). ai-services requires a queryable
// semantic index before every bulk document edit: `discoverIndexedDocumentCandidates`
// and `searchGeneratedDocument` read `generated_doc_chunk`, and nothing else
// populates it on the in-form path (there is no envelope / pgvector pipeline for
// a document opened in the form). So when the in-form document editor comes up
// with a loaded document, POST its block inventory to /assistant/document-index.
//
// Trust boundary: the browser sends the same target manifest as chat, never a
// storage key. feathery-backend validates the panel/template relationship,
// derives the newest-created envelope from the authenticated fuser, and sends a
// typed server-only scope to ai-services.

import { useEffect } from 'react';
import { buildIndexBlocks, IndexBlock } from './syncfusionDocumentOps';
import { subscribeDocxEditors } from './docxEditorRegistry';

// The registry fires when DocxEditor hands over its live instance, which happens
// as soon as Syncfusion finishes `created` - BEFORE the .docx is fetched,
// converted server-side and opened. At that moment the editor holds a blank
// document, so its inventory is empty. Poll until content appears instead of
// giving up: an empty POST would embed nothing and clobber the index.
//
// Content appearing is NOT the same as the document having loaded. `openAsync`
// lays the document out section by section, and the serialized model grows with
// it - with no contentChange along the way - so the first tick that sees
// content may hold only the leading sections (live failure: a generated
// proposal's index held nothing but its TOC, and the freshness gate certified
// it). Two guards close that hole:
//   - the poll POSTs only a snapshot whose fingerprint held still for
//     INDEX_STABLE_POLLS consecutive ticks, so a mid-load model is never
//     mistaken for the document;
//   - `documentChange` - Syncfusion's once-per-open signal, fired after the
//     full layout in both the sync and async open paths - forces a re-index,
//     catching a load that pauses long enough to fool the stability check.
export const INDEX_POLL_MS = 500;
export const INDEX_MAX_POLLS = 40; // 20s of headroom for a large docx conversion
export const INDEX_STABLE_POLLS = 2;

// Re-index this long after content settles. Robin's own bulk edits, a user's
// typing and a regenerate (which re-opens a new document into the same editor
// instance, so no fresh registration fires) all arrive as content changes.
export const REINDEX_DEBOUNCE_MS = 5000;

export const GENERATED_DOCUMENT_TARGET_TYPE = 'generated_document';

export type DocumentIndexTarget = { type: string; id: string };

const getDocumentTarget = (
  targets: DocumentIndexTarget[]
): DocumentIndexTarget | undefined =>
  targets.find((target) => target.type === GENERATED_DOCUMENT_TARGET_TYPE);

const documentTargetKey = (target: DocumentIndexTarget): string =>
  `${target.type}:${target.id}`;

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

const stateFor = (target: DocumentIndexTarget): ScopeIndexState => {
  const targetKey = documentTargetKey(target);
  let state = scopeState.get(targetKey);
  if (!state) {
    state = {
      postedHash: null,
      postedAt: null,
      postedSeq: 0,
      changeSeq: 0,
      dirtySince: null,
      inFlightHash: null
    };
    scopeState.set(targetKey, state);
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
  target: DocumentIndexTarget
): DocumentIndexFreshness => {
  const state = scopeState.get(documentTargetKey(target));
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
const markTargetDirty = (target: DocumentIndexTarget): void => {
  const state = stateFor(target);
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
  // The authenticated chat target manifest. It identifies the user's current
  // resource but cannot select ai-services persistence.
  targets: DocumentIndexTarget[];
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
// generated-document target or blocks are missing - never POST an empty inventory.
export const postDocumentIndex = async ({
  baseUrl,
  targets,
  blocks,
  headers,
  contentHash
}: PostDocumentIndexArgs): Promise<PostDocumentIndexResult> => {
  if (!baseUrl || !getDocumentTarget(targets) || !blocks?.length)
    return { posted: false };
  const res = await fetch(`${baseUrl}document-index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers() },
    body: JSON.stringify({
      targets,
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

// Serialized inventory of the editor at one instant, with its digest computed
// once so the poll's stability check and the POST share the same reading.
interface IndexSnapshot {
  blocks: IndexBlock[];
  digest: string;
}

// Read the editor's current inventory. null means unreadable or no content
// yet - never POST either.
const readSnapshot = (editor: any): IndexSnapshot | null => {
  let blocks: IndexBlock[];
  try {
    blocks = buildIndexBlocks(editor);
  } catch (err) {
    warn('could not read the document for indexing', err);
    return null;
  }
  if (blocks.length === 0) return null;
  return { blocks, digest: fingerprint(blocks) };
};

// Sync a snapshot to the server (no-op when the server already holds it).
const syncSnapshot = (
  { blocks, digest }: IndexSnapshot,
  baseUrl: string,
  targets: DocumentIndexTarget[],
  headers: () => Record<string, string>,
  force = false
): void => {
  const target = getDocumentTarget(targets);
  if (!target) return;
  const state = stateFor(target);
  // The change generation this snapshot represents. Captured before the async
  // POST so an edit that lands mid-flight keeps the scope dirty.
  const seqAtBuild = state.changeSeq;

  if (!force && state.postedHash === digest) {
    // The server already holds exactly this content - e.g. a burst of edits
    // that netted out to no change, or a reopen of the same document. The
    // index is fresh again; say so.
    state.postedSeq = seqAtBuild;
    if (state.changeSeq === seqAtBuild) state.dirtySince = null;
    return;
  }
  // Claim the digest before the request so two overlapping triggers cannot
  // both POST the same content; drop the claim when the POST settles.
  if (state.inFlightHash === digest) return;
  state.inFlightHash = digest;

  postDocumentIndex({
    baseUrl,
    targets,
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
          `document index for target ${target.id} is incomplete ` +
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
        `document index POST failed for target ${target.id} - semantic document search will return nothing`,
        err
      );
    });
};

// Read the editor and sync the index. Returns true once indexing has been
// initiated for the scope (content existed).
const indexNow = (
  editor: any,
  baseUrl: string,
  targets: DocumentIndexTarget[],
  headers: () => Record<string, string>,
  force = false
): boolean => {
  const snapshot = readSnapshot(editor);
  if (!snapshot) return false;
  syncSnapshot(snapshot, baseUrl, targets, headers, force);
  return true;
};

type UseDocumentIndexArgs = {
  baseUrl: string;
  // The chat's own target builder; backend resolves both requests identically.
  getTargets: () => DocumentIndexTarget[];
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

    const onEditor = (editor: any) => {
      if (!editor || watched.has(editor)) return;
      watched.add(editor);

      let polls = 0;
      let lastDigest: string | null = null;
      let stablePolls = 0;
      // Set once the initial index has been initiated (by a stable poll or by
      // documentChange); stops the poll loop.
      let settled = false;
      const poll = () => {
        if (settled) return;
        const targets = getTargets();
        const documentTarget = getDocumentTarget(targets);
        // No document target yet (the generate action has not run): there is
        // nothing to authorize, so keep waiting rather than guessing a target.
        if (documentTarget) {
          const snapshot = readSnapshot(editor);
          if (snapshot) {
            if (snapshot.digest === lastDigest) stablePolls++;
            else {
              // Content present but still growing (a progressive openAsync
              // load) - wait for it to hold still before vouching for it.
              lastDigest = snapshot.digest;
              stablePolls = 1;
            }
            if (stablePolls >= INDEX_STABLE_POLLS) {
              settled = true;
              syncSnapshot(snapshot, baseUrl, targets, headers);
              return;
            }
          } else {
            lastDigest = null;
            stablePolls = 0;
          }
        }
        if (++polls < INDEX_MAX_POLLS) later(poll, INDEX_POLL_MS);
        else
          warn(
            'gave up indexing the in-form document: no stable content after ' +
              `${(INDEX_MAX_POLLS * INDEX_POLL_MS) / 1000}s`
          );
      };
      // Yield the frame first so indexing never competes with the editor's
      // first paint, then start immediately - the sooner the index lands, the
      // smaller the window in which a Robin request sees a cold index.
      later(poll, 0);

      // Syncfusion fires `documentChange` exactly once per open, after the
      // FULL layout completes (sync and async paths alike) - the authoritative
      // load-complete signal. It covers what the stability poll cannot: a load
      // that pauses mid-way for longer than the stability window, and it also
      // usually lands the index sooner than the next poll tick would. The
      // dirty mark is synchronous (a newly opened document is not the document
      // the server indexed until proven otherwise); the serialize + POST are
      // deferred off Syncfusion's dispatch stack. Even unchanged content is
      // posted because regeneration may have selected a new server envelope.
      const onDocumentChange = () => {
        const changedTarget = getDocumentTarget(getTargets());
        if (changedTarget) markTargetDirty(changedTarget);
        later(() => {
          const targets = getTargets();
          if (
            getDocumentTarget(targets) &&
            // A regeneration can produce byte-identical content under a new
            // server-derived envelope. Force this load-complete sync so the new
            // envelope never inherits a local "already posted" assumption.
            indexNow(editor, baseUrl, targets, headers, true)
          )
            settled = true;
        }, 0);
      };

      // Keep the index current: a regenerate re-opens a new document into this
      // same editor instance, so no fresh registration fires and this is the
      // only signal. The dirty mark is synchronous - the index is stale the
      // instant the document changes, and queries must see that immediately -
      // while the re-index itself is debounced, and the fingerprint check
      // means a settled edit that produced no net change costs nothing.
      let debounce: ReturnType<typeof setTimeout> | null = null;
      const onContentChange = () => {
        const dirtyTarget = getDocumentTarget(getTargets());
        if (dirtyTarget) markTargetDirty(dirtyTarget);
        if (debounce) clearTimeout(debounce);
        debounce = later(() => {
          const targets = getTargets();
          if (getDocumentTarget(targets))
            indexNow(editor, baseUrl, targets, headers);
        }, REINDEX_DEBOUNCE_MS);
      };
      try {
        editor.addEventListener?.('contentChange', onContentChange);
        editor.addEventListener?.('documentChange', onDocumentChange);
        detach.push(() => {
          editor.removeEventListener?.('contentChange', onContentChange);
          editor.removeEventListener?.('documentChange', onDocumentChange);
        });
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
