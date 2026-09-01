import React, { useCallback, useRef, useState } from 'react';
import type FeatheryClient from '../../../utils/featheryClient';
import { downloadAllFileUrls } from '../../../utils/browser';
import { setFieldValues } from '../../../utils/init';
import { containerToolbarOutcomes } from '../../../utils/document';
import PdfViewer, { PdfViewerApi } from '../DocumentViewer/PdfViewer';
import AlertBanner from './AlertBanner';
import { primaryButtonCss, secondaryButtonCss } from './buttonStyles';
import { SpinnerIcon } from './icons';
import { color } from './tokens';
import { runEnvelopeSigningAction } from './envelopeSigning';
import type { Envelope } from './DocxEnvelopeEditor';

interface PdfEnvelopeViewerProps {
  envelope: Envelope;
  // The Generate Documents action that owns the document: it configures the
  // toolbar outcomes, read-only state, signers, and sign method.
  action?: Record<string, any>;
  client: FeatheryClient;
  // Kept separate from envelope.file by the owner so a save (which refreshes
  // the envelope's file URL) doesn't reload the document out from under the
  // user.
  sourceUrl: string;
  formId?: string;
  defaultDocumentId?: string;
  // A save refreshes the envelope's file URL; the owner keeps its envelope
  // state in sync through this.
  onEnvelopeUpdated?: (updated: { file: string }) => void;
}

// The pdf renderer wired to a generated envelope for a document-editor
// container: the fillable pdf.js viewer plus the terminal actions
// (sign/draft/download/save-to-field) the owning action's
// `editor_toolbar_actions` configured — the same outcomes the docx editor's
// toolbar runs, executed against this one envelope.
export default function PdfEnvelopeViewer({
  envelope,
  action,
  client,
  sourceUrl,
  formId,
  defaultDocumentId,
  onEnvelopeUpdated
}: PdfEnvelopeViewerProps) {
  const pdfApiRef = useRef<PdfViewerApi | null>(null);
  // Key of the toolbar action currently running (spinner + disable-all), or
  // null when idle.
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  // Envelope that was finalized for signing this session — its signer rows
  // exist, so further edits would change a document already sent out. Keyed
  // by id so a regenerated envelope is editable again without reset wiring.
  const [finalizedId, setFinalizedId] = useState<string | null>(null);

  const activeDocumentId = envelope.document ?? defaultDocumentId;
  const actionReadOnly =
    typeof action?.editor_read_only === 'boolean'
      ? action.editor_read_only
      : false;
  const readOnly =
    !!envelope.signed || !!actionReadOnly || envelope.id === finalizedId;
  const { terminalAction, offersDraft, offersDownload, savesToField } =
    containerToolbarOutcomes(action ?? {});

  // The envelope's live public file URL: a save returns a fresh signed URL,
  // and the download/save-to-field outcomes must serve that, not the stale
  // one loaded at mount.
  const latestFileRef = useRef<string | null>(envelope.file);

  const saveEnvelopeFile = useCallback(
    async (envelopeId: string, file: Blob) => {
      const updated = await client.saveEnvelopeFile(
        envelopeId,
        file,
        'document.pdf'
      );
      if (updated?.file) {
        latestFileRef.current = updated.file;
        onEnvelopeUpdated?.({ file: updated.file });
      }
      return updated;
    },
    [client, onEnvelopeUpdated]
  );

  const runToolbarAction = async (key: string, run: () => Promise<void>) => {
    setBusyKey(key);
    setError('');
    try {
      // Persist any edited field values first, so the outcome acts on them.
      await pdfApiRef.current?.saveEditedDocuments();
      await run();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusyKey(null);
    }
  };

  const runSigningAction = (draft: boolean) =>
    runEnvelopeSigningAction({
      envelope,
      action,
      client,
      formId,
      activeDocumentId,
      draft,
      onFinalized: () => setFinalizedId(envelope.id)
    });

  const runDownload = async () => {
    const url = latestFileRef.current;
    if (url) await downloadAllFileUrls([url]);
  };

  const runSaveToField = async () => {
    const url = latestFileRef.current;
    if (!action?.save_document_field_key || !url) return;
    const newValues = { [action.save_document_field_key]: url };
    setFieldValues(newValues, true, true);
    await client.submitCustom(newValues);
  };

  // Mirrors the docx editor's toolbar: one terminal button (Sign > Create
  // Draft > Download), a Create Draft secondary beside Sign when DocuSign
  // offers both, Download as a secondary unless it is the terminal action or
  // the save-to-field flow owns the document's destination, and Save when the
  // toolbar saves to a field.
  const buttons: {
    key: string;
    label: string;
    primary?: boolean;
    disabled?: boolean;
    run: () => Promise<void>;
  }[] = [];
  if (offersDownload && !savesToField && terminalAction !== 'download') {
    buttons.push({ key: 'download', label: 'Download', run: runDownload });
  }
  if (savesToField && action?.save_document_field_key) {
    buttons.push({ key: 'save', label: 'Save', run: runSaveToField });
  }
  if (offersDraft) {
    buttons.push({
      key: 'draft',
      label: 'Create Draft',
      disabled: !!envelope.signed,
      run: () => runSigningAction(true)
    });
  }
  if (terminalAction) {
    buttons.push({
      key: 'terminal',
      label:
        terminalAction === 'sign'
          ? 'Sign'
          : terminalAction === 'draft'
          ? 'Create Draft'
          : 'Download',
      primary: true,
      // Signing needs a signer to open as, which only finalizing an unsigned
      // envelope hands back - so there's nothing behind the button once
      // signed. Download stays available.
      disabled: terminalAction !== 'download' && !!envelope.signed,
      run:
        terminalAction === 'download'
          ? runDownload
          : () => runSigningAction(terminalAction === 'draft')
    });
  }

  const busy = busyKey !== null;
  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        minHeight: 0,
        backgroundColor: '#f4f5f8'
      }}
    >
      {buttons.length > 0 && (
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '8px 12px',
            backgroundColor: color.surface,
            borderBottom: `1px solid ${color.border}`,
            flexShrink: 0
          }}
        >
          {buttons.map((button) => (
            <button
              key={button.key}
              type='button'
              disabled={busy || button.disabled}
              onClick={() => runToolbarAction(button.key, button.run)}
              css={button.primary ? primaryButtonCss : secondaryButtonCss}
            >
              {busyKey === button.key && <SpinnerIcon size={16} />}
              {button.label}
            </button>
          ))}
        </div>
      )}
      {error && <AlertBanner message={error} onDismiss={() => setError('')} />}
      <PdfViewer
        documents={[
          {
            type: 'form',
            pdf_url: sourceUrl,
            envelope_id: envelope.id
          }
        ]}
        onSaveEnvelopeFile={readOnly ? undefined : saveEnvelopeFile}
        apiRef={pdfApiRef}
        readOnly={readOnly}
      />
    </div>
  );
}
