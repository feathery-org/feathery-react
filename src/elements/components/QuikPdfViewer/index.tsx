import React, { useCallback, useMemo, useRef, useState } from 'react';
import './pdfSetup';
import DocumentScroll from './DocumentScroll';
import ViewerHeader from './ViewerHeader';
import { NativeFieldLayer, LoadedDoc } from './fieldLayer/NativeFieldLayer';
import { featheryDoc } from '../../../utils/browser';

export interface ViewerDocument {
  type: 'form' | 'attachment';
  pdf_url: string;
  form_id?: string;
  group_index?: number;
  form_name?: string;
  name?: string;
  position?: 'before' | 'after';
}

export interface QuikViewerPayload {
  documents: ViewerDocument[];
  expires_at: string;
}

interface QuikPdfViewerProps {
  payload: QuikViewerPayload;
  action: Record<string, any>;
  client: any;
  setShow: (show: boolean) => void;
  onComplete: () => void;
}

export default function QuikPdfViewer({
  payload,
  action,
  client,
  setShow,
  onComplete
}: QuikPdfViewerProps) {
  const loadedDocs = useRef<Record<number, any>>({});
  const [remountKey, setRemountKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const fieldLayer = useMemo(
    () =>
      new NativeFieldLayer(
        () =>
          payload.documents.map(
            (doc, i): LoadedDoc => ({ doc, pdfProxy: loadedDocs.current[i] })
          ),
        () => {
          loadedDocs.current = {};
          setRemountKey((k) => k + 1);
        }
      ),
    [payload.documents]
  );

  const onDocLoad = useCallback((docIndex: number, pdfProxy: any) => {
    loadedDocs.current[docIndex] = pdfProxy;
  }, []);

  const finalize = async (reviewAction: string) => {
    setBusy(true);
    setError('');
    try {
      if (reviewAction === 'sign') {
        const issues = await fieldLayer.validate();
        if (issues.length) {
          setError(
            `Please complete ${issues.length} required field(s) before signing.`
          );
          return;
        }
      }
      const fieldOverrides = await fieldLayer.getOverrides();
      const result = await client.finalizeQuikViewer({
        action,
        reviewAction,
        fieldOverrides,
        attachments: action.attachments ?? []
      });
      if (result?.status === 'error') setError(result.message);
      else onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    for (const [i, doc] of payload.documents.entries()) {
      const proxy = loadedDocs.current[i];
      if (!proxy) continue;
      const bytes: Uint8Array = await proxy.saveDocument();
      const url = URL.createObjectURL(
        new Blob([bytes], { type: 'application/pdf' })
      );
      const a = featheryDoc().createElement('a');
      a.href = url;
      a.download = doc.form_name ?? doc.name ?? `document-${i + 1}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const isSign = action.review_action === 'sign';
  return (
    <div
      css={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#f4f5f8'
      }}
    >
      <ViewerHeader
        title='Review Your Forms'
        onBack={() => setShow(false)}
        onReset={() => fieldLayer.reset()}
        onDownload={download}
        onSaveDraft={isSign ? () => finalize('draft') : undefined}
        onPrimary={() => finalize(isSign ? 'sign' : 'submit')}
        primaryLabel={isSign ? 'Sign' : 'Submit'}
        busy={busy}
      />
      {error && (
        <div
          role='alert'
          css={{ padding: 12, background: '#fdecea', color: '#b3261e' }}
        >
          {error}
        </div>
      )}
      <div css={{ flex: 1, overflow: 'auto', padding: 24 }}>
        <DocumentScroll
          documents={payload.documents}
          pageWidth={900}
          onDocLoad={onDocLoad}
          registerPageRef={() => undefined}
          remountKey={remountKey}
        />
      </div>
    </div>
  );
}
