// In-form document indexing (HILB Contract C). ai-services requires a queryable
// semantic index before every bulk document edit: `discoverIndexedDocumentCandidates`
// and `searchGeneratedDocument` read `generated_doc_chunk`, and nothing else
// populates it on the in-form path. So when the in-form document editor comes
// up with a loaded envelope, POST its block inventory to
// /assistant/document-index.
//
// Trust boundary: the index push is fully verified by feathery-backend
// (panel/template relationship, envelope verified against the target-derived
// form submission) and stamps the verified identity onto the index. Chat
// reads send the envelope target as a claim, authorized in ai-services
// against those stamps.

import { useEffect } from 'react';
import { buildIndexBlocks, IndexBlock } from './syncfusionDocumentOps';
import {
  DocxEditorRegistration,
  subscribeDocxEditors
} from './docxEditorRegistry';

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
export const ENVELOPE_TARGET_TYPE = 'envelope';

export type DocumentIndexTarget = { type: string; id: string };

const getDocumentTarget = (
  targets: DocumentIndexTarget[]
): DocumentIndexTarget | undefined =>
  targets.find((target) => target.type === ENVELOPE_TARGET_TYPE);

const getGeneratedDocumentTarget = (
  targets: DocumentIndexTarget[]
): DocumentIndexTarget | undefined =>
  targets.find((target) => target.type === GENERATED_DOCUMENT_TARGET_TYPE);

const documentTargetKey = (target: DocumentIndexTarget): string =>
  `${target.type}:${target.id}`;

// Per-scope index sync state. Module scope, not component state, on purpose: a
// remount of the chat, a re-render, or a second Robin request must not re-POST
// unchanged content - and the freshness answer must survive all of those too.
//
// The freshness contract: `currentHash` is the digest of the last snapshot
// this client computed (recomputed on the debounced re-index). The chat sends
// it on the envelope target as `contentHash`; the server compares it to the
// digest stored with the index - match fresh, mismatch stale. Anything this
// client cannot vouch for claims a sentinel no stored digest can equal, so an
// unverified index reads stale rather than falsely fresh.
interface ScopeIndexState {
  currentHash: string | null;
  postedHash: string | null;
  inFlightHash: string | null;
}

const PENDING_PREFIX = 'pending:';
const PENDING_UNINDEXED = `${PENDING_PREFIX}unindexed`;

const scopeState = new Map<string, ScopeIndexState>();

const stateFor = (target: DocumentIndexTarget): ScopeIndexState => {
  const targetKey = documentTargetKey(target);
  let state = scopeState.get(targetKey);
  if (!state) {
    state = {
      currentHash: null,
      postedHash: null,
      inFlightHash: null
    };
    scopeState.set(targetKey, state);
  }
  return state;
};

export const _resetDocumentIndexState = (): void => scopeState.clear();

// The hash the chat attaches to the envelope target it sends with every
// request. Before the first snapshot there is nothing to vouch for, so the
// claim is the unmatchable sentinel until one lands.
export const getDocumentTargetContentHash = (
  target: DocumentIndexTarget
): string =>
  scopeState.get(documentTargetKey(target))?.currentHash ?? PENDING_UNINDEXED;

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
  // The authenticated chat target manifest. The backend verifies its envelope
  // against the target-derived form submission before selecting persistence.
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
// envelope target or blocks are missing - never POST an empty inventory.
export const postDocumentIndex = async ({
  baseUrl,
  targets,
  blocks,
  headers,
  contentHash
}: PostDocumentIndexArgs): Promise<PostDocumentIndexResult> => {
  const envelopeTarget = getDocumentTarget(targets);
  if (!baseUrl || !envelopeTarget || !blocks?.length) return { posted: false };
  const formKey = targets.find((target) => target.type === 'panel')?.id;
  const res = await fetch(`${baseUrl}document-index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers() },
    body: JSON.stringify({
      envelopeId: envelopeTarget.id,
      targets,
      blocks,
      ...(formKey ? { form_key: formKey } : {}),
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
  // The freshness claim the chat sends tracks what this client last computed,
  // whether or not the POST below happens or succeeds
  state.currentHash = digest;

  // The server already holds exactly this content - e.g. a burst of edits
  // that netted out to no change, or a reopen of the same document
  if (!force && state.postedHash === digest) return;
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
    })
    .catch((err) => {
      state.inFlightHash = null;
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
  formId?: string;
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
  formId,
  getTargets,
  headers
}: UseDocumentIndexArgs): void {
  useEffect(() => {
    if (!baseUrl) return;

    const timers = new Set<ReturnType<typeof setTimeout>>();
    const detach: (() => void)[] = [];
    let cancelled = false;
    let activeGeneration = 0;

    const later = (fn: () => void, ms: number) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!cancelled) fn();
      }, ms);
      timers.add(timer);
      return timer;
    };

    const onEditor = (registration?: DocxEditorRegistration) => {
      const generation = ++activeGeneration;
      const editor = registration?.editor;
      if (!editor) return;

      // Every scheduled read/event is bound to the registration that caused
      // it. A step handoff invalidates the outgoing callbacks immediately, so
      // mount-before-unmount can never index document B from editor A.
      const currentTargets = (): DocumentIndexTarget[] => {
        if (generation !== activeGeneration) return [];
        const targets = getTargets();
        const documentTarget = getGeneratedDocumentTarget(targets);
        const envelopeTarget = getDocumentTarget(targets);
        if (
          registration.documentId &&
          documentTarget?.id !== registration.documentId
        )
          return [];
        if (
          registration.envelopeId &&
          envelopeTarget?.id !== registration.envelopeId
        )
          return [];
        return targets;
      };

      let polls = 0;
      let lastDigest: string | null = null;
      let stablePolls = 0;
      // Set once the initial index has been initiated (by a stable poll or by
      // documentChange); stops the poll loop.
      let settled = false;
      const poll = () => {
        if (settled) return;
        const targets = currentTargets();
        const envelopeTarget = getDocumentTarget(targets);
        // The generated_document target mounts tools independently. Until the
        // editor has a real envelope there is no per-submission index scope.
        if (envelopeTarget) {
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
      // serialize + POST are deferred off Syncfusion's dispatch stack. Even
      // unchanged content is posted because regeneration may have selected a
      // new server envelope.
      const onDocumentChange = () => {
        later(() => {
          const targets = currentTargets();
          if (
            getDocumentTarget(targets) &&
            // A regeneration can produce byte-identical content under a new
            // envelope. Force this load-complete sync so the new envelope
            // never inherits a local "already posted" assumption.
            indexNow(editor, baseUrl, targets, headers, true)
          )
            settled = true;
        }, 0);
      };

      // Keep the index current: a regenerate re-opens a new document into this
      // same editor instance, so no fresh registration fires and this is the
      // only signal. The re-index is debounced, and the fingerprint check
      // means a settled edit that produced no net change costs nothing.
      let debounce: ReturnType<typeof setTimeout> | null = null;
      const onContentChange = () => {
        // An un-indexed edit must read stale, never falsely fresh: flip the
        // claimed hash provisional until the debounced re-index recomputes it
        const target = getDocumentTarget(currentTargets());
        const state = target && scopeState.get(documentTargetKey(target));
        if (state?.currentHash && !state.currentHash.startsWith(PENDING_PREFIX))
          state.currentHash = `${PENDING_PREFIX}${state.currentHash}`;
        if (debounce) clearTimeout(debounce);
        debounce = later(() => {
          const targets = currentTargets();
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

    const unsubscribe = subscribeDocxEditors(onEditor, formId);
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
  }, [baseUrl, formId, getTargets, headers]);
}
