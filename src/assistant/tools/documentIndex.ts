// In-form document indexing (HILB Contract C / CRACK #4a). When a docx_editor
// field loads on a form with Assist enabled, POST the editor's block inventory
// to ai-services /assistant/document-index so searchGeneratedDocument can mount
// and Robin can semantically locate content in a large doc (no envelope /
// pgvector on the real form otherwise).
//
// Keying: the index is scoped by the generated_document id we emit in
// getAssistantTargets (the docx servar id). ai-services stores + searches
// chunks under `envelope_id`; an in-form doc has no envelope, so that servar id
// IS the scope key - sent as `envelopeId` (and `documentId`) so the a6 index +
// searchGeneratedDocument query resolve to the same key.

import { useCallback, useEffect, useRef, useState } from 'react';
import { initInfo } from '../../utils/init';
import { getCookie } from '../../utils/browser';
import { buildDocxIndexBlocks, DocIndexBlock } from './docxEditorBridge';

// Re-post the index this long after the last edit (matches the envelope path).
export const REINDEX_DEBOUNCE_MS = 5000;

// Same auth shape AssistantChat uses: a host JWT when supplied, else the SDK key
// plus the session cookie.
export const documentIndexHeaders = (
  getJwt?: () => string
): Record<string, string> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (getJwt) {
    headers.Authorization = `Bearer ${getJwt()}`;
    return headers;
  }
  const { sdkKey } = initInfo();
  headers.Authorization = `Token ${sdkKey}`;
  const session = getCookie('feathery_session_token');
  if (session) headers['X-Feathery-Session'] = session;
  return headers;
};

export type PostDocumentIndexArgs = {
  baseUrl: string;
  generatedDocumentId: string;
  blocks: DocIndexBlock[];
  getJwt?: () => string;
};

// POST the block inventory. Returns false (no request sent) when the scope key
// or blocks are missing - we never POST an empty inventory (it would embed
// nothing and clobber the index).
export const postDocxDocumentIndex = async ({
  baseUrl,
  generatedDocumentId,
  blocks,
  getJwt
}: PostDocumentIndexArgs): Promise<boolean> => {
  if (!baseUrl || !generatedDocumentId || !blocks?.length) return false;
  const url = `${baseUrl}document-index`;
  const res = await fetch(url, {
    method: 'POST',
    headers: documentIndexHeaders(getJwt),
    body: JSON.stringify({
      envelopeId: generatedDocumentId,
      documentId: generatedDocumentId,
      blocks
    })
  });
  if (!res.ok) throw new Error(`document-index failed (${res.status})`);
  return true;
};

type UseDocxDocumentIndexArgs = {
  editor: any;
  // True once the document has loaded into the editor (DocxEditor.onReady) - the
  // initial index waits for this so it runs against the loaded doc, not a blank
  // editor.
  ready: boolean;
  // Assist is enabled on this form (gates all indexing).
  enabled: boolean;
  // `${origin}/agent/assistant/` - the same base the chat posts to.
  baseUrl?: string;
  // The generated_document id (= docx servar id) emitted in getAssistantTargets.
  generatedDocumentId?: string;
  getJwt?: () => string;
};

// Fires the initial index once the editor is ready + populated (guarded to run
// exactly once) and exposes a debounced re-index to call after edits.
export function useDocxDocumentIndex({
  editor,
  ready,
  enabled,
  baseUrl,
  generatedDocumentId,
  getJwt
}: UseDocxDocumentIndexArgs): {
  indexing: boolean;
  indexError: string | null;
  reindexDebounced: () => void;
} {
  const [indexing, setIndexing] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const didInitial = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (
      !enabled ||
      !editor ||
      !ready ||
      !baseUrl ||
      !generatedDocumentId ||
      didInitial.current
    )
      return;
    const blocks = buildDocxIndexBlocks(editor);
    if (blocks.length === 0) return; // doc not populated yet - wait, don't POST []
    didInitial.current = true;
    setIndexing(true);
    setIndexError(null);
    postDocxDocumentIndex({ baseUrl, generatedDocumentId, blocks, getJwt })
      .catch((e) => setIndexError(e?.message ?? 'indexing failed'))
      .finally(() => setIndexing(false));
  }, [enabled, editor, ready, baseUrl, generatedDocumentId, getJwt]);

  const reindexDebounced = useCallback(() => {
    if (!enabled || !editor || !baseUrl || !generatedDocumentId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const blocks = buildDocxIndexBlocks(editor);
      if (blocks.length === 0) return;
      postDocxDocumentIndex({
        baseUrl,
        generatedDocumentId,
        blocks,
        getJwt
      }).catch((e) => setIndexError(e?.message ?? 'reindex failed'));
    }, REINDEX_DEBOUNCE_MS);
  }, [enabled, editor, baseUrl, generatedDocumentId, getJwt]);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  return { indexing, indexError, reindexDebounced };
}
