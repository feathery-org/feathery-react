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
interface ConfirmedIndexBlock {
  anchor: string;
  // Retain the exact SHA-256 source so the confirmed snapshot is auditable and
  // cannot accidentally drift from the server's text-only hashing contract.
  text: string;
}

// Serialized inventory of the editor at one instant, with its digest computed
// once so the poll's stability check and the POST share the same reading.
interface IndexSnapshot {
  blocks: IndexBlock[];
  digest: string;
}

interface PendingIndexSync {
  snapshot: IndexSnapshot;
  baseUrl: string;
  targets: DocumentIndexTarget[];
  headers: () => Record<string, string>;
  forceFull: boolean;
}

interface ScopeIndexState {
  currentHash: string | null;
  postedHash: string | null;
  inFlightHash: string | null;
  confirmedBlocks: Map<string, ConfirmedIndexBlock[]> | null;
  pendingSync: PendingIndexSync | null;
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
      inFlightHash: null,
      confirmedBlocks: null,
      pendingSync: null
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

export type DocumentIndexAnchorRemap =
  | { hash: string; anchor: string }
  | { hash: string; anchors: string[] };

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
  delta?: {
    baseHash: string;
    changedBlocks: IndexBlock[];
    removedHashes: string[];
    anchorRemap: DocumentIndexAnchorRemap[];
  };
};

// What the index endpoint reports it did. `failed` counts blocks whose
// embedding failed (they are NOT in the index); `storedBlocks` is how many
// blocks the scope holds after the sync. Older servers return neither.
export interface PostDocumentIndexResult {
  posted: boolean;
  failed?: number;
  storedBlocks?: number;
  deltaBaseMismatch?: boolean;
}

// POST the block inventory. Returns { posted: false } (nothing sent) when the
// envelope target or blocks are missing - never POST an empty inventory.
export const postDocumentIndex = async ({
  baseUrl,
  targets,
  blocks,
  headers,
  contentHash,
  delta
}: PostDocumentIndexArgs): Promise<PostDocumentIndexResult> => {
  const envelopeTarget = getDocumentTarget(targets);
  if (!baseUrl || !envelopeTarget || !blocks?.length) return { posted: false };
  const formKey = targets.find((target) => target.type === 'panel')?.id;
  const res = await fetch(`${baseUrl}document-index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers() },
    body: JSON.stringify(
      delta
        ? {
            envelopeId: envelopeTarget.id,
            targets,
            ...(formKey ? { form_key: formKey } : {}),
            mode: 'delta',
            baseHash: delta.baseHash,
            contentHash,
            changedBlocks: delta.changedBlocks,
            removedHashes: delta.removedHashes,
            anchorRemap: delta.anchorRemap,
            blockCount: blocks.length
          }
        : {
            envelopeId: envelopeTarget.id,
            targets,
            blocks,
            ...(formKey ? { form_key: formKey } : {}),
            ...(contentHash ? { contentHash, blockCount: blocks.length } : {})
          }
    )
  });
  let body: any;
  try {
    body = await res.json();
  } catch {
    body = undefined; // older server; nothing to verify against
  }
  if (
    res.status === 409 &&
    body?.error === 'delta_base_mismatch' &&
    body?.fallback === 'full'
  )
    return { posted: true, deltaBaseMismatch: true };
  if (!res.ok) throw new Error(`document-index failed (${res.status})`);
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

interface HashedIndexSnapshot {
  blocksByHash: Map<string, IndexBlock[]>;
  confirmedBlocks: Map<string, ConfirmedIndexBlock[]>;
}

interface DocumentIndexDelta {
  baseHash: string;
  changedBlocks: IndexBlock[];
  removedHashes: string[];
  anchorRemap: DocumentIndexAnchorRemap[];
}

export const DOCUMENT_INDEX_DELTA_CHANGED_RATIO = 0.6;

// Match ai-services' `createHash('sha256').update(text).digest('hex')`: Web
// Crypto digests TextEncoder's UTF-8 bytes and emits the same lowercase hex.
export const _hashDocumentIndexBlockText = async (
  text: string
): Promise<string> => {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === 'undefined')
    throw new Error('Web Crypto SHA-256 is unavailable');
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
};

const hashSnapshot = async (
  blocks: IndexBlock[]
): Promise<HashedIndexSnapshot | null> => {
  let hashes: string[];
  try {
    hashes = await Promise.all(
      blocks.map(({ text }) => _hashDocumentIndexBlockText(text))
    );
  } catch {
    // Indexing must keep working on an older/non-secure browser even when
    // Web Crypto is unavailable. It simply remains on the full-sync path.
    return null;
  }
  const blocksByHash = new Map<string, IndexBlock[]>();
  const confirmedBlocks = new Map<string, ConfirmedIndexBlock[]>();
  blocks.forEach((block, index) => {
    const hash = hashes[index];
    const hashedBlocks = blocksByHash.get(hash) ?? [];
    hashedBlocks.push(block);
    blocksByHash.set(hash, hashedBlocks);
    const confirmed = confirmedBlocks.get(hash) ?? [];
    confirmed.push({ anchor: block.anchor, text: block.text });
    confirmedBlocks.set(hash, confirmed);
  });
  return { blocksByHash, confirmedBlocks };
};

const buildDelta = (
  blocks: IndexBlock[],
  digest: string,
  hashed: HashedIndexSnapshot,
  state: ScopeIndexState
): DocumentIndexDelta | null => {
  const previous = state.confirmedBlocks;
  if (!state.postedHash || !previous) return null;

  const changedBlocks: IndexBlock[] = [];
  const removedHashes: string[] = [];
  const anchorRemap: DocumentIndexAnchorRemap[] = [];
  for (const [hash, current] of hashed.blocksByHash) {
    const prior = previous.get(hash);
    if (!prior) {
      if (current.length > 1) return null;
      changedBlocks.push(...current);
      continue;
    }
    // A repeated group can be remapped only while its occurrences still pair
    // one-to-one in document order. An add/remove is ambiguous, so that sync
    // stays on the full path.
    if (
      prior.length !== current.length ||
      current.some((block, index) => block.text !== prior[index].text)
    )
      return null;
    if (current.every((block, index) => block.anchor === prior[index].anchor))
      continue;
    if (current.length === 1)
      anchorRemap.push({ hash, anchor: current[0].anchor });
    else
      anchorRemap.push({
        hash,
        anchors: current.map((block) => block.anchor)
      });
  }
  for (const [hash, prior] of previous) {
    if (hashed.blocksByHash.has(hash)) continue;
    if (prior.length > 1) return null;
    removedHashes.push(hash);
  }

  if (changedBlocks.length / blocks.length > DOCUMENT_INDEX_DELTA_CHANGED_RATIO)
    return null;
  const delta = {
    baseHash: state.postedHash,
    changedBlocks,
    removedHashes,
    anchorRemap
  };
  // Count is the primary compaction guard; this catches deletion-heavy and
  // unusually short-text documents where hashes/remaps outweigh a full body.
  if (
    JSON.stringify({
      mode: 'delta',
      ...delta,
      contentHash: digest,
      blockCount: blocks.length
    }).length >=
    JSON.stringify({ blocks, contentHash: digest, blockCount: blocks.length })
      .length
  )
    return null;
  return delta;
};

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
const performSnapshotSync = async (
  { blocks, digest }: IndexSnapshot,
  baseUrl: string,
  targets: DocumentIndexTarget[],
  headers: () => Record<string, string>,
  state: ScopeIndexState,
  target: DocumentIndexTarget,
  forceFull: boolean
): Promise<void> => {
  const hashed = await hashSnapshot(blocks);
  const delta =
    !forceFull && hashed ? buildDelta(blocks, digest, hashed, state) : null;
  // Which protocol the result below describes. The two differ in what the
  // server has already DONE by the time it reports an incomplete sync.
  let postedDelta = !!delta;
  let result = await postDocumentIndex({
    baseUrl,
    targets,
    blocks,
    headers,
    contentHash: digest,
    ...(delta ? { delta } : {})
  });
  if (result.deltaBaseMismatch) {
    // The server is authoritative about the CAS base. Forget the local base
    // before rebuilding it with the same current full inventory.
    state.postedHash = null;
    state.confirmedBlocks = null;
    postedDelta = false;
    result = await postDocumentIndex({
      baseUrl,
      targets,
      blocks,
      headers,
      contentHash: digest
    });
  }

  const { failed, storedBlocks } = result;
  // The server reporting fewer blocks than were sent (or failed embeds) means
  // the index does NOT hold this document.
  if (
    (typeof failed === 'number' && failed > 0) ||
    (typeof storedBlocks === 'number' && storedBlocks !== blocks.length)
  ) {
    warn(
      `document index for target ${target.id} is incomplete ` +
        `(sent ${blocks.length} blocks, stored ${storedBlocks ?? 'unknown'}, ` +
        `${
          failed ?? 0
        } failed embeds) - semantic search will refuse until a re-index succeeds`
    );
    // A REFUSED DELTA MUTATED NOTHING: the service returns before applyDelta
    // when an embed fails, so the chunks and the freshness marker are both still
    // the base this client holds, and keeping it lets a retry finish the same
    // compare-and-swap. That is why this base was preserved.
    //
    // A FULL POST IS THE OPPOSITE. It upserts every block that did embed and
    // removes vanished anchors BEFORE it reports the failure, and it then skips
    // the freshness marker - so the index has already moved while the server
    // still answers with the OLD content hash. Keeping that base here would let
    // the next delta pass compare-and-swap over a half-written index and stamp
    // it fresh: the stale certification. Forget it, so the next sync is another
    // full post that re-sends everything.
    if (!postedDelta) {
      state.postedHash = null;
      state.confirmedBlocks = null;
    }
    return;
  }
  state.postedHash = digest;
  state.confirmedBlocks = hashed?.confirmedBlocks ?? null;
};

const syncSnapshot = (
  snapshot: IndexSnapshot,
  baseUrl: string,
  targets: DocumentIndexTarget[],
  headers: () => Record<string, string>,
  forceFull = false
): void => {
  const { digest } = snapshot;
  const target = getDocumentTarget(targets);
  if (!target) return;
  const state = stateFor(target);
  // The freshness claim the chat sends tracks what this client last computed,
  // whether or not the POST below happens or succeeds
  state.currentHash = digest;

  // The server already holds exactly this content - e.g. a burst of edits
  // that netted out to no change, or a reopen of the same document
  if (!forceFull && state.postedHash === digest) return;
  // A delta's base must be the last confirmed server hash, so serialize each
  // scope and retain only the newest snapshot that arrived while it was busy.
  if (state.inFlightHash) {
    if (state.inFlightHash !== digest)
      state.pendingSync = { snapshot, baseUrl, targets, headers, forceFull };
    return;
  }
  state.inFlightHash = digest;

  performSnapshotSync(
    snapshot,
    baseUrl,
    targets,
    headers,
    state,
    target,
    forceFull
  )
    .catch((err) => {
      warn(
        `document index POST failed for target ${target.id} - semantic document search will return nothing`,
        err
      );
    })
    .finally(() => {
      state.inFlightHash = null;
      const pending = state.pendingSync;
      state.pendingSync = null;
      if (pending)
        syncSnapshot(
          pending.snapshot,
          pending.baseUrl,
          pending.targets,
          pending.headers,
          pending.forceFull
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
  forceFull = false
): boolean => {
  const snapshot = readSnapshot(editor);
  if (!snapshot) return false;
  syncSnapshot(snapshot, baseUrl, targets, headers, forceFull);
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

      const initialTarget = getDocumentTarget(currentTargets());
      let currentScopeKey = initialTarget
        ? documentTargetKey(initialTarget)
        : null;

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
              currentScopeKey = documentTargetKey(envelopeTarget);
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
      // serialize + POST are deferred off Syncfusion's dispatch stack.
      const onDocumentChange = () => {
        later(() => {
          const targets = currentTargets();
          const target = getDocumentTarget(targets);
          if (!target) return;
          const nextScopeKey = documentTargetKey(target);
          const scopeChanged = currentScopeKey !== nextScopeKey;
          // Only a changed envelope needs a byte-identical-tolerant full sync.
          // Same-scope accept/reject events keep the normal delta path; its
          // >60%-changed guard already promotes genuinely large changes to full.
          if (indexNow(editor, baseUrl, targets, headers, scopeChanged)) {
            currentScopeKey = nextScopeKey;
            settled = true;
          }
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
          const target = getDocumentTarget(targets);
          if (target && indexNow(editor, baseUrl, targets, headers))
            currentScopeKey = documentTargetKey(target);
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
