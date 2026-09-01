import React, { useCallback, useEffect, useMemo, useState } from 'react';
import FeatheryClient from '../../../utils/featheryClient';
import { featheryWindow } from '../../../utils/browser';
import { initState } from '../../../utils/init';
import { ACTION_GENERATE_ENVELOPES } from '../../../utils/elementActions';
import { editorContainerId } from '../../../utils/document';
import {
  EDITOR_REFRESH_EVENT,
  PENDING_EDITOR_DRAFTS_KEY
} from '../../../Form/envelopeActions';
import DocxEnvelopeEditor, {
  Envelope,
  envelopeSourceUrl
} from './DocxEnvelopeEditor';

// The container carries no document. Its document is owned by the Generate
// Documents button that targets it: find the action whose editor_mode matches
// this container and use its first document. The schema key it was found under
// is the form key, which the DocuSign finalize needs — the `formId` prop is a
// form *instance* id and can't stand in for it.
function resolveTargetAction(containerId?: string): {
  action?: Record<string, any>;
  formKey?: string;
} {
  if (!containerId) return {};
  const schemas = (initState as any).formSchemas ?? {};
  for (const key of Object.keys(schemas)) {
    const rawSteps = schemas[key]?.steps;
    // panel/v20 caches steps as an array; some callers store a key→step map.
    const steps = Array.isArray(rawSteps)
      ? rawSteps
      : Object.values(rawSteps ?? {});
    for (const step of steps as any[]) {
      for (const button of step?.buttons ?? []) {
        for (const action of button?.properties?.actions ?? []) {
          if (
            action?.type === ACTION_GENERATE_ENVELOPES &&
            editorContainerId(action ?? {}) === containerId
          ) {
            return { action, formKey: key };
          }
        }
      }
    }
  }
  return {};
}

interface RefreshEventDetail {
  containerId?: string;
  documents?: string[];
  envelopes?: Envelope[];
}

function getPendingDraft(containerId?: string): RefreshEventDetail | undefined {
  if (!containerId) return undefined;
  return (featheryWindow() as any)[PENDING_EDITOR_DRAFTS_KEY]?.[containerId];
}

function getGeneratedEnvelope(
  detail?: RefreshEventDetail,
  documentId?: string
): Envelope | undefined {
  return (
    detail?.envelopes?.find(
      (env) => documentId && env.document === documentId
    ) ?? detail?.envelopes?.[0]
  );
}

const placeholder = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
  padding: 16,
  textAlign: 'center' as const,
  border: '1px dashed #d4d4d8',
  borderRadius: 8,
  color: '#71717a',
  fontSize: 14
};

const wrap = {
  width: '100%',
  height: '100%',
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
  position: 'relative' as const
};

// A container whose content is a document editor bound to a Document template.
// At runtime it loads the submission's current envelope for that document and
// (for docx) renders the reusable DocxEnvelopeEditor; saving overwrites the
// envelope in place. The renderer is chosen by envelope type so other types
// (csv/pdf) can be added without changing this wiring.
export default function DocumentEditorContainer({
  containerId,
  formId,
  stepId,
  editMode,
  assistantEnabled
}: {
  containerId?: string;
  formId?: string;
  stepId?: string;
  editMode?: boolean;
  assistantEnabled?: boolean;
}) {
  const pendingDraft = useMemo(
    () => getPendingDraft(containerId),
    [containerId]
  );
  const { action: targetAction, formKey } = useMemo(
    () => resolveTargetAction(containerId),
    [containerId]
  );
  // Carries the form key because the DocuSign sign path posts form_key; the
  // other envelope calls only need initInfo().
  const client = useMemo(() => new FeatheryClient(formKey ?? ''), [formKey]);
  // Document is owned by the button that targets this container.
  const documentId = useMemo(
    () =>
      (targetAction?.documents ?? [])[0] ??
      pendingDraft?.documents?.[0] ??
      pendingDraft?.envelopes?.[0]?.document,
    [targetAction, pendingDraft]
  );
  const [envelope, setEnvelope] = useState<Envelope | null>(
    () => getGeneratedEnvelope(pendingDraft, documentId) ?? null
  );
  const [sourceUrl, setSourceUrl] = useState<string | undefined>(() =>
    envelopeSourceUrl(getGeneratedEnvelope(pendingDraft, documentId))
  );
  const [loading, setLoading] = useState(!envelope);
  const [error, setError] = useState<string | null>(null);
  // Bumped to force the editor to reload its source after a (re)generate.
  // NOT bumped on save (so saving doesn't reload the document out from under
  // the user).
  const [reloadKey, setReloadKey] = useState(0);

  const loadEnvelope = useCallback(async () => {
    if (!documentId) return;
    try {
      const env = await client.getCurrentEnvelope(documentId);
      const nextEnvelope = env && env.id ? (env as Envelope) : null;
      setEnvelope(nextEnvelope);
      setSourceUrl(envelopeSourceUrl(nextEnvelope));
      setError(null);
    } catch (e: any) {
      console.error('Feathery: failed to load current envelope', e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [documentId, client]);

  useEffect(() => {
    if (editMode || !documentId) {
      setLoading(false);
      return;
    }
    const pendingEnvelope = getGeneratedEnvelope(
      getPendingDraft(containerId),
      documentId
    );
    if (pendingEnvelope?.id) {
      setEnvelope(pendingEnvelope);
      setSourceUrl(envelopeSourceUrl(pendingEnvelope));
      setLoading(false);
      return;
    }
    loadEnvelope();
  }, [containerId, documentId, editMode, loadEnvelope]);

  useEffect(() => {
    if (editMode) return undefined;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<RefreshEventDetail>).detail;
      if (
        detail?.containerId &&
        containerId &&
        detail.containerId !== containerId
      ) {
        return;
      }

      const generatedEnvelope = getGeneratedEnvelope(detail, documentId);
      if (generatedEnvelope?.id) {
        setEnvelope(generatedEnvelope);
        setSourceUrl(envelopeSourceUrl(generatedEnvelope));
        setError(null);
        setLoading(false);
        setReloadKey((k) => k + 1);
        return;
      }

      loadEnvelope().then(() => setReloadKey((k) => k + 1));
    };
    const win = featheryWindow();
    win.addEventListener(EDITOR_REFRESH_EVENT, handler);
    return () => win.removeEventListener(EDITOR_REFRESH_EVENT, handler);
  }, [containerId, documentId, editMode, loadEnvelope]);

  // Stable source unless a different envelope loads or a regenerate is
  // signalled (reloadKey) — a plain save leaves both unchanged, so it doesn't
  // reload the document.
  const source = useMemo(
    () => (sourceUrl ? { url: sourceUrl } : undefined),
    [sourceUrl]
  );

  // A save refreshes the envelope's file URLs; keep this owner's envelope in
  // sync without touching `source` (see above).
  const onEnvelopeUpdated = useCallback(
    (updated: { file: string; editor_file?: string | null }) => {
      setEnvelope((current) =>
        current ? { ...current, ...updated } : current
      );
    },
    []
  );

  const box = (child: React.ReactNode) => <div css={wrap}>{child}</div>;

  if (editMode) return box(<div css={placeholder}>Document editor</div>);
  if (!documentId && !envelope) {
    return box(
      <div css={placeholder}>
        No document yet — generate it to start editing.
      </div>
    );
  }
  if (loading) return box(<div css={placeholder}>Loading document…</div>);
  if (error) {
    return box(<div css={{ ...placeholder, color: '#dc2626' }}>{error}</div>);
  }
  if (!envelope || !envelope.file) {
    return box(
      <div css={placeholder}>
        No document yet — generate it to start editing.
      </div>
    );
  }
  if (envelope.type !== 'docx') {
    return box(
      <div css={placeholder}>
        {`Editing ${envelope.type} documents isn't supported yet.`}
      </div>
    );
  }

  return box(
    <DocxEnvelopeEditor
      envelope={envelope}
      action={targetAction}
      client={client}
      source={source}
      openNonce={reloadKey}
      registryKey={containerId}
      formId={formId}
      stepId={stepId}
      assistantEnabled={assistantEnabled}
      defaultDocumentId={documentId}
      onEnvelopeUpdated={onEnvelopeUpdated}
      onError={setError}
    />
  );
}
