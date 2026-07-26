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

// Fingerprint of what we last successfully POSTed, per scope key. Module scope,
// not component state, on purpose: a remount of the chat, a re-render, or a
// second Robin request must not re-POST unchanged content.
const lastIndexed = new Map<string, string>();

export const _resetDocumentIndexState = (): void => lastIndexed.clear();

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
};

// POST the block inventory. Returns false (nothing sent) when the scope key or
// the blocks are missing - never POST an empty inventory.
export const postDocumentIndex = async ({
  baseUrl,
  generatedDocumentId,
  blocks,
  headers
}: PostDocumentIndexArgs): Promise<boolean> => {
  if (!baseUrl || !generatedDocumentId || !blocks?.length) return false;
  const res = await fetch(`${baseUrl}document-index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers() },
    // Both fields carry the same id: ai-services takes
    // `envelopeId?.trim() || documentId?.trim()` as the scope key, and the
    // in-form document has no envelope of its own.
    body: JSON.stringify({
      envelopeId: generatedDocumentId,
      documentId: generatedDocumentId,
      blocks
    })
  });
  if (!res.ok) throw new Error(`document-index failed (${res.status})`);
  return true;
};

// Indexing is best-effort: Robin still works from live `findDocumentOccurrences`,
// which the prompt names authoritative. But it must be loud in the console when
// it does not happen - a silently empty index is exactly what let this wiring go
// missing unnoticed.
const warn = (message: string, detail?: unknown) =>
  detail === undefined
    ? console.warn(`Feathery: ${message}`)
    : console.warn(`Feathery: ${message}`, detail);

const indexNow = (
  editor: any,
  baseUrl: string,
  generatedDocumentId: string,
  headers: () => Record<string, string>
) => {
  let blocks: IndexBlock[];
  try {
    blocks = buildIndexBlocks(editor);
  } catch (err) {
    warn('could not read the document for indexing', err);
    return;
  }
  if (blocks.length === 0) return;

  const digest = fingerprint(blocks);
  if (lastIndexed.get(generatedDocumentId) === digest) return;
  // Claim the digest before the request so two overlapping triggers cannot both
  // POST the same content; drop the claim if the POST fails so a retry is
  // possible.
  lastIndexed.set(generatedDocumentId, digest);

  postDocumentIndex({ baseUrl, generatedDocumentId, blocks, headers }).catch(
    (err) => {
      lastIndexed.delete(generatedDocumentId);
      warn(
        `document index POST failed for ${generatedDocumentId} - semantic document search will return nothing`,
        err
      );
    }
  );
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
        if (generatedDocumentId) {
          indexNow(editor, baseUrl, generatedDocumentId, headers);
          if (lastIndexed.has(generatedDocumentId)) return;
        }
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
      // only signal. Debounced, and the fingerprint check means a settled edit
      // that produced no net change costs nothing.
      let debounce: ReturnType<typeof setTimeout> | null = null;
      const onContentChange = () => {
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
