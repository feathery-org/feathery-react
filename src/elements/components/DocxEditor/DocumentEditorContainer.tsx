import React, { useCallback, useEffect, useMemo, useState } from 'react';
import DocxEditor from './index';
import FeatheryClient, { API_URL } from '../../../utils/featheryClient';
import {
  downloadAllFileUrls,
  featheryWindow,
  openTab
} from '../../../utils/browser';
import { initInfo, initState, setFieldValues } from '../../../utils/init';
import { ACTION_GENERATE_ENVELOPES } from '../../../utils/elementActions';
import { getSignUrl } from '../../../utils/document';
import { replaceTextVariables } from '../TextNodes';

// The container carries no document. Its document is owned by the Generate
// Documents button that targets it: find the action whose view_draft_container
// matches this container and use its first document. Scans loaded form schemas
// (container ids are unique, so no need to know the form key).
function resolveTargetAction(
  containerId?: string
): Record<string, any> | undefined {
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
            return action;
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

// Fired by the Generate Documents action targeting this container so an
// already mounted editor reloads the freshly generated envelope.
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
  const targetAction = useMemo(
    () => resolveTargetAction(containerId),
    [containerId]
  );
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
  const [sourceUrl, setSourceUrl] = useState<string | undefined>(
    () => getGeneratedEnvelope(pendingDraft, documentId)?.file ?? undefined
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
  const serviceUrl = syncfusion.serviceUrl || `${API_URL}document/editor/`;
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
      const nextEnvelope = env && env.id ? (env as Envelope) : null;
      setEnvelope(nextEnvelope);
      setSourceUrl(nextEnvelope?.file ?? undefined);
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
      setSourceUrl(pendingEnvelope.file ?? undefined);
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
        setSourceUrl(generatedEnvelope.file ?? undefined);
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
  const source = useMemo(
    () => (sourceUrl ? { url: sourceUrl } : undefined),
    [sourceUrl]
  );
  const activeDocumentId = documentId ?? envelope?.document;
  // Signed envelopes are always read-only. Otherwise the Generate Documents
  // action that targets this container owns editability via
  // `view_draft_read_only` (default: editable).
  const actionReadOnly =
    typeof targetAction?.view_draft_read_only === 'boolean'
      ? targetAction.view_draft_read_only
      : false;
  const readOnly = !!envelope?.signed || !!actionReadOnly;
  const terminalAction = targetAction
    ? !targetAction.envelope_action || targetAction.envelope_action === 'sign'
      ? 'sign'
      : targetAction.envelope_action === 'download'
      ? 'download'
      : undefined
    : undefined;

  const saveEnvelope = useCallback(
    async (blob: Blob) => {
      if (!envelope) return;
      const updated = await client.saveEnvelopeFile(
        envelope.id,
        blob,
        'document.docx'
      );
      const savedFileUrl = updated?.file ?? envelope.file;
      if (updated?.file) {
        setEnvelope((current) =>
          current?.id === envelope.id
            ? { ...current, file: updated.file }
            : current
        );
      }
      if (
        targetAction?.envelope_action === 'save' &&
        targetAction.save_document_field_key &&
        savedFileUrl
      ) {
        const newValues = {
          [targetAction.save_document_field_key]: savedFileUrl
        };
        setFieldValues(newValues, true, true);
        await client.submitCustom(newValues);
      }
      return updated;
    },
    [client, envelope, targetAction]
  );

  const runTerminalAction = useCallback(
    async (saveResult?: unknown) => {
      const savedFileUrl =
        (saveResult as { file?: string } | undefined)?.file ?? envelope?.file;
      if (!savedFileUrl || !terminalAction) return;
      if (terminalAction === 'download') {
        await downloadAllFileUrls(
          [savedFileUrl],
          replaceTextVariables(targetAction?.envelope_zip_name)
        );
      } else if (terminalAction === 'sign') {
        const url = getSignUrl(targetAction?.redirect);
        if (targetAction?.redirect) featheryWindow().location.href = url;
        else openTab(url);
      }
    },
    [envelope?.file, targetAction, terminalAction]
  );

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
      terminalAction={terminalAction}
      onTerminalAction={terminalAction ? runTerminalAction : undefined}
      terminalActionDisabled={!envelope.file}
      onSave={saveEnvelope}
    />
  );
}
