import React, { useCallback, useEffect, useMemo, useState } from 'react';
import DocxEditor from './index';
import FeatheryClient from '../../../utils/featheryClient';
import { featheryWindow } from '../../../utils/browser';

interface Envelope {
  id: string;
  file: string | null;
  type: string;
  signed: boolean;
}

// Fired by the Generate Documents action (with "View Draft") so an already
// mounted editor reloads the freshly generated envelope.
const REFRESH_EVENT = 'feathery-docx-editor-refresh';

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
  documentId,
  editMode
}: {
  documentId?: string;
  editMode?: boolean;
}) {
  // saveEnvelopeFile/getCurrentEnvelope only use initInfo(), not the form key,
  // so a lightweight client instance is sufficient here.
  const client = useMemo(() => new FeatheryClient(), []);
  const [envelope, setEnvelope] = useState<Envelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped to force the editor to reload its source after a (re)generate, since
  // the reused envelope keeps the same id/url. NOT bumped on save (so saving
  // doesn't reload the document out from under the user).
  const [reloadKey, setReloadKey] = useState(0);

  const syncfusion = (featheryWindow() as any).featherySyncfusion ?? {};

  const loadEnvelope = useCallback(async () => {
    if (!documentId) return;
    try {
      const env = await client.getCurrentEnvelope(documentId);
      setEnvelope(env && env.id ? (env as Envelope) : null);
      setError(null);
    } catch (e: any) {
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
    loadEnvelope();
  }, [documentId, editMode, loadEnvelope]);

  useEffect(() => {
    if (editMode) return undefined;
    const handler = () => {
      loadEnvelope().then(() => setReloadKey((k) => k + 1));
    };
    const win = featheryWindow();
    win.addEventListener(REFRESH_EVENT, handler);
    return () => win.removeEventListener(REFRESH_EVENT, handler);
  }, [editMode, loadEnvelope]);

  // Stable source unless a different envelope loads or a regenerate is
  // signalled (reloadKey) — a plain save leaves both unchanged, so it doesn't
  // reload the document.
  const source = useMemo(
    () => (envelope?.file ? { url: envelope.file } : undefined),
    [envelope?.file, reloadKey]
  );

  const box = (child: React.ReactNode) => <div css={wrap}>{child}</div>;

  if (editMode) return box(<div css={placeholder}>Document editor</div>);
  if (!documentId)
    return box(<div css={placeholder}>No document configured.</div>);
  if (loading) return box(<div css={placeholder}>Loading document…</div>);
  if (error)
    return box(<div css={{ ...placeholder, color: '#dc2626' }}>{error}</div>);
  if (!envelope || !envelope.file)
    return box(
      <div css={placeholder}>
        No document yet — generate it to start editing.
      </div>
    );
  if (envelope.type !== 'docx')
    return box(
      <div css={placeholder}>
        {`Editing ${envelope.type} documents isn't supported yet.`}
      </div>
    );

  return box(
    <DocxEditor
      source={source}
      serviceUrl={syncfusion.serviceUrl}
      licenseKey={syncfusion.licenseKey}
      readOnly={envelope.signed}
      fileName='document'
      onSave={async (blob: Blob) => {
        // Overwrite the same envelope; keep the loaded source stable so the
        // user's view is preserved after saving.
        await client.saveEnvelopeFile(envelope.id, blob, 'document.docx');
      }}
    />
  );
}
