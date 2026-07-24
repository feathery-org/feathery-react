import React, { useCallback, useEffect, useMemo, useState } from 'react';
import DocxEditor from './index';
import FeatheryClient, { API_URL } from '../../../utils/featheryClient';
import { featheryWindow } from '../../../utils/browser';
import { initInfo, initState } from '../../../utils/init';
import { ACTION_GENERATE_ENVELOPES } from '../../../utils/elementActions';

// The container carries no document. Its document is owned by the Generate
// Documents button that targets it: find the action whose view_draft_container
// matches this container and use its first document. Scans loaded form schemas
// (container ids are unique, so no need to know the form key).
function resolveDocumentId(containerId?: string): string | undefined {
  if (!containerId) return undefined;
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
            action?.view_draft_container === containerId
          ) {
            return (action.documents ?? [])[0];
          }
        }
      }
    }
  }
  return undefined;
}

interface Envelope {
  id: string;
  file: string | null;
  document?: string;
  type: string;
  signed: boolean;
}

interface RefreshEventDetail {
  containerId?: string;
  documents?: string[];
  envelopes?: Envelope[];
}

// Fired by the Generate Documents action (with "View Draft") so an already
// mounted editor reloads the freshly generated envelope.

function resolveViewDraftReadOnly(containerId?: string): boolean | undefined {
  if (!containerId) return undefined;
  const schemas = (initState as any).formSchemas ?? {};
  for (const key of Object.keys(schemas)) {
    const rawSteps = schemas[key]?.steps;
    const steps = Array.isArray(rawSteps)
      ? rawSteps
      : Object.values(rawSteps ?? {});
    for (const step of steps as any[]) {
      for (const button of step?.buttons ?? []) {
        for (const action of button?.properties?.actions ?? []) {
          if (
            action?.type === ACTION_GENERATE_ENVELOPES &&
            action?.view_draft_container === containerId
          ) {
            if (typeof action.view_draft_read_only === 'boolean') {
              return action.view_draft_read_only;
            }
            // View Draft defaults to editable.
            return false;
          }
        }
      }
    }
  }
  return undefined;
}

const REFRESH_EVENT = 'feathery-docx-editor-refresh';
const PENDING_DRAFTS_KEY = '__featheryDocxEditorDrafts';

function getPendingDraft(containerId?: string): RefreshEventDetail | undefined {
  if (!containerId) return undefined;
  return (featheryWindow() as any)[PENDING_DRAFTS_KEY]?.[containerId];
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
// (for docx) renders the reusable DocxEditor; saving overwrites the envelope in
// place. The renderer is chosen by envelope type so other types (csv/pdf) can
// be added without changing this wiring.
export default function DocumentEditorContainer({
  containerId,
  editMode
}: {
  containerId?: string;
  editMode?: boolean;
}) {
  // saveEnvelopeFile/getCurrentEnvelope only use initInfo(), not the form key,
  // so a lightweight client instance is sufficient here.
  const client = useMemo(() => new FeatheryClient(), []);
  const pendingDraft = useMemo(
    () => getPendingDraft(containerId),
    [containerId]
  );
  // Document is owned by the button that targets this container.
  const documentId = useMemo(
    () =>
      resolveDocumentId(containerId) ??
      pendingDraft?.documents?.[0] ??
      pendingDraft?.envelopes?.[0]?.document,
    [containerId, pendingDraft]
  );
  const [envelope, setEnvelope] = useState<Envelope | null>(
    () => getGeneratedEnvelope(pendingDraft, documentId) ?? null
  );
  const [loading, setLoading] = useState(!envelope);
  const [error, setError] = useState<string | null>(null);
  // Bumped to force the editor to reload its source after a (re)generate.
  // NOT bumped on save (so saving doesn't reload the document out from under
  // the user).
  const [reloadKey, setReloadKey] = useState(0);

  // Read from window each render. Do NOT useMemo([]) — on Next.js SSR
  // featheryWindow() is {} so a mount-once memo freezes serviceUrl as
  // undefined and the editor never opens the generated docx.
  // Default serviceUrl is the Feathery backend proxy (hides the self-hosted
  // Word Processor). window.featherySyncfusion may override for local smoke
  // tests; licenseKey is optional (server license lives on the Word Processor).
  const syncfusion = (featheryWindow() as any).featherySyncfusion ?? {};
  const serviceUrl =
    syncfusion.serviceUrl || `${API_URL}document/editor/`;
  const { sdkKey } = initInfo();
  const serviceHeaders = useMemo(() => {
    if (syncfusion.headers) return syncfusion.headers;
    if (sdkKey) return [{ Authorization: `Token ${sdkKey}` }];
    return [];
  }, [sdkKey, syncfusion.headers]);

  const loadEnvelope = useCallback(async () => {
    if (!documentId) return;
    try {
      const env = await client.getCurrentEnvelope(documentId);
      setEnvelope(env && env.id ? (env as Envelope) : null);
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
        setError(null);
        setLoading(false);
        setReloadKey((k) => k + 1);
        return;
      }

      loadEnvelope().then(() => setReloadKey((k) => k + 1));
    };
    const win = featheryWindow();
    win.addEventListener(REFRESH_EVENT, handler);
    return () => win.removeEventListener(REFRESH_EVENT, handler);
  }, [containerId, documentId, editMode, loadEnvelope]);

  // Stable source unless a different envelope loads or a regenerate is
  // signalled (reloadKey) — a plain save leaves both unchanged, so it doesn't
  // reload the document.
  const fileUrl = envelope?.file ?? undefined;
  const source = useMemo(
    () => (fileUrl ? { url: fileUrl } : undefined),
    [fileUrl]
  );
  const activeDocumentId = documentId ?? envelope?.document;
  // Signed envelopes are always read-only. Otherwise the Generate Documents
  // action that targets this container owns editability via
  // `view_draft_read_only` (default: editable when View Draft is on).
  const actionReadOnly = resolveViewDraftReadOnly(containerId);
  const readOnly = !!envelope?.signed || !!actionReadOnly;

  const box = (child: React.ReactNode) => <div css={wrap}>{child}</div>;

  if (editMode) return box(<div css={placeholder}>Document editor</div>);
  if (!activeDocumentId && !envelope) {
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

  if (!serviceUrl) {
    console.warn(
      'Feathery: document editor serviceUrl is not set — cannot convert/open the .docx'
    );
  }

  return box(
    <DocxEditor
      source={source}
      serviceUrl={serviceUrl}
      headers={serviceHeaders}
      licenseKey={syncfusion.licenseKey}
      readOnly={readOnly}
      openNonce={reloadKey}
      fileName='document'
      onSave={async (blob: Blob) => {
        // Overwrite the same envelope; keep the loaded source stable so the
        // user's view is preserved after saving.
        await client.saveEnvelopeFile(envelope.id, blob, 'document.docx');
      }}
    />
  );
}
